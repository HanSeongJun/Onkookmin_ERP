"use server"

import type { PostgrestError } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"
import type { z } from "zod"

import { requireUser } from "@/lib/auth/user"
import {
  CATEGORY_DEACTIVATE_HINT,
  CATEGORY_DUPLICATE_NAME_MESSAGE,
  CATEGORY_NOT_FOUND_MESSAGE,
  CATEGORY_TOO_DEEP_MESSAGE,
  createCategorySchema,
  deleteCategorySchema,
  getCategoryDeleteBlockReason,
  moveCategorySchema,
  renameCategorySchema,
  setCategoryActiveSchema,
  type CreateCategoryInput,
  type DeleteCategoryInput,
  type MoveCategoryInput,
  type RenameCategoryInput,
  type SetCategoryActiveInput,
} from "@/lib/categories/schema"
import {
  CATEGORY_LEVEL_LABELS,
  MAX_CATEGORY_DEPTH,
  type CategoryDepth,
} from "@/lib/categories/tree"
import { PRODUCT_DB_CONSTRAINTS } from "@/lib/products/constants"
import { createClient } from "@/lib/supabase/server"

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * What every 분류 Server Action returns.
 * `message` / `error` are Korean texts to show to the user.
 */
export type CategoryActionResult =
  { ok: true; message?: string } | { ok: false; error: string }

/**
 * Adds a 대분류 (`parentId` null), a 중분류 under a 대분류 or a 소분류 under
 * a 중분류. The new category goes to the end of its list.
 */
export async function createCategory(
  input: CreateCategoryInput
): Promise<CategoryActionResult> {
  await requireUser()
  const parsed = createCategorySchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)
  const { name, parentId } = parsed.data

  const supabase = await createClient()

  // Level of the new category: one below its parent.
  let depth: CategoryDepth = 1
  if (parentId !== null) {
    // The database also checks this, but here we can give a clear message.
    const { data: parentChain, error } = await selectCategoryWithParents(
      supabase,
      parentId
    )
    if (error) return databaseError(error, "분류를 추가하지 못했습니다.")
    if (parentChain.length === 0) {
      return { ok: false, error: CATEGORY_NOT_FOUND_MESSAGE }
    }
    if (parentChain.length >= MAX_CATEGORY_DEPTH) {
      return { ok: false, error: CATEGORY_TOO_DEEP_MESSAGE }
    }
    depth = parentChain.length === 1 ? 2 : 3
  }

  const { data: siblings, error: siblingsError } = await selectSiblingsInOrder(
    supabase,
    parentId
  )
  if (siblingsError) {
    return databaseError(siblingsError, "분류를 추가하지 못했습니다.")
  }
  const lastSortOrder = siblings.reduce(
    (max, sibling) => Math.max(max, sibling.sort_order),
    0
  )

  const { error } = await supabase.from("product_categories").insert({
    name,
    parent_id: parentId,
    sort_order: lastSortOrder + 1,
  })
  // 23503 = the parent category was deleted a moment ago.
  if (error?.code === "23503") {
    return { ok: false, error: CATEGORY_NOT_FOUND_MESSAGE }
  }
  if (error) return databaseError(error, "분류를 추가하지 못했습니다.")

  revalidateProductPages()
  return {
    ok: true,
    message: `‘${name}’ ${CATEGORY_LEVEL_LABELS[depth]}를 추가했습니다.`,
  }
}

/** Changes a category's name. */
export async function renameCategory(
  input: RenameCategoryInput
): Promise<CategoryActionResult> {
  await requireUser()
  const parsed = renameCategorySchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)
  const { id, name } = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("product_categories")
    .update({ name })
    .eq("id", id)
    .select("id")
  if (error) return databaseError(error, "분류 이름을 바꾸지 못했습니다.")
  if (data.length === 0) return { ok: false, error: CATEGORY_NOT_FOUND_MESSAGE }

  revalidateProductPages()
  return { ok: true, message: "분류 이름을 바꿨습니다." }
}

/**
 * Moves a category one place up or down among its siblings: the other
 * 대분류, the other 중분류 of the same 대분류, or the other 소분류 of the
 * same 중분류.
 */
export async function moveCategory(
  input: MoveCategoryInput
): Promise<CategoryActionResult> {
  await requireUser()
  const parsed = moveCategorySchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)
  const { id, direction } = parsed.data

  const supabase = await createClient()
  const { data: category, error } = await supabase
    .from("product_categories")
    .select("id, parent_id")
    .eq("id", id)
    .maybeSingle()
  if (error) return databaseError(error, "순서를 바꾸지 못했습니다.")
  if (!category) return { ok: false, error: CATEGORY_NOT_FOUND_MESSAGE }

  const { data: siblings, error: siblingsError } = await selectSiblingsInOrder(
    supabase,
    category.parent_id
  )
  if (siblingsError) {
    return databaseError(siblingsError, "순서를 바꾸지 못했습니다.")
  }

  const from = siblings.findIndex((sibling) => sibling.id === id)
  const to = direction === "up" ? from - 1 : from + 1
  if (from === -1 || to < 0 || to >= siblings.length) {
    // Already first (or last): nothing to move.
    return { ok: true }
  }

  // Take the category out and put it back one place earlier or later.
  const reordered = siblings.filter((sibling) => sibling.id !== id)
  reordered.splice(to, 0, siblings[from])

  // Number the list 1, 2, 3, ... again and save only the rows that changed
  // (normally just the two categories that swapped places).
  for (const [index, sibling] of reordered.entries()) {
    const sortOrder = index + 1
    if (sibling.sort_order === sortOrder) continue

    const { error: updateError } = await supabase
      .from("product_categories")
      .update({ sort_order: sortOrder })
      .eq("id", sibling.id)
    if (updateError) {
      revalidateProductPages()
      return databaseError(updateError, "순서를 바꾸지 못했습니다.")
    }
  }

  revalidateProductPages()
  return { ok: true }
}

/**
 * Switches a category on (사용) or off (사용 중지).
 * A switched-off category can't be chosen for new or edited products, and
 * neither can any category under it. Existing products keep their category.
 */
export async function setCategoryActive(
  input: SetCategoryActiveInput
): Promise<CategoryActionResult> {
  await requireUser()
  const parsed = setCategoryActiveSchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)
  const { id, isActive } = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("product_categories")
    .update({ is_active: isActive })
    .eq("id", id)
    .select("name")
  if (error) return databaseError(error, "사용 여부를 바꾸지 못했습니다.")
  const category = data[0]
  if (!category) return { ok: false, error: CATEGORY_NOT_FOUND_MESSAGE }

  revalidateProductPages()

  // The rest only picks the wording of the message. If one of these reads
  // fails, the change is still saved, so the short message is shown.
  if (!isActive) {
    const { count } = await supabase
      .from("product_categories")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", id)
    const what = (count ?? 0) > 0 ? "이 분류와 그 아래 분류를" : "이 분류를"
    return {
      ok: true,
      message: `‘${category.name}’ 분류를 사용 중지했습니다. 이제 상품을 등록·수정할 때 ${what} 새로 고를 수 없습니다.`,
    }
  }

  // Switched on again, but categories above it may still be switched off:
  // name all of them, from the 대분류 down.
  const { data: chain } = await selectCategoryWithParents(supabase, id)
  const switchedOffParents = chain
    .slice(1)
    .filter((parent) => !parent.is_active)
    .reverse()
  const names = switchedOffParents
    .map((parent) => `‘${parent.name}’`)
    .join(", ")
  return {
    ok: true,
    message:
      switchedOffParents.length > 0
        ? `‘${category.name}’ 분류를 다시 사용합니다. 다만 위 분류 ${names}도 다시 사용해야 상품을 등록·수정할 때 고를 수 있습니다.`
        : `‘${category.name}’ 분류를 다시 사용합니다.`,
  }
}

/**
 * Deletes a category. Only works when no product is put directly into it and
 * it has no sub-categories; otherwise the user is told why and to switch it
 * off instead.
 */
export async function deleteCategory(
  input: DeleteCategoryInput
): Promise<CategoryActionResult> {
  await requireUser()
  const parsed = deleteCategorySchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)
  const { id } = parsed.data

  const supabase = await createClient()
  const [categoryResult, childrenResult, chainResult] = await Promise.all([
    supabase
      .from("product_categories")
      .select("name, products(count)")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("product_categories")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", id),
    selectCategoryWithParents(supabase, id),
  ])
  if (categoryResult.error) {
    return databaseError(categoryResult.error, "분류를 삭제하지 못했습니다.")
  }
  if (childrenResult.error) {
    return databaseError(childrenResult.error, "분류를 삭제하지 못했습니다.")
  }
  if (chainResult.error) {
    return databaseError(chainResult.error, "분류를 삭제하지 못했습니다.")
  }
  const category = categoryResult.data
  // Its level: 1 = 대분류, 2 = 중분류, 3 = 소분류.
  const depth = chainResult.data.length
  if (!category || depth < 1 || depth > MAX_CATEGORY_DEPTH) {
    return { ok: false, error: CATEGORY_NOT_FOUND_MESSAGE }
  }

  const blockReason = getCategoryDeleteBlockReason({
    depth: depth as CategoryDepth,
    childCount: childrenResult.count ?? 0,
    productCount: category.products[0]?.count ?? 0,
  })
  if (blockReason) {
    return { ok: false, error: `${blockReason} ${CATEGORY_DEACTIVATE_HINT}` }
  }

  const { data: deleted, error } = await supabase
    .from("product_categories")
    .delete()
    .eq("id", id)
    .select("id")
  if (error) {
    // 23503 = a product or sub-category was added to it a moment ago
    // (the database refuses to delete a category that is still used).
    if (error.code === "23503") {
      return {
        ok: false,
        error: `방금 이 분류에 상품이나 아래 분류가 추가되어 삭제할 수 없습니다. ${CATEGORY_DEACTIVATE_HINT}`,
      }
    }
    return databaseError(error, "분류를 삭제하지 못했습니다.")
  }
  if (deleted.length === 0) {
    return { ok: false, error: CATEGORY_NOT_FOUND_MESSAGE }
  }

  revalidateProductPages()
  return { ok: true, message: `‘${category.name}’ 분류를 삭제했습니다.` }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The categories that share a parent (all 대분류 when `parentId` is null),
 * in the order they are shown: sort_order, then name.
 */
function selectSiblingsInOrder(
  supabase: SupabaseServerClient,
  parentId: string | null
) {
  const query = supabase
    .from("product_categories")
    .select("id, sort_order")
    .order("sort_order")
    .order("name")
  return parentId === null
    ? query.is("parent_id", null)
    : query.eq("parent_id", parentId)
}

type CategoryChainRow = {
  id: string
  name: string
  parent_id: string | null
  is_active: boolean
}

/**
 * The category followed by the categories above it, up to its 대분류:
 * e.g. [엽채류, 채소, 농산물] for the 소분류 엽채류. The length is the
 * category's level (1 = 대분류, 2 = 중분류, 3 = 소분류). Empty when the
 * category doesn't exist.
 */
async function selectCategoryWithParents(
  supabase: SupabaseServerClient,
  id: string
): Promise<{ data: CategoryChainRow[]; error: PostgrestError | null }> {
  const chain: CategoryChainRow[] = []
  let nextId: string | null = id

  // At most 3 steps: the database never allows a fourth level. The extra
  // step only stops the loop if the data were ever broken.
  while (nextId !== null && chain.length <= MAX_CATEGORY_DEPTH) {
    const currentId: string = nextId
    const { data, error } = await supabase
      .from("product_categories")
      .select("id, name, parent_id, is_active")
      .eq("id", currentId)
      .maybeSingle()
    if (error) return { data: [], error }
    // Missing (deleted a moment ago): treat the category as not found.
    if (!data) return { data: [], error: null }
    chain.push(data)
    nextId = data.parent_id
  }
  return { data: chain, error: null }
}

/**
 * Categories appear on every 상품 page (목록 필터, 등록·수정 창의 분류 선택,
 * 상품분류설정), so refresh all pages under /products. "(app)" is the route
 * group folder in src/app that these pages live in.
 */
function revalidateProductPages() {
  revalidatePath("/(app)/products", "layout")
}

/** The first validation message, e.g. "분류 이름을 입력해 주세요." */
function invalidInput(error: z.ZodError): CategoryActionResult {
  return {
    ok: false,
    error: error.issues[0]?.message ?? "입력한 내용을 확인해 주세요.",
  }
}

/**
 * Parts of the Korean messages raised by the database trigger
 * check_product_category_parent() (supabase/migrations/*_create_products.sql):
 * a fourth level ("… 3단계까지입니다."), or a category moved under itself
 * ("… 자기 자신이나 …"). They are written for users, so they are shown as
 * they are.
 */
const TREE_RULE_MESSAGE_PARTS = ["3단계까지", "자기 자신"]

/**
 * Turns a database error into a Korean message. A duplicate name and the
 * 3-level rule get their own messages; anything else is logged on the server
 * and shown as `failedTo` + "잠시 후 다시 시도해 주세요."
 */
function databaseError(
  error: PostgrestError,
  failedTo: string
): CategoryActionResult {
  // 23505 = unique constraint: the constraint name is in error.message.
  if (
    error.code === "23505" &&
    error.message.includes(PRODUCT_DB_CONSTRAINTS.categoryNameUnique)
  ) {
    return { ok: false, error: CATEGORY_DUPLICATE_NAME_MESSAGE }
  }

  // 23514 = check_violation. The trigger above uses it for the 3-level rule
  // (a CHECK constraint uses the same code, with an English message).
  if (
    error.code === "23514" &&
    TREE_RULE_MESSAGE_PARTS.some((part) => error.message.includes(part))
  ) {
    return {
      ok: false,
      error: `${error.message} 화면을 새로 고쳐 지금의 분류를 확인해 주세요.`,
    }
  }

  console.error(`Category action failed (${failedTo}):`, error)
  return { ok: false, error: `${failedTo} 잠시 후 다시 시도해 주세요.` }
}
