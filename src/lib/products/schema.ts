/**
 * Input rules for 상품 (products), shared by the browser and the server:
 * - productFormSchema: the 상품 등록/수정 form, for both 상품유형
 *   (기준상품 / 묶음상품; a discriminated union on `productType`). The form
 *   checks it while the user types, and the Server Actions check it again
 *   before saving.
 * - Product list URL (search, filters, page, page size): parseProductListParams
 *   and buildProductListHref.
 * - 등록/수정 modal in the URL (?modal=new, ?modal=edit&id=<uuid>):
 *   parseProductModal and buildProductModalHref.
 * - 선택 사용중지 / 선택 사용: productIdsSchema.
 *
 * The database checks the same rules (see the products migrations). Keep both
 * in sync.
 */

import { z } from "zod"

import {
  ALLERGENS,
  BARCODE_PATTERN,
  BUNDLE_ITEM_QUANTITY,
  BUNDLE_ITEMS_MAX,
  EFFECTIVE_TAX_TYPES,
  PRODUCT_CODE_PATTERN,
  PRODUCT_LIMITS,
  UNITS,
  type Allergen,
  type EffectiveTaxType,
  type ProductType,
  type StorageType,
} from "@/lib/products/constants"
import { Constants, type Tables } from "@/types/database"

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Matches a UUID such as "3f1c2b9e-8a4d-4c1e-9f2a-1b2c3d4e5f60". */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Whether `value` is a UUID (the format of every `id` column). */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value)
}

/** Highest price the form accepts: 100억 원. */
export const PRICE_MAX = 10_000_000_000

/**
 * Adds thousands separators to a string of digits.
 * @example formatDigits("1234500") // "1,234,500"
 */
export function formatDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

/** A price from the database as form text, e.g. 12300 → "12,300", null → "". */
export function formatPriceInput(value: number | null): string {
  return value === null ? "" : formatDigits(String(value))
}

/**
 * The amount in a price box, or null when it is empty or not a valid price
 * (the form shows the error message for that case).
 * @example parsePriceInput("12,300") // 12300
 */
export function parsePriceInput(value: string): number | null {
  const digits = value.replace(/[,\s]/g, "")
  if (!/^\d+$/.test(digits)) return null
  const amount = Number(digits)
  return amount <= PRICE_MAX ? amount : null
}

const ALLERGEN_VALUES = ALLERGENS.map((allergen) => allergen.value) as [
  Allergen,
  ...Allergen[],
]

/** Text input. Not text at all (a broken request) gets `message`. */
function text(message: string) {
  return z.string({ error: message })
}

/** Optional text: trimmed, at most `max` characters, empty → null. */
function optionalText(max: number, tooLongMessage: string) {
  return text(tooLongMessage)
    .trim()
    .max(max, { error: tooLongMessage })
    .transform((value) => (value === "" ? null : value))
}

/**
 * Optional amount in won, typed with or without commas ("12,300").
 * Empty → null. Otherwise a whole number from 0 to PRICE_MAX.
 * `label` names the field in the messages, e.g. "기본 매입가(부가세 포함)"
 * → "기본 매입가(부가세 포함)는 0 이상의 숫자(원 단위)로 입력해 주세요."
 */
function optionalPrice(label: string) {
  const invalidMessage = `${label}는 0 이상의 숫자(원 단위)로 입력해 주세요.`
  return text(invalidMessage).transform((value, ctx) => {
    const digits = value.replace(/[,\s]/g, "")
    if (digits === "") return null
    if (!/^\d+$/.test(digits)) {
      ctx.addIssue({ code: "custom", message: invalidMessage })
      return z.NEVER
    }
    const amount = Number(digits)
    if (amount > PRICE_MAX) {
      ctx.addIssue({
        code: "custom",
        message: `${label}는 100억 원 이하로 입력해 주세요.`,
      })
      return z.NEVER
    }
    return amount
  })
}

// ---------------------------------------------------------------------------
// 상품 등록/수정 form
// ---------------------------------------------------------------------------

const shelfLifeMessage = `유통기한 기준일수는 ${PRODUCT_LIMITS.shelfLifeDaysMin}~${PRODUCT_LIMITS.shelfLifeDaysMax} 사이의 숫자로 입력해 주세요.`

const bundleQuantityMessage = `수량은 ${BUNDLE_ITEM_QUANTITY.min}~${formatDigits(String(BUNDLE_ITEM_QUANTITY.max))} 사이의 숫자로 입력해 주세요.`

const categoryMessage =
  "분류를 다시 선택해 주세요. ([분류적용]으로 고르거나 [분류해제]로 미분류로 둘 수 있습니다.)"

const productTypeMessage = "상품유형(기준상품/묶음상품)을 선택해 주세요."

const componentMessage = "구성상품을 다시 선택해 주세요."

/** Fields every product has (기준상품 and 묶음상품). */
const commonFields = {
  code: text("상품코드를 입력해 주세요.")
    .trim()
    .min(1, { error: "상품코드를 입력해 주세요." })
    .max(PRODUCT_LIMITS.codeMaxLength, {
      error: `상품코드는 ${PRODUCT_LIMITS.codeMaxLength}자 이하로 입력해 주세요.`,
    })
    .regex(PRODUCT_CODE_PATTERN, {
      error:
        "상품코드는 영문, 숫자, 하이픈(-), 밑줄(_), 마침표(.)만 쓸 수 있습니다. (띄어쓰기 불가)",
    }),
  name: text("상품명을 입력해 주세요.")
    .trim()
    .min(1, { error: "상품명을 입력해 주세요." })
    .max(PRODUCT_LIMITS.nameMaxLength, {
      error: `상품명은 ${PRODUCT_LIMITS.nameMaxLength}자 이하로 입력해 주세요.`,
    }),
  // A category on any level (대분류, 중분류 or 소분류), or "" for 미분류
  // (no category). The form fills it with the category picker.
  categoryId: text(categoryMessage).transform((value, ctx) => {
    if (value === "") return null
    if (!isUuid(value)) {
      ctx.addIssue({ code: "custom", message: categoryMessage })
      return z.NEVER
    }
    return value.toLowerCase()
  }),
  spec: optionalText(
    PRODUCT_LIMITS.specMaxLength,
    `규격은 ${PRODUCT_LIMITS.specMaxLength}자 이하로 입력해 주세요.`
  ),
  unit: text("단위를 선택해 주세요.").pipe(
    z.enum(UNITS, { error: "단위를 선택해 주세요." })
  ),
  // Prices are typed and saved VAT-INCLUSIVE (부가세 포함), exactly as
  // typed. The 부가세 별도 amount is only shown, never saved
  // (`@/lib/products/vat`).
  purchasePriceInclVat: optionalPrice("기본 매입가(부가세 포함)"),
  salePriceInclVat: optionalPrice("기본 판매가(부가세 포함)"),
  barcode: text("바코드는 숫자 8~14자리로 입력해 주세요.")
    .trim()
    .refine((value) => value === "" || BARCODE_PATTERN.test(value), {
      error: "바코드는 숫자 8~14자리로 입력해 주세요.",
    })
    .transform((value) => (value === "" ? null : value)),
  isActive: z.boolean({ error: "사용 여부를 선택해 주세요." }),
  note: optionalText(
    PRODUCT_LIMITS.noteMaxLength,
    `참고사항은 ${PRODUCT_LIMITS.noteMaxLength.toLocaleString("ko-KR")}자 이하로 입력해 주세요.`
  ),
}

/**
 * 기준상품 (개입). Besides the common fields it has the food information:
 * 보관온도*, 과세구분*, 원산지, 제조사/브랜드, 유통기한 기준일수, 알레르기.
 */
export const baseProductFormSchema = z.object({
  productType: z.literal("base", { error: productTypeMessage }),
  ...commonFields,
  storageType: text("보관온도를 선택해 주세요.").pipe(
    z.enum(Constants.public.Enums.storage_type, {
      error: "보관온도를 선택해 주세요.",
    })
  ),
  taxType: text("과세구분을 선택해 주세요.").pipe(
    z.enum(Constants.public.Enums.tax_type, {
      error: "과세구분을 선택해 주세요.",
    })
  ),
  origin: optionalText(
    PRODUCT_LIMITS.originMaxLength,
    `원산지는 ${PRODUCT_LIMITS.originMaxLength}자 이하로 입력해 주세요.`
  ),
  manufacturer: optionalText(
    PRODUCT_LIMITS.manufacturerMaxLength,
    `제조사/브랜드는 ${PRODUCT_LIMITS.manufacturerMaxLength}자 이하로 입력해 주세요.`
  ),
  shelfLifeDays: text(shelfLifeMessage)
    .trim()
    .transform((value, ctx) => {
      if (value === "") return null
      const days = /^\d{1,5}$/.test(value) ? Number(value) : NaN
      if (
        !(days >= PRODUCT_LIMITS.shelfLifeDaysMin) ||
        days > PRODUCT_LIMITS.shelfLifeDaysMax
      ) {
        ctx.addIssue({ code: "custom", message: shelfLifeMessage })
        return z.NEVER
      }
      return days
    }),
  allergens: z
    .array(text("알레르기 유발물질을 다시 선택해 주세요."), {
      error: "알레르기 유발물질을 다시 선택해 주세요.",
    })
    .pipe(
      z.array(
        z.enum(ALLERGEN_VALUES, {
          error: "목록에 없는 알레르기 유발물질입니다. 다시 선택해 주세요.",
        })
      )
    )
    // No duplicates, always in the order the law lists them.
    .transform((values) =>
      ALLERGEN_VALUES.filter((allergen) => values.includes(allergen))
    ),
})

/**
 * One row of a 묶음상품's 구성표: a 기준상품 (`componentId`) and how many of
 * it, in the 기준상품's own unit (typed with or without commas, "1,000").
 */
export const bundleItemSchema = z.object({
  componentId: text(componentMessage)
    .refine(isUuid, { error: componentMessage })
    .transform((value) => value.toLowerCase()),
  quantity: text(bundleQuantityMessage)
    .trim()
    .transform((value, ctx) => {
      const digits = value.replace(/[,\s]/g, "")
      if (digits === "") {
        ctx.addIssue({ code: "custom", message: "수량을 입력해 주세요." })
        return z.NEVER
      }
      const quantity = /^\d{1,7}$/.test(digits) ? Number(digits) : NaN
      if (
        !(quantity >= BUNDLE_ITEM_QUANTITY.min) ||
        quantity > BUNDLE_ITEM_QUANTITY.max
      ) {
        ctx.addIssue({ code: "custom", message: bundleQuantityMessage })
        return z.NEVER
      }
      return quantity
    }),
})

/**
 * 묶음상품. Besides the common fields it has its 구성표 (`items`): 1 to
 * BUNDLE_ITEMS_MAX 기준상품, each at most once, in screen order. It has no
 * food information of its own (worked out from the 기준상품, see
 * deriveBundleFoodInfo in `@/lib/products/bundle`). Whether each 기준상품
 * exists, is a 기준상품 and is 사용 is checked by the database.
 */
export const bundleProductFormSchema = z.object({
  productType: z.literal("bundle", { error: productTypeMessage }),
  ...commonFields,
  items: z
    .array(bundleItemSchema, { error: "구성상품을 다시 넣어 주세요." })
    .min(1, { error: "묶음상품에 넣을 기준상품을 1개 이상 추가해 주세요." })
    .max(BUNDLE_ITEMS_MAX, {
      error: `묶음상품 하나에 기준상품은 ${BUNDLE_ITEMS_MAX}종류까지 넣을 수 있습니다.`,
    })
    .superRefine((items, ctx) => {
      const seen = new Set<string>()
      for (const item of items) {
        if (seen.has(item.componentId)) {
          ctx.addIssue({
            code: "custom",
            message:
              "같은 기준상품을 두 번 넣을 수 없습니다. 한 줄로 합치고 수량을 늘려 주세요.",
          })
          return
        }
        seen.add(item.componentId)
      }
    }),
})

/** 기준상품 or 묶음상품, picked by `productType` (see productFormSchema). */
const productFormUnion = z.discriminatedUnion(
  "productType",
  [baseProductFormSchema, bundleProductFormSchema],
  { error: productTypeMessage }
)

/** What a 기준상품 form needs (see ProductFormInput for the whole form). */
export type BaseProductFormInput = z.input<typeof baseProductFormSchema>

/** What a 묶음상품 form needs (see ProductFormInput for the whole form). */
export type BundleProductFormInput = z.input<typeof bundleProductFormSchema>

/** One 구성표 row while the user is typing: { componentId, quantity: "6" }. */
export type BundleItemInput = z.input<typeof bundleItemSchema>

/**
 * What the 상품 form holds while the user is typing: ONE object with the
 * fields of both types (on 등록 the user may switch the type without losing
 * what was typed). Only the chosen type's fields are checked and saved.
 */
export type ProductFormInput = {
  [
    Key in keyof (Omit<BaseProductFormInput, "productType"> &
      Omit<BundleProductFormInput, "productType">)
  ]: (Omit<BaseProductFormInput, "productType"> &
    Omit<BundleProductFormInput, "productType">)[Key]
} & { productType: ProductType }

/** Checked form values, ready to save (기준상품 or 묶음상품). */
export type ProductFormValues = z.output<typeof productFormUnion>

/**
 * The 상품 등록/수정 form: 기준상품 or 묶음상품, picked by `productType`.
 * Input: what the form holds (text fields are strings, e.g. price "12,300").
 * Output: values ready to save (trimmed, empty optional text → null, prices
 * (부가세 포함), days and quantities → numbers, no category → null).
 * Fields of the other type and unknown keys (id, created_by, ...) are
 * dropped, so the form keeps one object with every field.
 *
 * Its input is typed as that whole form object (ProductFormInput), so
 * `zodResolver(productFormSchema)` fits `useForm<ProductFormInput, unknown,
 * ProductFormValues>`. (Zod alone would type the input as "기준상품 fields
 * OR 묶음상품 fields", which react-hook-form cannot use for one form.)
 */
export const productFormSchema = productFormUnion as unknown as z.ZodType<
  ProductFormValues,
  ProductFormInput
>

/** Checked 기준상품 values. */
export type BaseProductFormValues = z.output<typeof baseProductFormSchema>

/** Checked 묶음상품 values (`items` with numeric quantities). */
export type BundleProductFormValues = z.output<typeof bundleProductFormSchema>

/** Name of a field in the 상품 form, e.g. "code" or "items". */
export type ProductFieldName = keyof ProductFormInput

/**
 * One Korean error message per form field. Messages about the 구성표 as a
 * whole (none, duplicates, a 사용중지 or wrong 기준상품) are under "items".
 */
export type ProductFieldErrors = Partial<Record<ProductFieldName, string>>

/**
 * Starting values of the 상품 등록 form: a 기준상품 (the user may switch to
 * 묶음상품 before saving).
 * 보관온도, 과세구분 and 단위 start empty on purpose: the user must choose.
 * 분류 starts as 미분류; the 구성표 starts empty.
 */
export const emptyProductFormInput: ProductFormInput = {
  productType: "base",
  code: "",
  name: "",
  categoryId: "",
  spec: "",
  unit: "",
  storageType: "",
  taxType: "",
  purchasePriceInclVat: "",
  salePriceInclVat: "",
  origin: "",
  manufacturer: "",
  shelfLifeDays: "",
  barcode: "",
  allergens: [],
  isActive: true,
  note: "",
  items: [],
}

/**
 * A saved product as starting values of the 상품 수정 form. For a 묶음상품
 * pass its 구성표 as `components` (ProductDetail from getProduct has it).
 */
export function productToFormInput(
  product: Tables<"products"> & {
    components?: readonly { id: string; quantity: number }[]
  }
): ProductFormInput {
  return {
    productType: product.product_type,
    code: product.code,
    name: product.name,
    categoryId: product.category_id ?? "",
    spec: product.spec ?? "",
    unit: product.unit,
    storageType: product.storage_type ?? "",
    taxType: product.tax_type ?? "",
    purchasePriceInclVat: formatPriceInput(product.purchase_price_incl_vat),
    salePriceInclVat: formatPriceInput(product.sale_price_incl_vat),
    origin: product.origin ?? "",
    manufacturer: product.manufacturer ?? "",
    shelfLifeDays:
      product.shelf_life_days === null ? "" : String(product.shelf_life_days),
    barcode: product.barcode ?? "",
    allergens: product.allergens,
    isActive: product.is_active,
    note: product.note ?? "",
    items: (product.components ?? []).map((component) => ({
      componentId: component.id,
      quantity: formatDigits(String(component.quantity)),
    })),
  }
}

// ---------------------------------------------------------------------------
// 선택 사용중지 / 선택 사용 (checked rows of the list)
// ---------------------------------------------------------------------------

/** Most products one 선택 사용중지 / 선택 사용 may change (= biggest page). */
export const PRODUCT_BULK_MAX = 300

/** The ids of the checked products: 1 to PRODUCT_BULK_MAX UUIDs. */
export const productIdsSchema = z
  .array(
    text("상품을 다시 선택해 주세요.").refine(isUuid, {
      error: "상품을 다시 선택해 주세요.",
    }),
    { error: "상품을 다시 선택해 주세요." }
  )
  .min(1, { error: "먼저 상품을 체크해 주세요." })
  .max(PRODUCT_BULK_MAX, {
    error: `한 번에 ${PRODUCT_BULK_MAX}개까지 바꿀 수 있습니다.`,
  })
  // No duplicates; ids in lower case like the database returns them.
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))])

// ---------------------------------------------------------------------------
// Product list URL: /products?q=...&category=...&page=2&size=300
// ---------------------------------------------------------------------------

/** 사용 여부 filter of the list. Default: "active" (사용 중 only). */
export const PRODUCT_STATUS_FILTERS = [
  { value: "active", label: "사용" },
  { value: "inactive", label: "사용중지" },
  { value: "all", label: "전체" },
] as const

export type ProductStatusFilter =
  (typeof PRODUCT_STATUS_FILTERS)[number]["value"]

/**
 * Grid columns the list can be sorted by (a click on the column title).
 * `label` is the column title as the grid shows it. listProducts maps each
 * one to a column of the product_list_items view.
 */
export const PRODUCT_SORT_COLUMNS = [
  { value: "type", label: "구분" },
  { value: "code", label: "상품코드" },
  { value: "name", label: "상품명" },
  { value: "spec", label: "규격" },
  { value: "unit", label: "단위" },
  { value: "tax", label: "과세구분" },
  { value: "storage", label: "보관온도" },
  { value: "purchase_excl", label: "매입단가(부가세 별도)" },
  { value: "purchase_incl", label: "매입단가(부가세 포함)" },
  { value: "sale_excl", label: "판매단가(부가세 별도)" },
  { value: "sale_incl", label: "판매단가(부가세 포함)" },
  { value: "origin", label: "원산지" },
  { value: "status", label: "사용여부" },
] as const

export type ProductSortColumn = (typeof PRODUCT_SORT_COLUMNS)[number]["value"]

export type SortDirection = "asc" | "desc"

/**
 * Sort order of the list (URL param "sort"; default "code" = 상품코드순):
 * - a column key ("name", "sale_incl", …): that column, 오름차순 (▲);
 * - the key + "_desc" ("name_desc", …): that column, 내림차순 (▼);
 * - "recent": 최근 등록순 (newest first).
 * The old values "code", "name" and "recent" keep their meaning.
 */
export type ProductListSort =
  ProductSortColumn | `${ProductSortColumn}_desc` | "recent"

/** Every valid value of the "sort" URL param. */
const PRODUCT_LIST_SORT_VALUES: readonly ProductListSort[] = [
  ...PRODUCT_SORT_COLUMNS.flatMap(({ value }) => [
    value,
    `${value}_desc` as const,
  ]),
  "recent",
]

/**
 * The choices of the 정렬 select. The select also shows the current order
 * when it was chosen with a click on a column title (productSortLabel).
 */
export const PRODUCT_LIST_SORTS: readonly {
  value: ProductListSort
  label: string
}[] = [
  { value: "code", label: "상품코드순" },
  { value: "name", label: "상품명순" },
  { value: "recent", label: "최근 등록순" },
]

/** The column and direction of a sort, or null for "recent". */
export function productSortState(
  sort: ProductListSort
): { column: ProductSortColumn; direction: SortDirection } | null {
  if (sort === "recent") return null
  if (sort.endsWith("_desc")) {
    return {
      column: sort.slice(0, -"_desc".length) as ProductSortColumn,
      direction: "desc",
    }
  }
  return { column: sort as ProductSortColumn, direction: "asc" }
}

/**
 * The name of a sort order, e.g. "상품코드순", "판매단가(부가세 포함)
 * 내림차순 ▼".
 */
export function productSortLabel(sort: ProductListSort): string {
  const listed = PRODUCT_LIST_SORTS.find((option) => option.value === sort)
  if (listed) return listed.label
  const state = productSortState(sort)
  const column = PRODUCT_SORT_COLUMNS.find(
    (option) => option.value === state?.column
  )
  if (!state || !column) return sort
  return state.direction === "asc"
    ? `${column.label} 오름차순 ▲`
    : `${column.label} 내림차순 ▼`
}

/**
 * The sort after a click on a column title: 오름차순 (▲) → 내림차순 (▼) →
 * back to the default (상품코드순). The default is 상품코드 오름차순, so
 * the 상품코드 title switches between ▲ and ▼.
 */
export function nextColumnSort(
  current: ProductListSort,
  column: ProductSortColumn
): ProductListSort {
  const state = productSortState(current)
  if (state?.column !== column) return column
  if (state.direction === "asc") return `${column}_desc`
  return defaultProductListParams.sort
}

/** Rows per page the list offers (URL param "size"). Default 100. */
export const PRODUCT_PAGE_SIZES = [50, 100, 300] as const

export type ProductPageSize = (typeof PRODUCT_PAGE_SIZES)[number]

/** Longest search text that is used; anything longer is cut off. */
export const PRODUCT_SEARCH_MAX_LENGTH = 100

/** Most rows the 엑셀 download contains. */
export const PRODUCT_EXPORT_MAX_ROWS = 10_000

/** Highest page number accepted from the URL. */
const MAX_PAGE = 10_000

/** Search, filters, sort and page of the product list (all from the URL). */
export type ProductListParams = {
  /** Search text (상품코드, 상품명, 바코드, 제조사/브랜드). "" = no search. */
  q: string
  /**
   * 상품유형 (URL param "type"): "base" = 기준상품 only, "bundle" = 묶음상품
   * only, null = 전체.
   */
  productType: ProductType | null
  /**
   * Category id on any level (URL param "category"): shows the products of
   * this category and of every category below it.
   */
  categoryId: string | null
  /**
   * "미분류 상품만 보기" (URL param "uncategorized=1"): only products without
   * a category. When it is on, `categoryId` is always null.
   */
  uncategorized: boolean
  /** 보관온도 in effect (a 묶음상품's strictest; URL param "storage"). */
  storageType: StorageType | null
  /** 과세구분 in effect, including "mixed" = 혼합 (URL param "tax"). */
  taxType: EffectiveTaxType | null
  status: ProductStatusFilter
  sort: ProductListSort
  /** 1-based page number. */
  page: number
  /** Rows per page (URL param "size"). */
  pageSize: ProductPageSize
}

export const defaultProductListParams: ProductListParams = {
  q: "",
  productType: null,
  categoryId: null,
  uncategorized: false,
  storageType: null,
  taxType: null,
  status: "active",
  sort: "code",
  page: 1,
  pageSize: 100,
}

type SearchParamsRecord = Record<string, string | string[] | undefined>

/** First value of a search param (?a=1&a=2 → "1"). */
function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

function pickValue<T extends string>(
  value: string,
  allowed: readonly T[]
): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null
}

/**
 * Reads the list's search, filters, sort and page from the URL.
 * Anything missing or invalid falls back to the default, so a hand-edited
 * URL never breaks the page. (Unknown category ids are ignored later by
 * listProducts; page numbers past the end are clamped there.) The old
 * "major" param (from when there were two levels) and the modal params are
 * ignored.
 */
export function parseProductListParams(
  searchParams: SearchParamsRecord
): ProductListParams {
  const category = firstParam(searchParams.category)
  const page = firstParam(searchParams.page)
  const pageNumber = /^\d{1,6}$/.test(page) ? Number(page) : 1
  const size = Number(firstParam(searchParams.size))
  const uncategorized = ["1", "true"].includes(
    firstParam(searchParams.uncategorized)
  )

  return {
    q: firstParam(searchParams.q).trim().slice(0, PRODUCT_SEARCH_MAX_LENGTH),
    productType: pickValue(
      firstParam(searchParams.type),
      Constants.public.Enums.product_type
    ),
    categoryId:
      !uncategorized && isUuid(category) ? category.toLowerCase() : null,
    uncategorized,
    storageType: pickValue(
      firstParam(searchParams.storage),
      Constants.public.Enums.storage_type
    ),
    taxType: pickValue(
      firstParam(searchParams.tax),
      EFFECTIVE_TAX_TYPES.map((type) => type.value)
    ),
    status:
      pickValue(
        firstParam(searchParams.status),
        PRODUCT_STATUS_FILTERS.map((filter) => filter.value)
      ) ?? defaultProductListParams.status,
    sort:
      pickValue(firstParam(searchParams.sort), PRODUCT_LIST_SORT_VALUES) ??
      defaultProductListParams.sort,
    page: Math.min(Math.max(pageNumber, 1), MAX_PAGE),
    pageSize: PRODUCT_PAGE_SIZES.includes(size as ProductPageSize)
      ? (size as ProductPageSize)
      : defaultProductListParams.pageSize,
  }
}

/**
 * The search, filters and sort as URL params ("q=...&category=..."),
 * without page and page size. Default values are left out.
 * Used by the list URL and by the 엑셀 download URL.
 */
export function productListFilterQuery(
  params: ProductListParams
): URLSearchParams {
  const query = new URLSearchParams()
  if (params.q) query.set("q", params.q)
  if (params.productType) query.set("type", params.productType)
  if (params.uncategorized) {
    query.set("uncategorized", "1")
  } else if (params.categoryId) {
    query.set("category", params.categoryId)
  }
  if (params.storageType) query.set("storage", params.storageType)
  if (params.taxType) query.set("tax", params.taxType)
  if (params.status !== defaultProductListParams.status) {
    query.set("status", params.status)
  }
  if (params.sort !== defaultProductListParams.sort) {
    query.set("sort", params.sort)
  }
  return query
}

/**
 * The list URL for the given search, filters, sort, page and page size.
 * Default values are left out, so the plain list is just "/products".
 */
export function buildProductListHref(params: ProductListParams): string {
  const query = productListFilterQuery(params)
  if (params.page > 1) query.set("page", String(params.page))
  if (params.pageSize !== defaultProductListParams.pageSize) {
    query.set("size", String(params.pageSize))
  }

  const search = query.toString()
  return search ? `/products?${search}` : "/products"
}

/** The 엑셀 (CSV) download URL for the list's current search and filters. */
export function buildProductExportHref(params: ProductListParams): string {
  const search = productListFilterQuery(params).toString()
  return search ? `/products/export?${search}` : "/products/export"
}

/**
 * Whether any search or filter differs from the default list
 * (sort, page and page size do not count).
 */
export function hasProductListFilters(params: ProductListParams): boolean {
  return (
    params.q !== "" ||
    params.productType !== null ||
    params.categoryId !== null ||
    params.uncategorized ||
    params.storageType !== null ||
    params.taxType !== null ||
    params.status !== defaultProductListParams.status
  )
}

// ---------------------------------------------------------------------------
// 등록/수정 modal in the URL:
//   /products?modal=new                         상품 등록 (기준상품 selected)
//   /products?modal=new-bundle                  상품 등록 (묶음상품 selected)
//   /products?modal=new-bundle&base=<uuid>      … with this 기준상품 in the 구성표
//   /products?modal=edit&id=<uuid>              상품 수정
// ---------------------------------------------------------------------------

/**
 * Which 상품 modal is open.
 * - "new": `productType` is the type selected at the start (default
 *   기준상품); `baseProductId` = a 기준상품 to put into the new 묶음상품's
 *   구성표 right away ([묶음상품 추가] in a 기준상품's 묶음상품 tab). It may
 *   be invalid; the modal then starts with an empty 구성표.
 * - "edit": `id` is the text from the URL; it may be invalid (the modal then
 *   says the product was not found).
 */
export type ProductModalState =
  | { mode: "new"; productType?: ProductType; baseProductId?: string }
  | { mode: "edit"; id: string }

/** The open modal from the URL params, or null when none is open. */
export function parseProductModal(
  searchParams: Pick<URLSearchParams, "get">
): ProductModalState | null {
  const modal = searchParams.get("modal")
  if (modal === "new") return { mode: "new", productType: "base" }
  if (modal === "new-bundle") {
    const base = searchParams.get("base")
    return {
      mode: "new",
      productType: "bundle",
      ...(isUuid(base) ? { baseProductId: base.toLowerCase() } : {}),
    }
  }
  if (modal === "edit")
    return { mode: "edit", id: searchParams.get("id") ?? "" }
  return null
}

/**
 * The list URL with this modal open (or closed, for null), keeping every
 * other param of `currentSearch` (filters, page).
 * @example buildProductModalHref("?q=양파", { mode: "new" }) // "/products?q=양파&modal=new"
 */
export function buildProductModalHref(
  currentSearch: string,
  modal: ProductModalState | null
): string {
  const query = new URLSearchParams(currentSearch)
  query.delete("modal")
  query.delete("id")
  query.delete("base")
  if (modal?.mode === "edit") {
    query.set("modal", "edit")
    query.set("id", modal.id)
  } else if (modal?.mode === "new") {
    if (modal.productType === "bundle") {
      query.set("modal", "new-bundle")
      if (modal.baseProductId) query.set("base", modal.baseProductId)
    } else {
      query.set("modal", "new")
    }
  }
  const search = query.toString()
  return search ? `/products?${search}` : "/products"
}
