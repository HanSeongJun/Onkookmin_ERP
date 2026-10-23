/**
 * 상품 분류 (product categories) as a tree: 대분류 → 중분류 → 소분류.
 *
 * The CategoryNode type and small helpers for the tree that
 * getCategoryTree() (@/lib/categories/queries) returns. Everything here is
 * plain data work without the database, so Client Components can use it too.
 *
 * The path/search helpers (findCategoryPath, formatCategoryPath,
 * collectDescendantIds, …) work on any tree of the same shape
 * (CategoryTreeNode), so the 거래처분류 tree (@/lib/partner-categories/tree)
 * uses them too.
 */

/** Level of a category: 1 = 대분류, 2 = 중분류, 3 = 소분류. */
export type CategoryDepth = 1 | 2 | 3

/**
 * The deepest level (소분류). Categories on this level cannot have
 * sub-categories; the database checks the same rule.
 */
export const MAX_CATEGORY_DEPTH = 3

/** Korean name of each level, e.g. CATEGORY_LEVEL_LABELS[3] → "소분류". */
export const CATEGORY_LEVEL_LABELS: Record<CategoryDepth, string> = {
  1: "대분류",
  2: "중분류",
  3: "소분류",
}

/**
 * One 상품 분류 with its sub-categories.
 * A 대분류 has `parentId === null` and depth 1; a 중분류 (depth 2) sits under
 * a 대분류; a 소분류 (depth 3) sits under a 중분류 and has no children.
 */
export type CategoryNode = {
  id: string
  name: string
  parentId: string | null
  sortOrder: number
  isActive: boolean
  /** 1 = 대분류, 2 = 중분류, 3 = 소분류. */
  depth: CategoryDepth
  /**
   * Products assigned directly to this category, active and inactive.
   * Products in its sub-categories are not included (for those, use
   * countProductsInSubtree). A category can be deleted only when this is 0
   * and it has no children.
   */
  productCount: number
  /** Sub-categories in display order (always empty for a 소분류). */
  children: CategoryNode[]
}

/**
 * What every category tree node has (상품 분류 and 거래처분류): the helpers
 * below accept any tree of this shape.
 */
export type CategoryTreeNode<Node> = {
  id: string
  name: string
  parentId: string | null
  sortOrder: number
  isActive: boolean
  depth: CategoryDepth
  children: Node[]
}

/** One category as read from the database, before it is put in the tree. */
export type CategoryRecord = Omit<CategoryNode, "depth" | "children">

/**
 * Builds the tree from a flat list of categories.
 *
 * @param records all categories, already in display order (sort_order, then
 *   name, as the database query returns them).
 * @param options.includeInactive also keep categories switched off
 *   (사용 중지). Default false: a switched-off category is left out together
 *   with everything under it.
 */
export function buildCategoryTree(
  records: CategoryRecord[],
  options: { includeInactive?: boolean } = {}
): CategoryNode[] {
  // Group the categories by parent; each group keeps the display order.
  const childrenByParent = new Map<string | null, CategoryRecord[]>()
  for (const record of records) {
    const siblings = childrenByParent.get(record.parentId) ?? []
    siblings.push(record)
    childrenByParent.set(record.parentId, siblings)
  }

  function buildLevel(
    parentId: string | null,
    depth: CategoryDepth
  ): CategoryNode[] {
    const siblings = childrenByParent.get(parentId) ?? []
    return siblings
      .filter((record) => options.includeInactive || record.isActive)
      .map((record) => ({
        id: record.id,
        name: record.name,
        parentId: record.parentId,
        sortOrder: record.sortOrder,
        isActive: record.isActive,
        depth,
        productCount: record.productCount,
        // A 소분류 has no children: the database allows no fourth level.
        children:
          depth === MAX_CATEGORY_DEPTH
            ? []
            : buildLevel(record.id, depth === 1 ? 2 : 3),
      }))
  }

  return buildLevel(null, 1)
}

/**
 * Every category in the tree as one list, top-down in display order:
 * a 대분류, then its 중분류 each followed by its 소분류, then the next 대분류.
 */
export function flattenCategoryTree<Node extends CategoryTreeNode<Node>>(
  tree: Node[]
): Node[] {
  return tree.flatMap((node) => [node, ...flattenCategoryTree(node.children)])
}

/** The category with this id anywhere in the tree, or null. */
export function findCategory<Node extends CategoryTreeNode<Node>>(
  tree: Node[],
  id: string
): Node | null {
  return findCategoryPath(tree, id).at(-1) ?? null
}

/**
 * The categories from the 대분류 down to the category with this id,
 * e.g. [수산물, 냉동수산, 새우]. Empty when the id is not in the tree.
 */
export function findCategoryPath<Node extends CategoryTreeNode<Node>>(
  tree: Node[],
  id: string
): Node[] {
  for (const node of tree) {
    if (node.id === id) return [node]
    const pathBelow = findCategoryPath(node.children, id)
    if (pathBelow.length > 0) return [node, ...pathBelow]
  }
  return []
}

/**
 * The names joined with " > ", e.g. "수산물 > 냉동수산 > 새우".
 * Pass the result of findCategoryPath (any objects with a name work).
 */
export function formatCategoryPath(path: { name: string }[]): string {
  return path.map((category) => category.name).join(" > ")
}

/**
 * The ids of all categories under this one (its children and their
 * children), not including the category itself.
 */
export function collectDescendantIds<Node extends CategoryTreeNode<Node>>(
  node: Node
): string[] {
  return node.children.flatMap((child) => [
    child.id,
    ...collectDescendantIds(child),
  ])
}

/**
 * Products in this category and in all categories under it, counting
 * switched-off products too.
 */
export function countProductsInSubtree(node: CategoryNode): number {
  return node.children.reduce(
    (sum, child) => sum + countProductsInSubtree(child),
    node.productCount
  )
}

/**
 * Whether a product may be put into this category: it is in the tree and it
 * and every category above it are 사용 (not switched off).
 */
export function isCategorySelectable<Node extends CategoryTreeNode<Node>>(
  tree: Node[],
  id: string
): boolean {
  const path = findCategoryPath(tree, id)
  return path.length > 0 && path.every((category) => category.isActive)
}
