/**
 * 거래처분류 (partner categories) as a tree: 대분류 → 중분류 → 소분류, the
 * same three levels as 상품 분류.
 *
 * - PartnerCategoryNode: one category with its sub-categories, as
 *   getPartnerCategoryTree() (@/lib/partner-categories/queries) returns it.
 * - The path/search helpers of the 상품 분류 tree work on it too (they are
 *   re-exported here): findCategoryPath, formatCategoryPath, …
 * - The 분류값 설정 window edits a copy of the tree (a "draft") and saves
 *   all changes at once: toPartnerCategoryDraft, addDraftCategory,
 *   updateDraftCategory, moveDraftCategory, removeDraftCategories,
 *   validatePartnerCategoryDraft, buildPartnerCategoryChanges.
 *
 * Plain data work without the database: Client Components use this file.
 */

import {
  MAX_CATEGORY_DEPTH,
  findCategoryPath,
  formatCategoryPath,
  type CategoryDepth,
} from "@/lib/categories/tree"

export {
  CATEGORY_LEVEL_LABELS,
  MAX_CATEGORY_DEPTH,
  collectDescendantIds,
  findCategory,
  findCategoryPath,
  flattenCategoryTree,
  formatCategoryPath,
  isCategorySelectable,
  type CategoryDepth,
  type CategoryTreeNode,
} from "@/lib/categories/tree"

/** Text shown for a partner without a 거래처분류. */
export const UNCATEGORIZED_PARTNER_LABEL = "미분류"

/** Longest 거래처분류 name (the database checks the same). */
export const PARTNER_CATEGORY_NAME_MAX_LENGTH = 30

/**
 * One 거래처분류 with its sub-categories. A 대분류 has `parentId === null`
 * and depth 1; a 중분류 (depth 2) sits under a 대분류; a 소분류 (depth 3)
 * under a 중분류 and has no children.
 */
export type PartnerCategoryNode = {
  id: string
  name: string
  parentId: string | null
  /** Order among the categories with the same parent (small first). */
  sortOrder: number
  /**
   * Its own 사용 여부. A category can only be newly chosen for a partner
   * when it AND every category above it are 사용 (isCategorySelectable).
   */
  isActive: boolean
  /** 1 = 대분류, 2 = 중분류, 3 = 소분류. */
  depth: CategoryDepth
  /**
   * Partners directly in this category (사용 and 미사용), not counting the
   * ones in its sub-categories (countPartnersInSubtree).
   */
  partnerCount: number
  /** Sub-categories in display order (always empty for a 소분류). */
  children: PartnerCategoryNode[]
}

/** One category as read from the database, before it is put in the tree. */
export type PartnerCategoryRecord = Omit<
  PartnerCategoryNode,
  "depth" | "children"
>

/**
 * Builds the tree from a flat list (every category, 사용 and 사용 중지),
 * each level in the given order (sort_order, then name, as the database
 * query returns them). Pickers hide switched-off branches themselves.
 */
export function buildPartnerCategoryTree(
  records: readonly PartnerCategoryRecord[]
): PartnerCategoryNode[] {
  const childrenByParent = new Map<string | null, PartnerCategoryRecord[]>()
  for (const record of records) {
    const siblings = childrenByParent.get(record.parentId) ?? []
    siblings.push(record)
    childrenByParent.set(record.parentId, siblings)
  }

  function buildLevel(
    parentId: string | null,
    depth: CategoryDepth
  ): PartnerCategoryNode[] {
    return (childrenByParent.get(parentId) ?? []).map((record) => ({
      ...record,
      depth,
      // A 소분류 has no children: the database allows no fourth level.
      children:
        depth === MAX_CATEGORY_DEPTH
          ? []
          : buildLevel(record.id, depth === 1 ? 2 : 3),
    }))
  }

  return buildLevel(null, 1)
}

/** Partners in this category and in every category below it. */
export function countPartnersInSubtree(node: PartnerCategoryNode): number {
  return node.children.reduce(
    (sum, child) => sum + countPartnersInSubtree(child),
    node.partnerCount
  )
}

/**
 * A partner's category as text: "오프라인 거래처 > 외식업 > 주요 거래처",
 * "미분류" for null, "-" when the id is not in the tree (deleted meanwhile).
 */
export function partnerCategoryPathText(
  tree: PartnerCategoryNode[],
  categoryId: string | null
): string {
  if (categoryId === null) return UNCATEGORIZED_PARTNER_LABEL
  return formatCategoryPath(findCategoryPath(tree, categoryId)) || "-"
}

// ---------------------------------------------------------------------------
// The 분류값 설정 window: a draft of the tree, saved all at once
// ---------------------------------------------------------------------------

/**
 * One category in the 분류값 설정 window. Saved categories use their id as
 * `key`; a row added in the window gets a new key (e.g. "new-3") and
 * `id: null` until it is saved.
 */
export type PartnerCategoryDraftNode = {
  key: string
  /** The saved category's id; null for a row added in the window. */
  id: string | null
  /** As typed (checked by validatePartnerCategoryDraft). */
  name: string
  isActive: boolean
  /** Partners directly in it (0 for a new row). */
  partnerCount: number
  depth: CategoryDepth
  children: PartnerCategoryDraftNode[]
}

/** The saved tree as the window's starting draft. */
export function toPartnerCategoryDraft(
  tree: readonly PartnerCategoryNode[]
): PartnerCategoryDraftNode[] {
  return tree.map((node) => ({
    key: node.id,
    id: node.id,
    name: node.name,
    isActive: node.isActive,
    partnerCount: node.partnerCount,
    depth: node.depth,
    children: toPartnerCategoryDraft(node.children),
  }))
}

/** The draft row with this key anywhere in the draft, or null. */
export function findDraftCategory(
  draft: readonly PartnerCategoryDraftNode[],
  key: string
): PartnerCategoryDraftNode | null {
  for (const node of draft) {
    if (node.key === key) return node
    const below = findDraftCategory(node.children, key)
    if (below) return below
  }
  return null
}

/**
 * Whether a row can get a sub-category ("+하위"): 대분류 and 중분류 can,
 * 소분류 cannot.
 */
export function canAddDraftChild(node: PartnerCategoryDraftNode): boolean {
  return node.depth < MAX_CATEGORY_DEPTH
}

/**
 * Adds a row (사용, name as given — usually "" so the user types it) at
 * the end of `parentKey`'s sub-categories, or as the last 대분류 for null.
 * `newKey` must be new (e.g. `new-${counter}`). Nothing changes when the
 * parent is a 소분류 or does not exist.
 */
export function addDraftCategory(
  draft: readonly PartnerCategoryDraftNode[],
  parentKey: string | null,
  newKey: string,
  name = ""
): PartnerCategoryDraftNode[] {
  function newRow(depth: CategoryDepth): PartnerCategoryDraftNode {
    return {
      key: newKey,
      id: null,
      name,
      isActive: true,
      partnerCount: 0,
      depth,
      children: [],
    }
  }
  if (parentKey === null) return [...draft, newRow(1)]
  return mapDraft(draft, (node) =>
    node.key === parentKey && canAddDraftChild(node)
      ? {
          ...node,
          children: [...node.children, newRow(node.depth === 1 ? 2 : 3)],
        }
      : node
  )
}

/** Changes a row's name and/or 사용 여부. */
export function updateDraftCategory(
  draft: readonly PartnerCategoryDraftNode[],
  key: string,
  patch: Partial<Pick<PartnerCategoryDraftNode, "name" | "isActive">>
): PartnerCategoryDraftNode[] {
  return mapDraft(draft, (node) =>
    node.key === key ? { ...node, ...patch } : node
  )
}

/**
 * Moves a row to another place among its siblings (the categories with the
 * same parent): `toIndex` is its new position (0 = first) in that list.
 * Rows never move to another parent.
 */
export function moveDraftCategory(
  draft: readonly PartnerCategoryDraftNode[],
  key: string,
  toIndex: number
): PartnerCategoryDraftNode[] {
  function reorder(
    siblings: readonly PartnerCategoryDraftNode[]
  ): PartnerCategoryDraftNode[] {
    const from = siblings.findIndex((node) => node.key === key)
    if (from === -1) {
      return siblings.map((node) => ({
        ...node,
        children: reorder(node.children),
      }))
    }
    const moved = siblings.filter((node) => node.key !== key)
    const to = Math.min(Math.max(Math.trunc(toIndex), 0), moved.length)
    moved.splice(to, 0, siblings[from])
    return moved
  }
  return reorder(draft)
}

/**
 * Why the checked rows cannot be deleted, or null when they can: a row with
 * partners, or a row with a sub-category that is not checked too, is
 * blocked (the owner's rule; the database checks it again).
 */
export function draftDeleteBlockReason(
  draft: readonly PartnerCategoryDraftNode[],
  keys: ReadonlySet<string>
): string | null {
  for (const node of flattenDraft(draft)) {
    if (!keys.has(node.key)) continue
    const label = node.name.trim() || "이름 없는 분류"
    if (node.partnerCount > 0) {
      return `‘${label}’ 분류에 거래처 ${node.partnerCount}개가 있어서 삭제할 수 없습니다. 먼저 그 거래처들을 다른 분류로 옮기거나 분류해제해 주세요. (더 쓰지 않는 분류라면 삭제 대신 사용 중지해 주세요.)`
    }
    if (node.children.some((child) => !keys.has(child.key))) {
      return `‘${label}’ 분류 아래에 하위 분류가 있어서 삭제할 수 없습니다. 하위 분류를 먼저 삭제해 주세요.`
    }
  }
  return null
}

/** Removes the rows with these keys (with everything below them). */
export function removeDraftCategories(
  draft: readonly PartnerCategoryDraftNode[],
  keys: ReadonlySet<string>
): PartnerCategoryDraftNode[] {
  return draft
    .filter((node) => !keys.has(node.key))
    .map((node) => ({
      ...node,
      children: removeDraftCategories(node.children, keys),
    }))
}

/** A name as it is saved: trimmed, Unicode NFC. */
export function normalizePartnerCategoryName(name: string): string {
  return name.trim().normalize("NFC")
}

/**
 * The first problem of the draft, or null when it can be saved: an empty or
 * too long name, or two rows with the same name under the same parent.
 * `key` = the row to point at.
 */
export function validatePartnerCategoryDraft(
  draft: readonly PartnerCategoryDraftNode[]
): { key: string; message: string } | null {
  const seen = new Set<string>()
  for (const node of draft) {
    const name = normalizePartnerCategoryName(node.name)
    if (name === "") {
      return { key: node.key, message: "분류 이름을 입력해 주세요." }
    }
    if (name.length > PARTNER_CATEGORY_NAME_MAX_LENGTH) {
      return {
        key: node.key,
        message: `분류 이름은 ${PARTNER_CATEGORY_NAME_MAX_LENGTH}자 이내로 입력해 주세요.`,
      }
    }
    if (seen.has(name)) {
      return {
        key: node.key,
        message: `같은 위치에 ‘${name}’ 분류가 두 개 있습니다. 하나의 이름을 바꿔 주세요.`,
      }
    }
    seen.add(name)
  }
  for (const node of draft) {
    const problem = validatePartnerCategoryDraft(node.children)
    if (problem) return problem
  }
  return null
}

/**
 * Everything the window changed, as savePartnerCategories
 * (@/lib/partner-categories/actions) expects it:
 * - deleted: saved categories that are no longer in the draft;
 * - categories: rows added in the window, and saved rows whose name,
 *   사용 여부 or place among their siblings changed. sortOrder = place
 *   among the siblings (1, 2, 3, …).
 */
export type PartnerCategoryChanges = {
  deleted: string[]
  categories: PartnerCategoryChange[]
}

/** One added or changed category (see PartnerCategoryChanges). */
export type PartnerCategoryChange = {
  /** Saved id; null for a row added in the window. */
  id: string | null
  /** The window's key of an added row; null for a saved one. */
  tempId: string | null
  /** Added row: its saved parent's id (null = 대분류 or parentTempId). */
  parentId: string | null
  /** Added row: the key of its parent added in the same save. */
  parentTempId: string | null
  name: string
  isActive: boolean
  sortOrder: number
}

/** Compares the draft with the saved tree (see PartnerCategoryChanges). */
export function buildPartnerCategoryChanges(
  saved: readonly PartnerCategoryNode[],
  draft: readonly PartnerCategoryDraftNode[]
): PartnerCategoryChanges {
  const savedById = new Map<string, PartnerCategoryNode>()
  for (const node of flattenSaved(saved)) savedById.set(node.id, node)

  const keptIds = new Set<string>()
  const categories: PartnerCategoryChange[] = []

  function walk(
    siblings: readonly PartnerCategoryDraftNode[],
    parent: PartnerCategoryDraftNode | null
  ) {
    siblings.forEach((node, index) => {
      const name = normalizePartnerCategoryName(node.name)
      const sortOrder = index + 1
      if (node.id === null) {
        categories.push({
          id: null,
          tempId: node.key,
          parentId: parent?.id ?? null,
          parentTempId: parent && parent.id === null ? parent.key : null,
          name,
          isActive: node.isActive,
          sortOrder,
        })
      } else {
        keptIds.add(node.id)
        const before = savedById.get(node.id)
        if (
          !before ||
          before.name !== name ||
          before.isActive !== node.isActive ||
          before.sortOrder !== sortOrder
        ) {
          categories.push({
            id: node.id,
            tempId: null,
            parentId: null,
            parentTempId: null,
            name,
            isActive: node.isActive,
            sortOrder,
          })
        }
      }
      walk(node.children, node)
    })
  }
  walk(draft, null)

  const deleted = [...savedById.keys()].filter((id) => !keptIds.has(id))
  return { deleted, categories }
}

/** Whether there is anything to save (enables [저장 | F8]). */
export function hasPartnerCategoryChanges(
  changes: PartnerCategoryChanges
): boolean {
  return changes.deleted.length > 0 || changes.categories.length > 0
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapDraft(
  draft: readonly PartnerCategoryDraftNode[],
  change: (node: PartnerCategoryDraftNode) => PartnerCategoryDraftNode
): PartnerCategoryDraftNode[] {
  return draft.map((node) => {
    const changed = change(node)
    return { ...changed, children: mapDraft(changed.children, change) }
  })
}

function flattenDraft(
  draft: readonly PartnerCategoryDraftNode[]
): PartnerCategoryDraftNode[] {
  return draft.flatMap((node) => [node, ...flattenDraft(node.children)])
}

function flattenSaved(
  tree: readonly PartnerCategoryNode[]
): PartnerCategoryNode[] {
  return tree.flatMap((node) => [node, ...flattenSaved(node.children)])
}
