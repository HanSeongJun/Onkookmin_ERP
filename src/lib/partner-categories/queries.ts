import "server-only"

import { cache } from "react"

import {
  buildPartnerCategoryTree,
  type PartnerCategoryNode,
} from "@/lib/partner-categories/tree"
import { createClient } from "@/lib/supabase/server"

// The tree type and its helpers live in ./tree.ts (usable in Client
// Components too).
export type { PartnerCategoryNode } from "@/lib/partner-categories/tree"

/**
 * Every 거래처분류 as a tree (대분류 → 중분류 → 소분류), 사용 and 사용 중지
 * alike, each level sorted by sortOrder, then name, with the number of
 * partners directly in each one. Pickers hide switched-off branches
 * themselves (isCategorySelectable).
 *
 * Wrapped in React `cache()`: a page and the list query share one read per
 * request. Reads request cookies (Supabase login): call it inside a
 * <Suspense> boundary, a Route Handler or a Server Action, never inside
 * "use cache".
 */
export const getPartnerCategoryTree = cache(
  async (): Promise<PartnerCategoryNode[]> => {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("partner_categories")
      .select("id, name, parent_id, sort_order, is_active, partners(count)")
      .order("sort_order")
      .order("name")
      .order("id")
    if (error) {
      throw new Error(`거래처분류를 불러오지 못했습니다: ${error.message}`)
    }

    return buildPartnerCategoryTree(
      data.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parent_id,
        sortOrder: row.sort_order,
        isActive: row.is_active,
        partnerCount: row.partners[0]?.count ?? 0,
      }))
    )
  }
)

/**
 * A short text that changes whenever any 거래처분류 is added, changed or
 * deleted (database function partner_category_tree_version). The 분류값
 * 설정 window keeps it and hands it to savePartnerCategories, which refuses
 * to save when someone changed the categories in the meantime.
 */
export async function getPartnerCategoryTreeVersion(): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("partner_category_tree_version")
  if (error) {
    throw new Error(`거래처분류를 불러오지 못했습니다: ${error.message}`)
  }
  return data
}
