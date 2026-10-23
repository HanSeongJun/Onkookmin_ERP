"use server"

import type { PostgrestError } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"
import type { z } from "zod"

import { requireUser } from "@/lib/auth/user"
import { getCategoryTree } from "@/lib/categories/queries"
import { findCategoryPath, type CategoryNode } from "@/lib/categories/tree"
import {
  availableCodePrefix,
  nextAvailableCode,
  type BaseProductOption,
} from "@/lib/products/bundle"
import {
  PRODUCT_CODE_PATTERN,
  PRODUCT_DB_CONSTRAINTS,
  PRODUCT_DB_RULES,
} from "@/lib/products/constants"
import {
  countInactiveProducts,
  findActiveBundleIdsContaining,
  findBundleIdsWithInactiveComponents,
  getBaseProductsByIds,
  getBundlesContainingProduct,
  getProduct,
  getProductTypes,
  listCodesStartingWith,
  searchBaseProducts,
  type ContainingBundle,
  type ProductDetail,
} from "@/lib/products/queries"
import {
  isUuid,
  productFormSchema,
  productIdsSchema,
  type BaseProductFormValues,
  type BundleProductFormValues,
  type ProductFieldErrors,
  type ProductFieldName,
} from "@/lib/products/schema"
import { createClient } from "@/lib/supabase/server"
import type { TablesInsert } from "@/types/database"

/**
 * What the 상품 form gets back from createProduct / updateProduct.
 * On success the form shows a toast and closes the modal.
 */
export type ProductActionResult =
  | {
      ok: true
      productId: string
      /**
       * 기준상품 switched to 사용중지: how many 묶음상품 containing it were
       * switched off with it (by the database). 0 otherwise.
       */
      bundlesDeactivated: number
    }
  | {
      ok: false
      /** Korean message for the whole form (shown as a toast). */
      message: string
      /**
       * Korean messages shown under individual fields. Messages about the
       * 구성표 as a whole are under "items".
       */
      fieldErrors: ProductFieldErrors
    }

const CHECK_INPUT_MESSAGE = "입력한 내용을 확인해 주세요."
const SAVE_FAILED_MESSAGE =
  "상품을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."
const PRODUCT_NOT_FOUND_MESSAGE =
  "상품을 찾을 수 없습니다. 목록에서 다시 선택해 주세요."
const PRODUCT_CHANGED_MESSAGE =
  "이 창을 연 뒤에 상품 정보가 바뀌었습니다. 다른 직원이 먼저 수정했을 수 있습니다. 창을 닫고 다시 열어 수정해 주세요."
const CATEGORY_NOT_FOUND_MESSAGE =
  "선택한 분류를 찾을 수 없습니다. [분류적용]에서 분류를 다시 불러와 선택해 주세요."
const PRODUCT_TYPE_FIXED_MESSAGE =
  "상품유형(기준상품/묶음상품)은 등록한 뒤에 바꿀 수 없습니다. 다른 유형이 필요하면 새 상품으로 등록해 주세요."
const DUPLICATE_COMPONENT_MESSAGE =
  "같은 기준상품을 두 번 넣을 수 없습니다. 한 줄로 합치고 수량을 늘려 주세요."
const COMPONENT_NOT_FOUND_MESSAGE =
  "구성상품으로 넣은 기준상품을 찾을 수 없습니다. 구성상품을 다시 추가해 주세요."
const ACTIVATION_BLOCKED_MESSAGE =
  "사용중지된 기준상품이 들어 있는 묶음상품은 사용으로 바꿀 수 없습니다. 기준상품을 먼저 사용으로 바꿔 주세요."

// ---------------------------------------------------------------------------
// 상품 등록 / 수정
// ---------------------------------------------------------------------------

/**
 * 상품 등록 (기준상품 or 묶음상품, by `productType`). `input` is the raw
 * form input (checked here again: never trust the browser). Fields of the
 * other type and fields such as id or created_by are ignored.
 * Without a category the product is saved as 미분류.
 * A 묶음상품 is saved together with its 구성표 in one transaction (database
 * function create_bundle_product).
 */
export async function createProduct(
  input: unknown
): Promise<ProductActionResult> {
  await requireUser()

  const parsed = productFormSchema.safeParse(input)
  if (!parsed.success) return validationFailed(parsed.error)
  const values = parsed.data

  if (values.categoryId !== null) {
    const categoryError = await checkCategory(values.categoryId)
    if (categoryError) return fieldFailed({ categoryId: categoryError })
  }

  const supabase = await createClient()
  let productId: string
  if (values.productType === "base") {
    const { data, error } = await supabase
      .from("products")
      .insert(toBaseProductRow(values))
      .select("id")
      .single()
    if (error) return saveFailed(error)
    productId = data.id
  } else {
    const { data, error } = await supabase.rpc("create_bundle_product", {
      product: toBundleProductJson(values),
      items: toBundleItemsJson(values),
    })
    if (error) return saveFailed(error)
    productId = data
  }

  revalidatePath("/products")
  return { ok: true, productId, bundlesDeactivated: 0 }
}

/**
 * 상품 수정. `productId` comes from the modal's address; `input` is the raw
 * form input (checked here again). Its `productType` must be the saved one:
 * the type never changes. Fields of the other type and fields such as id or
 * created_by are ignored.
 *
 * `loadedUpdatedAt` is the product's `updated_at` when the form was opened.
 * If someone saved the product after that, nothing is saved and the user is
 * asked to open it again: otherwise their older form would silently undo the
 * other person's changes.
 *
 * A 기준상품 switched to 사용중지 also switches off every 묶음상품 that
 * contains it (database trigger); `bundlesDeactivated` says how many. A
 * 묶음상품 is saved with its whole 구성표 in one transaction (database
 * function update_bundle_product).
 */
export async function updateProduct(
  productId: string,
  loadedUpdatedAt: string,
  input: unknown
): Promise<ProductActionResult> {
  await requireUser()

  if (!isUuid(productId)) return formFailed(PRODUCT_NOT_FOUND_MESSAGE)
  if (typeof loadedUpdatedAt !== "string" || loadedUpdatedAt === "") {
    return formFailed(PRODUCT_CHANGED_MESSAGE)
  }
  const id = productId.toLowerCase()

  const parsed = productFormSchema.safeParse(input)
  if (!parsed.success) return validationFailed(parsed.error)
  const values = parsed.data

  const supabase = await createClient()

  const { data: current, error: currentError } = await supabase
    .from("products")
    .select("product_type, category_id, is_active, updated_at")
    .eq("id", id)
    .maybeSingle()
  if (currentError) return saveFailed(currentError)
  if (!current) return formFailed(PRODUCT_NOT_FOUND_MESSAGE)
  if (current.product_type !== values.productType) {
    return fieldFailed({ productType: PRODUCT_TYPE_FIXED_MESSAGE })
  }
  if (current.updated_at !== loadedUpdatedAt) {
    return formFailed(PRODUCT_CHANGED_MESSAGE)
  }

  // A new category must be usable. The product may keep its current category
  // even if that category (or one above it) was switched off (사용 중지) in
  // the meantime, and 분류해제 (back to 미분류) is always allowed.
  const categoryId = values.categoryId
  if (categoryId !== null && categoryId !== current.category_id) {
    const categoryError = await checkCategory(categoryId)
    if (categoryError) return fieldFailed({ categoryId: categoryError })
  }

  if (values.productType === "bundle") {
    const { error } = await supabase.rpc("update_bundle_product", {
      product_id: id,
      loaded_updated_at: loadedUpdatedAt,
      product: toBundleProductJson(values),
      items: toBundleItemsJson(values),
    })
    if (error) return saveFailed(error)

    revalidatePath("/products")
    return { ok: true, productId: id, bundlesDeactivated: 0 }
  }

  // 기준상품 going 사용 → 사용중지: note its 사용 묶음상품 first, to report
  // how many the database switched off with it.
  const switchingOff = current.is_active && !values.isActive
  const bundleIds = switchingOff ? await activeBundleIdsOrEmpty([id]) : []

  const { data, error } = await supabase
    .from("products")
    .update(toBaseProductRow(values))
    .eq("id", id)
    // Also catches a save by someone else between the check above and now.
    .eq("updated_at", loadedUpdatedAt)
    .select("id")
    .maybeSingle()
  if (error) return saveFailed(error)
  // The product exists (checked above), so no row means it was just changed.
  if (!data) return formFailed(PRODUCT_CHANGED_MESSAGE)

  revalidatePath("/products")
  return {
    ok: true,
    productId: data.id,
    bundlesDeactivated: await countInactiveOrZero(bundleIds),
  }
}

/**
 * The product for the 상품 수정 modal (with its 구성표 for a 묶음상품, or the
 * 묶음상품 containing it for a 기준상품), or null when there is no such
 * product (or `productId` is not a UUID). Throws when it cannot be read.
 */
export async function loadProductForEdit(
  productId: unknown
): Promise<ProductDetail | null> {
  await requireUser()
  if (!isUuid(productId)) return null
  return getProduct(productId.toLowerCase())
}

/**
 * Every 상품 분류 as a tree (including switched-off ones), for the category
 * pickers of the 상품관리 screen. They call it when they open, so categories
 * just added in the 상품분류설정 tab show up without reloading the page.
 * (A Server Action, not router.refresh(): a refresh while the modal's own
 * address is shown stops the list from following later modal addresses.)
 */
export async function loadProductCategories(): Promise<CategoryNode[]> {
  await requireUser()
  return getCategoryTree({ includeInactive: true })
}

// ---------------------------------------------------------------------------
// 묶음상품: 기준상품 picker, 구성표 and 묶음상품 tab
// ---------------------------------------------------------------------------

/**
 * The [기준상품 추가] picker: 사용 기준상품 whose 상품코드, 상품명 or 바코드
 * contains `search` (ignoring case; "" = all), in 상품코드 order, at most
 * 100 starting at row `offset` (0 = from the first; the picker's "더 보기"
 * passes the number of rows it already shows). `total` = all matches.
 * Throws when they cannot be read.
 */
export async function searchBaseProductsForBundle(
  search: unknown,
  offset: unknown = 0
): Promise<{ rows: BaseProductOption[]; total: number }> {
  await requireUser()
  return searchBaseProducts(typeof search === "string" ? search : "", {
    offset:
      typeof offset === "number" && Number.isSafeInteger(offset) ? offset : 0,
  })
}

/**
 * These 기준상품 (사용 and 사용중지; ids that are not 기준상품 are left out),
 * in the order given. For a new 묶음상품 started from a 기준상품
 * (?modal=new-bundle&base=<id>) and to read the 구성상품 again.
 */
export async function loadBaseProductsForBundle(
  productIds: unknown
): Promise<BaseProductOption[]> {
  await requireUser()
  const parsed = productIdsSchema.safeParse(productIds)
  if (!parsed.success) return []
  return getBaseProductsByIds(parsed.data)
}

/**
 * The 묶음상품 that contain this 기준상품 (the 기준상품's 묶음상품 tab, and
 * the 사용중지 confirm of its 상품 수정 modal, read fresh when 저장 is
 * pressed), in 상품코드 order. Empty for a 묶음상품 or an unknown id.
 * Throws when they cannot be read.
 */
export async function loadBundlesContainingProduct(
  productId: unknown
): Promise<ContainingBundle[]> {
  await requireUser()
  if (!isUuid(productId)) return []
  return getBundlesContainingProduct(productId)
}

/**
 * How many 사용 묶음상품 would be switched off together with these products
 * (the 기준상품 among them), not counting the checked products themselves.
 * For the warning before 선택 사용중지 ("체크한 기준상품이 들어간 묶음상품
 * N개도 함께 사용중지됩니다"). The 상품 수정 modal reads the list itself with
 * loadBundlesContainingProduct (it shows their names). 0 when it cannot be
 * read.
 */
export async function countBundlesToDeactivate(
  productIds: unknown
): Promise<number> {
  await requireUser()
  const parsed = productIdsSchema.safeParse(productIds)
  if (!parsed.success) return 0
  const checked = new Set(parsed.data)
  const bundleIds = await activeBundleIdsOrEmpty(parsed.data)
  return bundleIds.filter((id) => !checked.has(id)).length
}

/**
 * `candidate` when no product uses that 상품코드 yet (ignoring case),
 * otherwise "<candidate>-2", "<candidate>-3" … — for the suggested code of a
 * new 묶음상품 ("100123-6" → "100123-6-2", "100123-SET" → "100123-SET-2").
 * Only a suggestion: saving still fails with "이미 사용 중인 상품코드입니다."
 * when someone takes the code meanwhile.
 * Returns `candidate` unchanged when it is not a valid code or the codes
 * cannot be read.
 */
export async function suggestAvailableProductCode(
  candidate: unknown
): Promise<string> {
  await requireUser()
  if (typeof candidate !== "string") return ""
  if (!PRODUCT_CODE_PATTERN.test(candidate)) return candidate
  try {
    // Every code nextAvailableCode may return starts with this prefix.
    const taken = await listCodesStartingWith(availableCodePrefix(candidate))
    return nextAvailableCode(candidate, taken)
  } catch (error) {
    console.error("Could not check product codes:", error)
    return candidate
  }
}

// ---------------------------------------------------------------------------
// 선택 사용중지 / 선택 사용
// ---------------------------------------------------------------------------

/** What the list gets back from setProductsActive. */
export type ProductStatusActionResult =
  | {
      ok: true
      /** Products that were switched. */
      changed: number
      /** Checked products that already had that status. */
      unchanged: number
      /**
       * 선택 사용: checked 묶음상품 left 사용중지 because one of their
       * 기준상품 is 사용중지. 0 for 선택 사용중지.
       */
      blocked: number
      /**
       * 선택 사용중지: 묶음상품 (not checked) that the database switched off
       * together with their 기준상품. 0 for 선택 사용.
       */
      bundlesDeactivated: number
    }
  | { ok: false; message: string }

/** Ids per update request, so the request address stays short. */
const STATUS_UPDATE_CHUNK = 100

/**
 * 선택 사용중지 (`isActive` false) / 선택 사용 (`isActive` true) for the
 * checked products. Products are never deleted; this only switches
 * 사용 여부. `productIds` is checked here again (1–300 UUIDs).
 * - 사용중지 of a 기준상품 also switches off every 묶음상품 containing it
 *   (database trigger), counted in `bundlesDeactivated`.
 * - 사용: 기준상품 are switched first, so a checked 묶음상품 whose 기준상품
 *   is switched on in the same click can follow. A 묶음상품 that still has a
 *   사용중지 기준상품 stays 사용중지 (`blocked`).
 */
export async function setProductsActive(
  productIds: unknown,
  isActive: unknown
): Promise<ProductStatusActionResult> {
  await requireUser()

  if (typeof isActive !== "boolean") {
    return { ok: false, message: "사용 여부를 다시 선택해 주세요." }
  }
  const parsed = productIdsSchema.safeParse(productIds)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "상품을 다시 선택해 주세요.",
    }
  }
  const ids = parsed.data

  if (!isActive) {
    const checked = new Set(ids)
    const bundleIds = (await activeBundleIdsOrEmpty(ids)).filter(
      (id) => !checked.has(id)
    )
    const result = await updateStatus(ids, false, 0)
    if (!result.ok) return result
    revalidatePath("/products")
    return {
      ok: true,
      changed: result.changed,
      unchanged: ids.length - result.changed,
      blocked: 0,
      bundlesDeactivated: await countInactiveOrZero(bundleIds),
    }
  }

  // 선택 사용: 기준상품 first, then the 묶음상품 that have no 사용중지
  // 기준상품 left (a 기준상품 switched on in this same click counts).
  const baseIds: string[] = []
  const bundleIds: string[] = []
  try {
    const types = await getProductTypes(ids)
    for (const id of ids) {
      if (types.get(id) === "bundle") bundleIds.push(id)
      else baseIds.push(id)
    }
  } catch (error) {
    console.error("Could not read product types:", error)
    return {
      ok: false,
      message: "사용 여부를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.",
    }
  }

  const baseResult = await updateStatus(baseIds, true, 0)
  if (!baseResult.ok) return baseResult

  let blockedIds: Set<string>
  try {
    blockedIds = await findBundleIdsWithInactiveComponents(bundleIds)
  } catch (error) {
    console.error("Could not read bundle components:", error)
    if (baseResult.changed > 0) revalidatePath("/products")
    return {
      ok: false,
      message:
        baseResult.changed > 0
          ? `${baseResult.changed}개만 바꾸고 나머지는 바꾸지 못했습니다. 목록을 확인한 뒤 다시 시도해 주세요.`
          : "사용 여부를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.",
    }
  }
  const allowedBundleIds = bundleIds.filter((id) => !blockedIds.has(id))
  const bundleResult = await updateStatus(
    allowedBundleIds,
    true,
    baseResult.changed
  )
  if (!bundleResult.ok) return bundleResult

  const changed = baseResult.changed + bundleResult.changed
  revalidatePath("/products")
  return {
    ok: true,
    changed,
    unchanged: ids.length - changed - blockedIds.size,
    blocked: blockedIds.size,
    bundlesDeactivated: 0,
  }
}

/**
 * Switches 사용 여부 of these products in chunks. Only rows that still have
 * the other status are changed; the returned rows count them.
 * `changedBefore` = products already switched earlier in the same click (for
 * the "N개만 바꾸고" message).
 */
async function updateStatus(
  ids: readonly string[],
  isActive: boolean,
  changedBefore: number
): Promise<{ ok: true; changed: number } | { ok: false; message: string }> {
  const supabase = await createClient()
  let changed = 0
  for (let start = 0; start < ids.length; start += STATUS_UPDATE_CHUNK) {
    const chunk = ids.slice(start, start + STATUS_UPDATE_CHUNK)
    const { data, error } = await supabase
      .from("products")
      .update({ is_active: isActive })
      .in("id", chunk)
      .eq("is_active", !isActive)
      .select("id")
    if (error) {
      console.error("Could not change product status:", error)
      const done = changedBefore + changed
      if (done > 0) revalidatePath("/products")
      if (error.code === "42501") {
        return {
          ok: false,
          message: "사용 여부를 바꿀 권한이 없습니다. 다시 로그인해 주세요.",
        }
      }
      // A 기준상품 was switched off by someone else a moment ago.
      const reason =
        error.hint === PRODUCT_DB_RULES.activationBlocked
          ? ACTIVATION_BLOCKED_MESSAGE
          : null
      return {
        ok: false,
        message:
          done > 0
            ? `${done}개만 바꾸고 나머지는 바꾸지 못했습니다. ${reason ?? "목록을 확인한 뒤 다시 시도해 주세요."}`
            : (reason ??
              "사용 여부를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요."),
      }
    }
    changed += data.length
  }
  return { ok: true, changed }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The database row for checked 기준상품 values. Only these columns are
 * written; id, created_at/by and updated_at/by are filled by the database,
 * product_type is 'base' by default (and never changes).
 */
function toBaseProductRow(
  values: BaseProductFormValues
): TablesInsert<"products"> {
  return {
    code: values.code,
    name: values.name,
    category_id: values.categoryId,
    spec: values.spec,
    unit: values.unit,
    storage_type: values.storageType,
    tax_type: values.taxType,
    // Prices are saved VAT-inclusive, exactly as typed (부가세 포함).
    purchase_price_incl_vat: values.purchasePriceInclVat,
    sale_price_incl_vat: values.salePriceInclVat,
    origin: values.origin,
    manufacturer: values.manufacturer,
    shelf_life_days: values.shelfLifeDays,
    barcode: values.barcode,
    allergens: values.allergens,
    is_active: values.isActive,
    note: values.note,
  }
}

/**
 * The `product` argument of create_bundle_product / update_bundle_product.
 * Prices are VAT-inclusive, exactly as typed (부가세 포함). A 묶음상품 has
 * no food fields: they are not sent (the database keeps them empty).
 */
function toBundleProductJson(values: BundleProductFormValues) {
  return {
    code: values.code,
    name: values.name,
    category_id: values.categoryId,
    spec: values.spec,
    unit: values.unit,
    purchase_price_incl_vat: values.purchasePriceInclVat,
    sale_price_incl_vat: values.salePriceInclVat,
    barcode: values.barcode,
    is_active: values.isActive,
    note: values.note,
  }
}

/** The `items` argument (구성표 in screen order). */
function toBundleItemsJson(values: BundleProductFormValues) {
  return values.items.map((item) => ({
    component_id: item.componentId,
    quantity: item.quantity,
  }))
}

/**
 * Ids of the 사용 묶음상품 containing any of these products, or [] when they
 * cannot be read (only used for counts in messages).
 */
async function activeBundleIdsOrEmpty(
  productIds: readonly string[]
): Promise<string[]> {
  try {
    return [...(await findActiveBundleIdsContaining(productIds))]
  } catch (error) {
    console.error("Could not read bundles:", error)
    return []
  }
}

/** How many of these products are 사용중지 now, or 0 when it cannot be read. */
async function countInactiveOrZero(
  productIds: readonly string[]
): Promise<number> {
  if (productIds.length === 0) return 0
  try {
    return await countInactiveProducts(productIds)
  } catch (error) {
    console.error("Could not count products:", error)
    return 0
  }
}

/**
 * Checks that a product may be put into this category (대분류, 중분류 or
 * 소분류): it exists, and it and every category above it are 사용 중.
 * Returns a Korean error message, or null when it is fine.
 */
async function checkCategory(categoryId: string): Promise<string | null> {
  const tree = await getCategoryTree({ includeInactive: true })
  // From the 대분류 down to the chosen category; empty when it is not found.
  const path = findCategoryPath(tree, categoryId)
  const category = path.at(-1)

  if (!category) return CATEGORY_NOT_FOUND_MESSAGE
  if (!category.isActive) {
    return "사용 중지된 분류입니다. 다른 분류를 선택해 주세요."
  }
  const inactiveAbove = path.find((above) => !above.isActive)
  if (inactiveAbove) {
    return `'${inactiveAbove.name}' 분류가 사용 중지되어 있어 그 아래 분류에는 상품을 넣을 수 없습니다. 다른 분류를 선택해 주세요.`
  }

  return null
}

function formFailed(message: string): ProductActionResult {
  return { ok: false, message, fieldErrors: {} }
}

function fieldFailed(fieldErrors: ProductFieldErrors): ProductActionResult {
  return { ok: false, message: CHECK_INPUT_MESSAGE, fieldErrors }
}

/**
 * The first message of each field from a zod validation error. A problem in
 * one 구성표 row (e.g. items[2].quantity) is reported under "items".
 */
function validationFailed(error: z.ZodError): ProductActionResult {
  const fieldErrors: ProductFieldErrors = {}
  for (const issue of error.issues) {
    const field = issue.path[0] as ProductFieldName | undefined
    if (field && !fieldErrors[field]) {
      fieldErrors[field] = issue.message
    }
  }
  if (Object.keys(fieldErrors).length === 0 && error.issues[0]) {
    return formFailed(error.issues[0].message)
  }
  return { ok: false, message: CHECK_INPUT_MESSAGE, fieldErrors }
}

/** Turns a database error into Korean messages for the form. */
function saveFailed(error: PostgrestError): ProductActionResult {
  // Rules checked by the database's own functions and triggers carry a key
  // in `hint` and a Korean message (naming the 상품코드) in `message`.
  switch (error.hint) {
    case PRODUCT_DB_RULES.typeFixed:
    case PRODUCT_DB_RULES.productNotBundle:
      return fieldFailed({ productType: PRODUCT_TYPE_FIXED_MESSAGE })
    case PRODUCT_DB_RULES.componentNotFound:
    case PRODUCT_DB_RULES.componentNotBase:
    case PRODUCT_DB_RULES.componentInactive:
    case PRODUCT_DB_RULES.itemParentNotBundle:
    case PRODUCT_DB_RULES.itemsEmpty:
    case PRODUCT_DB_RULES.itemsTooMany:
    case PRODUCT_DB_RULES.itemsDuplicate:
      return fieldFailed({ items: error.message })
    case PRODUCT_DB_RULES.activationBlocked:
      return fieldFailed({ isActive: error.message })
    case PRODUCT_DB_RULES.productNotFound:
    case PRODUCT_DB_RULES.bundleNotFound:
      return formFailed(PRODUCT_NOT_FOUND_MESSAGE)
    case PRODUCT_DB_RULES.productChanged:
      return formFailed(PRODUCT_CHANGED_MESSAGE)
    // Only an app from before prices became VAT-inclusive sends the old
    // price keys; the message asks the user to reload the page.
    case PRODUCT_DB_RULES.priceKeysRenamed:
      return formFailed(error.message)
  }

  // The constraint name is in `message` (Supabase leaves `details` empty).
  const text = `${error.message} ${error.details ?? ""}`

  // 23505 = unique_violation (a duplicate)
  if (error.code === "23505") {
    if (text.includes(PRODUCT_DB_CONSTRAINTS.codeUnique)) {
      return fieldFailed({ code: "이미 사용 중인 상품코드입니다." })
    }
    if (text.includes(PRODUCT_DB_CONSTRAINTS.barcodeUnique)) {
      return fieldFailed({ barcode: "이미 등록된 바코드입니다." })
    }
    if (text.includes(PRODUCT_DB_CONSTRAINTS.bundleItemUnique)) {
      return fieldFailed({ items: DUPLICATE_COMPONENT_MESSAGE })
    }
  }

  // 23503 = foreign_key_violation (the category or a 기준상품 is gone)
  if (error.code === "23503") {
    if (text.includes(PRODUCT_DB_CONSTRAINTS.categoryForeignKey)) {
      return fieldFailed({ categoryId: CATEGORY_NOT_FOUND_MESSAGE })
    }
    return fieldFailed({ items: COMPONENT_NOT_FOUND_MESSAGE })
  }

  // 23514 = check_violation (the form checks the same rules, so this only
  // happens when the rules were changed in one place only)
  if (error.code === "23514") {
    if (text.includes(PRODUCT_DB_CONSTRAINTS.bundleItemQuantity)) {
      return fieldFailed({
        items: "수량은 1~100,000 사이의 숫자로 입력해 주세요.",
      })
    }
    if (text.includes(PRODUCT_DB_CONSTRAINTS.productTypeFields)) {
      return fieldFailed({
        storageType: "기준상품은 보관온도와 과세구분을 꼭 선택해야 합니다.",
      })
    }
  }

  // 42501 = insufficient_privilege
  if (error.code === "42501") {
    return formFailed("상품을 저장할 권한이 없습니다. 다시 로그인해 주세요.")
  }

  console.error("Could not save product:", error)
  return formFailed(SAVE_FAILED_MESSAGE)
}
