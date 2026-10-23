import "server-only"

import { cache } from "react"

import { getCategoryTree } from "@/lib/categories/queries"
import {
  findCategory,
  findCategoryPath,
  formatCategoryPath,
  type CategoryNode,
} from "@/lib/categories/tree"
import {
  deriveBundleFoodInfo,
  sortAllergens,
  type BaseProductOption,
  type BundleComponent,
  type FoodInfo,
} from "@/lib/products/bundle"
import type {
  EffectiveTaxType,
  ProductType,
  StorageType,
} from "@/lib/products/constants"
import {
  defaultProductListParams,
  isUuid,
  PRODUCT_EXPORT_MAX_ROWS,
  PRODUCT_PAGE_SIZES,
  PRODUCT_SEARCH_MAX_LENGTH,
  productSortState,
  type ProductListParams,
  type ProductSortColumn,
} from "@/lib/products/schema"
import { createClient } from "@/lib/supabase/server"
import type { Tables } from "@/types/database"

// Every function here reads request cookies (Supabase login) through the
// server client: call them inside a <Suspense> boundary (or a Route
// Handler / Server Action), never inside "use cache".

/** Text shown for a product without a category. */
export const UNCATEGORIZED_LABEL = "미분류"

// ---------------------------------------------------------------------------
// Categories (for the filters, the form and "대분류 > 중분류 > 소분류")
// ---------------------------------------------------------------------------

/**
 * All 상품 분류 as a tree (대분류 → 중분류 → 소분류), including the ones
 * switched off: products may still be in them.
 *
 * Wrapped in React `cache()`: a page and the queries below share one
 * database read per request.
 */
export const getAllCategories = cache((): Promise<CategoryNode[]> =>
  getCategoryTree({ includeInactive: true })
)

/**
 * "대분류 > 중분류 > 소분류" of a category (shorter when the product sits
 * higher up), "미분류" for no category, or "-" when it is not in the tree.
 */
function getCategoryPathText(
  tree: CategoryNode[],
  categoryId: string | null
): string {
  if (categoryId === null) return UNCATEGORIZED_LABEL
  return formatCategoryPath(findCategoryPath(tree, categoryId)) || "-"
}

/**
 * The `or` filter for the chosen category (on any level), or null for "all
 * categories". It matches products in that category and in every category
 * below it: the product_list_items view has the product's own category and
 * the two above it. The request stays short however many sub-categories
 * there are. Unknown ids (deleted, typed by hand) are ignored, so only the
 * id of a category from the tree ends up in the filter.
 */
function buildCategoryFilter(
  tree: CategoryNode[],
  categoryId: string | null
): string | null {
  const category = categoryId ? findCategory(tree, categoryId) : null
  if (!category) return null
  return [
    `category_id.eq.${category.id}`,
    `category_parent_id.eq.${category.id}`,
    `category_grandparent_id.eq.${category.id}`,
  ].join(",")
}

// ---------------------------------------------------------------------------
// Search text → PostgREST filter
// ---------------------------------------------------------------------------

/**
 * Columns the list search looks in. 제조사/브랜드 is the one in effect: a
 * 묶음상품 is found by the 제조사 of its 기준상품.
 */
const LIST_SEARCH_COLUMNS = [
  "code",
  "name",
  "barcode",
  "effective_manufacturer",
] as const

/** Columns the 기준상품 picker's search looks in. */
const BASE_PRODUCT_SEARCH_COLUMNS = ["code", "name", "barcode"] as const

/**
 * Builds the `or` filter "code.ilike.<pattern>,name.ilike.<pattern>,..." for
 * the search text, safe for any characters the user types:
 * 1. LIKE wildcards (% and _) and the LIKE escape character (\) are escaped,
 *    so they match themselves.
 * 2. PostgREST turns every "*" into "%" and has no way to escape it, so "*"
 *    becomes "_" (any one character). "1*2" still finds "1*2".
 * 3. The whole pattern is wrapped in double quotes (with " and \ escaped),
 *    so commas, dots, colons and parentheses are read as plain text.
 */
function buildSearchFilter(search: string, columns: readonly string[]): string {
  const likeText = search
    .replace(/[\\%_]/g, (character) => `\\${character}`)
    .replaceAll("*", "_")
  const quotedPattern = `"%${likeText.replace(/["\\]/g, (character) => `\\${character}`)}%"`
  return columns.map((column) => `${column}.ilike.${quotedPattern}`).join(",")
}

// ---------------------------------------------------------------------------
// The list query (shared by the list page and the 엑셀 download)
// ---------------------------------------------------------------------------

/**
 * One row of the product_list_items view (see the bundle_products
 * migration). Postgres reports every column of a view as "may be empty", so
 * the generated types add `| null`. The products columns come straight from
 * the products table, so its own types are used; the extra columns are typed
 * here by hand.
 */
export type ProductListItem = Tables<"products"> & {
  category_parent_id: string | null
  category_grandparent_id: string | null
  /** Kinds of 기준상품 in a 묶음상품 (0 for a 기준상품). */
  component_count: number
  /** 묶음상품 of exactly one kind of 기준상품: that 기준상품, else null. */
  single_component_id: string | null
  single_component_code: string | null
  /** 묶음상품 of exactly one kind of 기준상품: its quantity (6개입 → 6). */
  single_component_quantity: number | null
  /** 보관온도 in effect (묶음상품: the strictest of its 기준상품). */
  effective_storage_type: StorageType | null
  /** 과세구분 in effect (묶음상품: "mixed" when 과세 and 면세 are mixed). */
  effective_tax_type: EffectiveTaxType | null
  /** Allergens in effect (묶음상품: all of its 기준상품), unordered. */
  effective_allergens: string[]
  /** 유통기한 기준일수 in effect (묶음상품: the shortest). */
  effective_shelf_life_days: number | null
  /** 원산지 in effect (묶음상품: different values joined with ", "). */
  effective_origin: string | null
  /** 제조사/브랜드 in effect (묶음상품: different values joined with ", "). */
  effective_manufacturer: string | null
  /**
   * 부가세 별도 amount of purchase_price_incl_vat, by the 과세구분 in effect
   * (혼합: split by the 기준상품's 매입가). Null when the price is empty or
   * a 혼합 price cannot be split (a 기준상품 without 매입가).
   */
  purchase_price_excl_vat: number | null
  /** 부가세 of purchase_price_incl_vat (null like purchase_price_excl_vat). */
  purchase_vat: number | null
  /** 부가세 별도 amount of sale_price_incl_vat (see purchase_price_excl_vat). */
  sale_price_excl_vat: number | null
  /** 부가세 of sale_price_incl_vat (null like sale_price_excl_vat). */
  sale_vat: number | null
}

/**
 * The product_list_items column behind each sortable grid column. Food
 * information and the 부가세 별도 amounts are the values in effect, as the
 * grid shows them. Enum columns sort in their declared order (구분: 기준 →
 * 묶음; 보관온도: 상온 → 냉장 → 냉동); 과세구분 is text in the view
 * (exempt → mixed → taxable: 면세 → 혼합 → 과세); 사용여부: 사용중지 →
 * 사용.
 */
const SORT_COLUMNS = {
  type: "product_type",
  code: "code",
  name: "name",
  spec: "spec",
  unit: "unit",
  tax: "effective_tax_type",
  storage: "effective_storage_type",
  purchase_excl: "purchase_price_excl_vat",
  purchase_incl: "purchase_price_incl_vat",
  sale_excl: "sale_price_excl_vat",
  sale_incl: "sale_price_incl_vat",
  origin: "effective_origin",
  status: "is_active",
} as const satisfies Record<ProductSortColumn, string>

/**
 * Prepares the list query for the given search and filters. `build()` makes
 * a fresh request each time (one page, the count only, or a batch for the
 * 엑셀 download), always with the same filters and a stable sort order.
 */
async function prepareListQuery(params: ProductListParams) {
  const supabase = await createClient()
  const categories = await getAllCategories()
  const search = params.q.trim().slice(0, PRODUCT_SEARCH_MAX_LENGTH)
  const categoryFilter = params.uncategorized
    ? null
    : buildCategoryFilter(
        categories,
        isUuid(params.categoryId) ? params.categoryId : null
      )

  function build({ countOnly = false, withCount = true } = {}) {
    // Reads the product_list_items view (products + the categories above
    // theirs + the food information in effect). 미분류 products are in it too.
    let query = supabase.from("product_list_items").select("*", {
      count: withCount ? "exact" : undefined,
      head: countOnly,
    })

    // Two `or` filters (search and category) must both match.
    if (search) query = query.or(buildSearchFilter(search, LIST_SEARCH_COLUMNS))
    if (params.productType) query = query.eq("product_type", params.productType)
    if (params.uncategorized) {
      query = query.is("category_id", null)
    } else if (categoryFilter) {
      query = query.or(categoryFilter)
    }
    // 보관온도 / 과세구분: the values in effect, so a 묶음상품 is found by
    // what its 기준상품 need (and 과세구분 "mixed" = 혼합 works).
    if (params.storageType) {
      query = query.eq("effective_storage_type", params.storageType)
    }
    if (params.taxType) query = query.eq("effective_tax_type", params.taxType)
    if (params.status === "active") query = query.eq("is_active", true)
    if (params.status === "inactive") query = query.eq("is_active", false)

    // Rows with equal values follow 상품코드, then id, so the order is the
    // same every time and no product shows up on two pages. Empty values
    // (e.g. no 판매가) come last, whichever the direction.
    const sort = productSortState(params.sort)
    if (sort === null) {
      query = query.order("created_at", { ascending: false })
    } else {
      const ascending = sort.direction === "asc"
      query = query.order(SORT_COLUMNS[sort.column], {
        ascending,
        nullsFirst: false,
      })
      if (sort.column !== "code") query = query.order("code")
    }
    return query.order("id")
  }

  return { build, categories }
}

// ---------------------------------------------------------------------------
// Product list
// ---------------------------------------------------------------------------

/** One row of the product list. Food columns are the values in effect. */
export type ProductListRow = {
  id: string
  /** 상품유형 (list column 구분: 기준 / 묶음). */
  productType: ProductType
  code: string
  name: string
  /** "대분류 > 중분류 > 소분류" (shorter when higher up), or "미분류". */
  categoryPath: string
  /** No category (미분류). */
  isUncategorized: boolean
  spec: string | null
  unit: string
  /**
   * Kinds of 기준상품 in a 묶음상품 (0 for a 기준상품). With
   * `singleComponentQuantity` it makes the 구성 column: formatComposition in
   * `@/lib/products/bundle` ("×6", "혼합 2종").
   */
  componentCount: number
  /** 묶음상품 of one kind of 기준상품: its quantity (6개입 → 6), else null. */
  singleComponentQuantity: number | null
  /** 묶음상품 of one kind of 기준상품: that 기준상품's code, else null. */
  singleComponentCode: string | null
  /** 보관온도 in effect. Null only for a 묶음상품 without 기준상품. */
  storageType: StorageType | null
  /** 과세구분 in effect, "mixed" = 혼합. Null only for a 묶음상품 without 기준상품. */
  taxType: EffectiveTaxType | null
  /** 원산지 in effect. */
  origin: string | null
  /** 기본 매입가 in won, 부가세 포함 (as typed and stored), or null. */
  purchasePriceInclVat: number | null
  /**
   * 기본 매입가, 부가세 별도 (worked out by the database). Null when the
   * price is empty or cannot be split (혼합 묶음상품 with a 기준상품 that has
   * no 매입가): show "-".
   */
  purchasePriceExclVat: number | null
  /** 부가세 of the 기본 매입가 (null like purchasePriceExclVat). */
  purchaseVat: number | null
  /** 기본 판매가 in won, 부가세 포함 (as typed and stored), or null. */
  salePriceInclVat: number | null
  /** 기본 판매가, 부가세 별도 (null like purchasePriceExclVat). */
  salePriceExclVat: number | null
  /** 부가세 of the 기본 판매가 (null like purchasePriceExclVat). */
  saleVat: number | null
  isActive: boolean
}

export type ProductList = {
  rows: ProductListRow[]
  /** Number of products matching the search and filters (all pages). */
  total: number
  /** The page shown (clamped to the last page). */
  page: number
  /** Number of pages (at least 1). */
  pageCount: number
}

/**
 * One page of the product list, with search, filters and sort.
 * - Search looks in 상품코드, 상품명, 바코드 and 제조사/브랜드 (ignoring case).
 * - 상품유형 filter: 기준상품 only / 묶음상품 only / both.
 * - A category filter (any level) includes the products of every category
 *   below it; "미분류 상품만 보기" shows only products without a category.
 * - 보관온도 / 과세구분 filters use the values in effect (혼합 included).
 * - A page number past the end shows the last page instead.
 * - Page size: one of PRODUCT_PAGE_SIZES (default 100).
 */
export async function listProducts(
  options: Partial<ProductListParams> = {}
): Promise<ProductList> {
  const params = { ...defaultProductListParams, ...options }
  const pageSize = PRODUCT_PAGE_SIZES.includes(params.pageSize)
    ? params.pageSize
    : defaultProductListParams.pageSize
  const { build, categories } = await prepareListQuery(params)

  function fetchPage(page: number) {
    const from = (page - 1) * pageSize
    return build()
      .range(from, from + pageSize - 1)
      .overrideTypes<ProductListItem[], { merge: false }>()
  }

  let page = Math.max(Math.floor(params.page), 1)
  let result = await fetchPage(page)

  // Past the last page: PostgREST answers PGRST103 ("range not satisfiable"),
  // or no rows when the offset is exactly the total. Show the last page.
  if (
    page > 1 &&
    (result.error?.code === "PGRST103" ||
      (!result.error && result.data.length === 0))
  ) {
    const { count, error } = await build({ countOnly: true })
    if (error) {
      throw new Error(`상품 목록을 불러오지 못했습니다: ${error.message}`)
    }
    page = Math.max(Math.ceil((count ?? 0) / pageSize), 1)
    result = await fetchPage(page)
  }

  if (result.error) {
    throw new Error(`상품 목록을 불러오지 못했습니다: ${result.error.message}`)
  }

  const total = result.count ?? result.data.length
  return {
    rows: result.data.map((product) => ({
      id: product.id,
      productType: product.product_type,
      code: product.code,
      name: product.name,
      categoryPath: getCategoryPathText(categories, product.category_id),
      isUncategorized: product.category_id === null,
      spec: product.spec,
      unit: product.unit,
      componentCount: product.component_count,
      singleComponentQuantity: product.single_component_quantity,
      singleComponentCode: product.single_component_code,
      storageType: product.effective_storage_type,
      taxType: product.effective_tax_type,
      origin: product.effective_origin,
      purchasePriceInclVat: product.purchase_price_incl_vat,
      purchasePriceExclVat: product.purchase_price_excl_vat,
      purchaseVat: product.purchase_vat,
      salePriceInclVat: product.sale_price_incl_vat,
      salePriceExclVat: product.sale_price_excl_vat,
      saleVat: product.sale_vat,
      isActive: product.is_active,
    })),
    total,
    page,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
  }
}

/**
 * Whether at least one product exists (사용 중 or 중지).
 * Used to tell "no products yet" apart from "nothing matches the filters".
 */
export async function hasAnyProducts(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("products").select("id").limit(1)
  if (error) {
    throw new Error(`상품 목록을 불러오지 못했습니다: ${error.message}`)
  }
  return data.length > 0
}

// ---------------------------------------------------------------------------
// 엑셀 download
// ---------------------------------------------------------------------------

/**
 * One product of the 엑셀 download: a row of the product_list_items view
 * with its category path. Use the effective_* columns for the food
 * information (for a 묶음상품 the products columns storage_type, tax_type,
 * origin, manufacturer, shelf_life_days are empty and allergens is []).
 * Prices: *_incl_vat (부가세 포함, as stored) and *_excl_vat / *_vat
 * (부가세 별도 and 부가세, null when they cannot be worked out).
 */
export type ProductExportRow = ProductListItem & {
  /** "대분류 > 중분류 > 소분류", or "미분류". */
  categoryPath: string
}

/** Rows asked for per request (the API returns at most 1,000 at a time). */
const EXPORT_BATCH_SIZE = 1000

/**
 * Every product matching the list's search and filters (all pages, in the
 * list's sort order), at most PRODUCT_EXPORT_MAX_ROWS. Read in batches of
 * 1,000 because the API sends at most that many rows per request.
 * `total` is the number of matching products, which may be more than the
 * rows returned. `effective_allergens` is in the order the law lists them.
 */
export async function listProductsForExport(
  options: Partial<ProductListParams> = {}
): Promise<{ rows: ProductExportRow[]; total: number }> {
  const params = { ...defaultProductListParams, ...options }
  const { build, categories } = await prepareListQuery(params)

  const products: ProductListItem[] = []
  let total = 0
  while (products.length < PRODUCT_EXPORT_MAX_ROWS) {
    const from = products.length
    const to = Math.min(from + EXPORT_BATCH_SIZE, PRODUCT_EXPORT_MAX_ROWS) - 1
    const isFirst = from === 0
    const { data, error, count } = await build({ withCount: isFirst })
      .range(from, to)
      .overrideTypes<ProductListItem[], { merge: false }>()
    if (error) {
      throw new Error(`상품 목록을 불러오지 못했습니다: ${error.message}`)
    }
    if (isFirst) total = count ?? data.length
    products.push(...data)
    // Stop at the end. (Not "fewer rows than asked": the API may send fewer
    // per request than we ask for.)
    if (data.length === 0 || products.length >= total) break
  }

  return {
    rows: products.map((product) => ({
      ...product,
      effective_allergens: sortAllergens(product.effective_allergens),
      categoryPath: getCategoryPathText(categories, product.category_id),
    })),
    total: Math.max(total, products.length),
  }
}

// ---------------------------------------------------------------------------
// 기준상품 as 구성상품 (for 묶음상품)
// ---------------------------------------------------------------------------

/**
 * Columns of a 기준상품 that the 구성상품 table and the picker need. Kept as
 * one literal string so supabase-js can type the result.
 */
const BASE_PRODUCT_OPTION_COLUMNS =
  "id, code, name, spec, unit, is_active, storage_type, tax_type, allergens, shelf_life_days, origin, manufacturer, barcode, purchase_price_incl_vat, sale_price_incl_vat"

type BaseProductOptionRow = Pick<
  Tables<"products">,
  | "id"
  | "code"
  | "name"
  | "spec"
  | "unit"
  | "is_active"
  | "storage_type"
  | "tax_type"
  | "allergens"
  | "shelf_life_days"
  | "origin"
  | "manufacturer"
  | "barcode"
  | "purchase_price_incl_vat"
  | "sale_price_incl_vat"
>

/**
 * A 기준상품 row as a BaseProductOption. 보관온도 and 과세구분 are always
 * filled in for a 기준상품 (the database check products_product_type_fields_check
 * makes sure), so an empty one means the row is not a 기준상품.
 */
function toBaseProductOption(row: BaseProductOptionRow): BaseProductOption {
  if (row.storage_type === null || row.tax_type === null) {
    throw new Error(`기준상품이 아닙니다: ${row.code}`)
  }
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    spec: row.spec,
    unit: row.unit,
    isActive: row.is_active,
    storageType: row.storage_type,
    taxType: row.tax_type,
    allergens: sortAllergens(row.allergens),
    shelfLifeDays: row.shelf_life_days,
    origin: row.origin,
    manufacturer: row.manufacturer,
    barcode: row.barcode,
    purchasePriceInclVat: row.purchase_price_incl_vat,
    salePriceInclVat: row.sale_price_incl_vat,
  }
}

/** Most 기준상품 one picker search returns. */
export const BASE_PRODUCT_SEARCH_LIMIT = 100

/** Ids per `in (...)` request, so the request address stays short. */
const ID_CHUNK = 100

function chunks<T>(values: readonly T[], size = ID_CHUNK): T[][] {
  const result: T[][] = []
  for (let start = 0; start < values.length; start += size) {
    result.push(values.slice(start, start + size))
  }
  return result
}

/** Highest `offset` the picker search accepts (its "더 보기" pages). */
export const BASE_PRODUCT_SEARCH_MAX_OFFSET = 100_000

/**
 * 기준상품 for the picker of the 구성상품 table: search in 상품코드, 상품명
 * and 바코드 (ignoring case), in 상품코드 order, at most `limit` rows
 * starting at row `offset` (0 = the first; the picker's "더 보기" asks for
 * the next ones). Only 사용 기준상품 unless `includeInactive`. `total` = all
 * matches (may be more than the rows returned).
 */
export async function searchBaseProducts(
  search: string,
  {
    includeInactive = false,
    limit = BASE_PRODUCT_SEARCH_LIMIT,
    offset = 0,
  }: { includeInactive?: boolean; limit?: number; offset?: number } = {}
): Promise<{ rows: BaseProductOption[]; total: number }> {
  const supabase = await createClient()
  const text = search.trim().slice(0, PRODUCT_SEARCH_MAX_LENGTH)
  const from = Math.min(
    Math.max(Math.floor(offset) || 0, 0),
    BASE_PRODUCT_SEARCH_MAX_OFFSET
  )
  const size = Math.min(Math.max(limit, 1), BASE_PRODUCT_SEARCH_LIMIT)

  let query = supabase
    .from("products")
    .select(BASE_PRODUCT_OPTION_COLUMNS, { count: "exact" })
    .eq("product_type", "base")
  if (!includeInactive) query = query.eq("is_active", true)
  if (text) {
    query = query.or(buildSearchFilter(text, BASE_PRODUCT_SEARCH_COLUMNS))
  }
  const { data, error, count } = await query
    .order("code")
    .order("id")
    .range(from, from + size - 1)
  // Past the last match (the list changed meanwhile): PostgREST answers
  // PGRST103 ("range not satisfiable"). There are simply no more rows.
  if (error?.code === "PGRST103") return { rows: [], total: from }
  if (error) {
    throw new Error(`기준상품을 불러오지 못했습니다: ${error.message}`)
  }
  return {
    rows: data.map(toBaseProductOption),
    total: count ?? from + data.length,
  }
}

/**
 * The 기준상품 with these ids (사용 and 사용중지), in the order of `ids`.
 * Ids that are not a 기준상품 are left out.
 */
export async function getBaseProductsByIds(
  ids: readonly string[]
): Promise<BaseProductOption[]> {
  const supabase = await createClient()
  const found = new Map<string, BaseProductOption>()
  for (const chunk of chunks(ids)) {
    const { data, error } = await supabase
      .from("products")
      .select(BASE_PRODUCT_OPTION_COLUMNS)
      .eq("product_type", "base")
      .in("id", chunk)
    if (error) {
      throw new Error(`기준상품을 불러오지 못했습니다: ${error.message}`)
    }
    for (const row of data) found.set(row.id, toBaseProductOption(row))
  }
  return ids.flatMap((id) => found.get(id) ?? [])
}

/** A 묶음상품's 구성표 (screen order) with each 기준상품. */
async function getBundleComponents(
  bundleId: string
): Promise<BundleComponent[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("product_bundle_items")
    .select(
      "quantity, sort_order, component:products!product_bundle_items_component_id_fkey(id, code, name, spec, unit, is_active, storage_type, tax_type, allergens, shelf_life_days, origin, manufacturer, barcode, purchase_price_incl_vat, sale_price_incl_vat)"
    )
    .eq("bundle_id", bundleId)
    .order("sort_order")
    .order("component_id")
  if (error) {
    throw new Error(`구성상품을 불러오지 못했습니다: ${error.message}`)
  }
  return data.map((item) => ({
    ...toBaseProductOption(item.component),
    quantity: item.quantity,
  }))
}

/** A 묶음상품 that contains a given 기준상품 (the 기준상품's 묶음상품 tab). */
export type ContainingBundle = {
  /** The 묶음상품's id (opens it with ?modal=edit&id=…). */
  id: string
  code: string
  name: string
  spec: string | null
  unit: string
  /** How many of the 기준상품 are in this 묶음상품 (6개입 → 6). */
  quantity: number
  /** Kinds of 기준상품 in the 묶음상품 (1 = only this one, more = 혼합). */
  componentCount: number
  isActive: boolean
  /** 기본 판매가 in won, 부가세 포함 (as stored), or null. */
  salePriceInclVat: number | null
  /**
   * 기본 판매가, 부가세 별도 (worked out by the database; null when the
   * price is empty or cannot be split).
   */
  salePriceExclVat: number | null
}

/**
 * Every 묶음상품 that contains this 기준상품 (사용 and 사용중지), in
 * 상품코드 order. Empty for a 묶음상품 or an unknown id.
 */
export async function getBundlesContainingProduct(
  baseProductId: string
): Promise<ContainingBundle[]> {
  if (!isUuid(baseProductId)) return []
  const supabase = await createClient()
  // The bundle is read through the view to get its component_count too.
  const { data, error } = await supabase
    .from("product_bundle_items")
    .select(
      "quantity, bundle:product_list_items!product_bundle_items_bundle_id_fkey(id, code, name, spec, unit, is_active, sale_price_incl_vat, sale_price_excl_vat, component_count)"
    )
    .eq("component_id", baseProductId.toLowerCase())
  if (error) {
    throw new Error(`묶음상품을 불러오지 못했습니다: ${error.message}`)
  }

  const bundles: ContainingBundle[] = []
  for (const item of data) {
    const bundle = item.bundle
    // View columns are typed "may be empty"; a 구성표 row always has its
    // 묶음상품 (foreign key), so these are filled in.
    if (
      !bundle ||
      bundle.id === null ||
      bundle.code === null ||
      bundle.name === null ||
      bundle.unit === null ||
      bundle.is_active === null
    ) {
      continue
    }
    bundles.push({
      id: bundle.id,
      code: bundle.code,
      name: bundle.name,
      spec: bundle.spec,
      unit: bundle.unit,
      quantity: item.quantity,
      componentCount: bundle.component_count ?? 0,
      isActive: bundle.is_active,
      salePriceInclVat: bundle.sale_price_incl_vat,
      salePriceExclVat: bundle.sale_price_excl_vat,
    })
  }
  return bundles.sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : 0
  )
}

/**
 * Ids of the 사용 묶음상품 that contain any of these products — the ones the
 * database switches off together when these 기준상품 are switched off
 * (사용중지). Ids that are not 기준상품 simply match nothing.
 */
export async function findActiveBundleIdsContaining(
  productIds: readonly string[]
): Promise<Set<string>> {
  const supabase = await createClient()
  const bundleIds = new Set<string>()
  for (const chunk of chunks(productIds)) {
    const { data, error } = await supabase
      .from("product_bundle_items")
      .select(
        "bundle_id, bundle:products!product_bundle_items_bundle_id_fkey(is_active)"
      )
      .in("component_id", chunk)
    if (error) {
      throw new Error(`묶음상품을 불러오지 못했습니다: ${error.message}`)
    }
    for (const item of data) {
      if (item.bundle.is_active) bundleIds.add(item.bundle_id)
    }
  }
  return bundleIds
}

/**
 * Of these products, the 묶음상품 that contain at least one 사용중지
 * 기준상품 (they cannot be switched on).
 */
export async function findBundleIdsWithInactiveComponents(
  productIds: readonly string[]
): Promise<Set<string>> {
  const supabase = await createClient()
  const bundleIds = new Set<string>()
  for (const chunk of chunks(productIds)) {
    const { data, error } = await supabase
      .from("product_bundle_items")
      .select(
        "bundle_id, component:products!product_bundle_items_component_id_fkey(is_active)"
      )
      .in("bundle_id", chunk)
    if (error) {
      throw new Error(`구성상품을 불러오지 못했습니다: ${error.message}`)
    }
    for (const item of data) {
      if (!item.component.is_active) bundleIds.add(item.bundle_id)
    }
  }
  return bundleIds
}

/** 상품유형 of each of these products (unknown ids are left out). */
export async function getProductTypes(
  productIds: readonly string[]
): Promise<Map<string, ProductType>> {
  const supabase = await createClient()
  const types = new Map<string, ProductType>()
  for (const chunk of chunks(productIds)) {
    const { data, error } = await supabase
      .from("products")
      .select("id, product_type")
      .in("id", chunk)
    if (error) {
      throw new Error(`상품을 불러오지 못했습니다: ${error.message}`)
    }
    for (const row of data) types.set(row.id, row.product_type)
  }
  return types
}

/** How many of these products are 사용중지 now. */
export async function countInactiveProducts(
  productIds: readonly string[]
): Promise<number> {
  const supabase = await createClient()
  let inactive = 0
  for (const chunk of chunks(productIds)) {
    const { count, error } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .in("id", chunk)
      .eq("is_active", false)
    if (error) {
      throw new Error(`상품을 불러오지 못했습니다: ${error.message}`)
    }
    inactive += count ?? 0
  }
  return inactive
}

/**
 * Every 상품코드 that starts with `prefix` (ignoring case), at most 1,000.
 * Used to suggest a free code such as "100123-SET-2".
 */
export async function listCodesStartingWith(prefix: string): Promise<string[]> {
  const supabase = await createClient()
  // "_" is a LIKE wildcard: escape it (codes cannot contain % or \).
  const pattern = `${prefix.replace(/[\\%_]/g, (character) => `\\${character}`)}%`
  const { data, error } = await supabase
    .from("products")
    .select("code")
    .ilike("code", pattern)
    .limit(1000)
  if (error) {
    throw new Error(`상품코드를 확인하지 못했습니다: ${error.message}`)
  }
  return data.map((row) => row.code)
}

// ---------------------------------------------------------------------------
// One product
// ---------------------------------------------------------------------------

/** One category of a product's category path. */
export type ProductCategoryPathItem = {
  id: string
  name: string
  isActive: boolean
}

/** One product with its category, food information and 구성. */
export type ProductDetail = Tables<"products"> & {
  /**
   * The categories from the 대분류 down to the product's own category,
   * e.g. [수산물, 냉동수산, 새우]. Empty for a 미분류 product (or if the
   * category could not be found).
   */
  categoryPath: ProductCategoryPathItem[]
  /**
   * Food information in effect: a 기준상품's own values, or a 묶음상품's
   * values worked out from its 기준상품 (never typed).
   */
  foodInfo: FoodInfo
  /** 묶음상품: its 구성표 in screen order. Empty for a 기준상품. */
  components: BundleComponent[]
  /** 기준상품: the 묶음상품 that contain it. Empty for a 묶음상품. */
  bundles: ContainingBundle[]
  /**
   * The product has stock records (a 기준상품's 재고 로트, a 묶음상품's
   * 입고·출고 lines): its 단위 can no longer change (the database refuses,
   * PRODUCT_DB_RULES.unitHasStock).
   */
  hasStockRecords: boolean
}

/**
 * Whether a product has stock records (see ProductDetail.hasStockRecords).
 * False when they cannot be read (e.g. the 재고 migration is not applied
 * yet: then there is no stock either).
 */
async function productHasStockRecords(
  id: string,
  isBundle: boolean
): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = isBundle
    ? await supabase
        .from("stock_movements")
        .select("id")
        .eq("bundle_id", id)
        .limit(1)
    : await supabase
        .from("stock_lots")
        .select("id")
        .eq("product_id", id)
        .limit(1)
  if (error) return false
  return data.length > 0
}

/**
 * One product, or null when it does not exist or `id` is not a UUID
 * (so a mistyped address shows "not found" instead of an error).
 *
 * Wrapped in React `cache()`: callers in one request share one read.
 */
export const getProduct = cache(
  async (id: string): Promise<ProductDetail | null> => {
    if (!isUuid(id)) return null

    const supabase = await createClient()
    const [productResult, categories] = await Promise.all([
      supabase.from("products").select("*").eq("id", id).maybeSingle(),
      getAllCategories(),
    ])
    if (productResult.error) {
      throw new Error(
        `상품 정보를 불러오지 못했습니다: ${productResult.error.message}`
      )
    }

    const product = productResult.data
    if (!product) return null

    const isBundle = product.product_type === "bundle"
    const [components, bundles, hasStockRecords] = await Promise.all([
      isBundle ? getBundleComponents(product.id) : [],
      isBundle ? [] : getBundlesContainingProduct(product.id),
      productHasStockRecords(product.id, isBundle),
    ])

    const path =
      product.category_id === null
        ? []
        : findCategoryPath(categories, product.category_id)
    return {
      ...product,
      categoryPath: path.map((category) => ({
        id: category.id,
        name: category.name,
        isActive: category.isActive,
      })),
      foodInfo: isBundle
        ? deriveBundleFoodInfo(components)
        : {
            storageType: product.storage_type,
            taxType: product.tax_type,
            allergens: sortAllergens(product.allergens),
            shelfLifeDays: product.shelf_life_days,
            origin: product.origin,
            manufacturer: product.manufacturer,
          },
      components,
      bundles,
      hasStockRecords,
    }
  }
)
