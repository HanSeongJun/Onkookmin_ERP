import "server-only"

import { buildCategoryTree, type CategoryNode } from "@/lib/categories/tree"
import { createClient } from "@/lib/supabase/server"

// The tree types live in ./tree.ts (usable in Client Components too).
export type { CategoryDepth, CategoryNode } from "@/lib/categories/tree"

/**
 * All 상품 분류 as a tree: 대분류 → 중분류 → 소분류.
 * Every level is sorted by sortOrder, then by name.
 *
 * @param options.includeInactive also return categories switched off
 *   (사용 중지). Default false: a switched-off category is left out together
 *   with everything under it (e.g. the 소분류 of a switched-off 중분류).
 *
 * Reads request cookies (Supabase login): render the calling component inside
 * a <Suspense> boundary.
 */
export async function getCategoryTree(
  options: { includeInactive?: boolean } = {}
): Promise<CategoryNode[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("product_categories")
    .select("id, name, parent_id, sort_order, is_active, products(count)")
    .order("sort_order")
    .order("name")
  if (error) {
    throw new Error(`상품 분류를 불러오지 못했습니다: ${error.message}`)
  }

  const records = data.map((row) => ({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    productCount: row.products[0]?.count ?? 0,
  }))
  return buildCategoryTree(records, options)
}
