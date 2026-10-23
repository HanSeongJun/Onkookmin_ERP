/**
 * Input rules and messages for 상품 분류 (product categories), used by the
 * Server Actions in ./actions.ts and by the 상품분류설정 screen
 * (/products/categories). The database checks the same rules
 * (product_categories table in supabase/migrations/).
 *
 * Categories are optional: a product without one is "미분류" (uncategorized).
 *
 * No server imports here: Client Components use this file too.
 */

import { z } from "zod"

import {
  CATEGORY_LEVEL_LABELS,
  countProductsInSubtree,
  MAX_CATEGORY_DEPTH,
  type CategoryDepth,
  type CategoryNode,
} from "@/lib/categories/tree"
import { PRODUCT_LIMITS } from "@/lib/products/constants"

const NAME_MAX_LENGTH = PRODUCT_LIMITS.categoryNameMaxLength

/** Shown when a category id is missing or malformed (e.g. an old page). */
export const CATEGORY_NOT_FOUND_MESSAGE =
  "분류를 찾을 수 없습니다. 이미 삭제되었을 수 있으니 화면을 새로 고친 뒤 다시 시도해 주세요."

/** Shown when two categories under the same parent would get the same name. */
export const CATEGORY_DUPLICATE_NAME_MESSAGE =
  "같은 이름의 분류가 이미 있습니다."

/**
 * Shown when someone tries to add a category under a 소분류.
 * Same text as the database trigger's message.
 */
export const CATEGORY_TOO_DEEP_MESSAGE =
  "소분류 아래에는 분류를 만들 수 없습니다. 분류는 대분류 → 중분류 → 소분류 3단계까지입니다."

/**
 * How to empty a category that still has products: products may be
 * uncategorized (미분류), so they can be moved out of it.
 */
export const CATEGORY_MOVE_PRODUCTS_HINT =
  "삭제하려면 먼저 상품관리에서 그 상품들을 다른 분류로 옮기거나 미분류로 바꿔 주세요(상품 수정 창의 ‘분류해제’)."

/** What to do instead of deleting a category that is still in use. */
export const CATEGORY_DEACTIVATE_HINT =
  "더 이상 쓰지 않는 분류라면 삭제 대신 ‘사용 중지’를 해 주세요. 사용 중지한 분류와 그 아래 분류는 상품을 등록·수정할 때 새로 고를 수 없고, 이미 등록된 상품은 그대로 남습니다."

/** A category id (uuid). */
export const categoryIdSchema = z.guid({ error: CATEGORY_NOT_FOUND_MESSAGE })

/**
 * 분류 이름: spaces at both ends are removed; 1–30 characters.
 * normalize("NFC") turns pasted, decomposed Hangul (e.g. copied from a macOS
 * Finder file name) into the usual form, so a name that looks the same as a
 * sibling's also counts as the same name (the database checks this form).
 */
export const categoryNameSchema = z
  .string({ error: "분류 이름을 입력해 주세요." })
  .trim()
  .normalize("NFC")
  .min(1, { error: "분류 이름을 입력해 주세요." })
  .max(NAME_MAX_LENGTH, {
    error: `분류 이름은 ${NAME_MAX_LENGTH}자 이내로 입력해 주세요.`,
  })

/**
 * Add a 대분류 (`parentId` null), a 중분류 (`parentId` = its 대분류) or a
 * 소분류 (`parentId` = its 중분류).
 */
export const createCategorySchema = z.object({
  name: categoryNameSchema,
  parentId: categoryIdSchema.nullable(),
})
export type CreateCategoryInput = z.input<typeof createCategorySchema>

/** Change a category's name. */
export const renameCategorySchema = z.object({
  id: categoryIdSchema,
  name: categoryNameSchema,
})
export type RenameCategoryInput = z.input<typeof renameCategorySchema>

/** Move a category one place up or down among its siblings. */
export const moveCategorySchema = z.object({
  id: categoryIdSchema,
  direction: z.enum(["up", "down"]),
})
export type MoveCategoryInput = z.input<typeof moveCategorySchema>

/** Switch a category on (사용) or off (사용 중지). */
export const setCategoryActiveSchema = z.object({
  id: categoryIdSchema,
  isActive: z.boolean(),
})
export type SetCategoryActiveInput = z.input<typeof setCategoryActiveSchema>

/** Delete a category that is not used. */
export const deleteCategorySchema = z.object({
  id: categoryIdSchema,
})
export type DeleteCategoryInput = z.input<typeof deleteCategorySchema>

/**
 * Korean name of the level right below a category: "중분류" under a 대분류,
 * "소분류" under a 중분류. A 소분류 has nothing below it ("하위 분류" is only
 * a fallback).
 */
export function childLevelLabel(depth: CategoryDepth): string {
  if (depth >= MAX_CATEGORY_DEPTH) return "하위 분류"
  return CATEGORY_LEVEL_LABELS[depth === 1 ? 2 : 3]
}

/**
 * Why a category cannot be deleted, or null when it can.
 * A category can be deleted only when no product is put directly into it
 * (switched-off products count too) and it has no sub-categories. (The
 * products of its sub-categories block it through those sub-categories.)
 *
 * @param category.depth its level: 1 = 대분류, 2 = 중분류, 3 = 소분류
 * @param category.childCount its sub-categories (one level down)
 * @param category.productCount products put directly into it
 * @example getCategoryDeleteBlockReason({ depth: 1, childCount: 3, productCount: 0 })
 *   // "이 분류 아래에 중분류 3개가 있어서 삭제할 수 없습니다."
 * @example getCategoryDeleteBlockReason({ depth: 3, childCount: 0, productCount: 2 })
 *   // "이 분류에 상품 2개가 있어서 삭제할 수 없습니다. 삭제하려면 먼저 …"
 */
export function getCategoryDeleteBlockReason({
  depth,
  childCount,
  productCount,
}: {
  depth: CategoryDepth
  childCount: number
  productCount: number
}): string | null {
  const children = `${childLevelLabel(depth)} ${childCount}개`

  if (childCount > 0 && productCount > 0) {
    return `이 분류 아래에 ${children}가 있고, 이 분류에 직접 넣은 상품도 ${productCount}개 있어서 삭제할 수 없습니다.`
  }
  if (childCount > 0) {
    return `이 분류 아래에 ${children}가 있어서 삭제할 수 없습니다.`
  }
  if (productCount > 0) {
    return `이 분류에 상품 ${productCount}개가 있어서 삭제할 수 없습니다. ${CATEGORY_MOVE_PRODUCTS_HINT}`
  }
  return null
}

/**
 * Short summary of what a category holds, shown in its delete dialog on the
 * 상품분류설정 screen (the same numbers as the row's 상품 수 columns).
 * Product counts include switched-off products.
 *
 * - without sub-categories: "상품 3개"
 * - with sub-categories: "소분류 3개 · 상품 7개 (이 분류에 직접 1개)" — the
 *   first number counts the products of all categories below it too, the one
 *   in brackets only those put directly into this category.
 */
export function describeCategoryContents(category: CategoryNode): string {
  if (category.children.length === 0) {
    return `상품 ${category.productCount}개`
  }
  const children = `${childLevelLabel(category.depth)} ${category.children.length}개`
  const products = `상품 ${countProductsInSubtree(category)}개 (이 분류에 직접 ${category.productCount}개)`
  return `${children} · ${products}`
}
