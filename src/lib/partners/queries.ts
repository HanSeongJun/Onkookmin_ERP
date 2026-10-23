import "server-only"

import { cache } from "react"

import { getPartnerCategoryTree } from "@/lib/partner-categories/queries"
import {
  findCategory,
  findCategoryPath,
  formatCategoryPath,
  isCategorySelectable,
  type PartnerCategoryNode,
} from "@/lib/partner-categories/tree"
import type {
  CreditLimitType,
  PartnerIndustry,
  PartnerType,
  PaymentTerm,
} from "@/lib/partners/constants"
import {
  defaultPartnerListParams,
  PARTNER_EXPORT_MAX_ROWS,
  PARTNER_PAGE_SIZES,
  PARTNER_SEARCH_MAX_LENGTH,
  partnerSortState,
  partnerTypesOfFilter,
  REP_FILTER_NONE,
  type PartnerColumnId,
  type PartnerListParams,
} from "@/lib/partners/schema"
import { buildPartnerSearchFilter } from "@/lib/partners/search"
import { isUuid } from "@/lib/products/schema"
import { createClient } from "@/lib/supabase/server"
import type { Tables } from "@/types/database"

// Every function here reads request cookies (Supabase login) through the
// server client: call them inside a <Suspense> boundary (or a Route
// Handler / Server Action), never inside "use cache".

// ---------------------------------------------------------------------------
// The list query (shared by the list page and the 엑셀 download)
// ---------------------------------------------------------------------------

/**
 * One row of the partner_list_items view (see the partners migration).
 * Postgres reports every column of a view as "may be empty", so the
 * generated types add `| null`. The partners columns come straight from the
 * partners table, so its own types are used; the extra columns are typed
 * here by hand.
 */
export type PartnerListItem = Tables<"partners"> & {
  /** 거래처분류 name (the category itself); null = 미분류. */
  category_name: string | null
  /** The category's parent (null for a 대분류 or 미분류). */
  category_parent_id: string | null
  /** The parent's parent (set only for a 소분류). */
  category_grandparent_id: string | null
  /** "대분류 > 중분류 > 소분류" (shorter for higher levels); null = 미분류. */
  category_path: string | null
  /** Sort orders from the 대분류 down (for sorting by 거래처분류). */
  category_sort_key: number[] | null
  /** False when the category or one above it is 사용 중지; null = 미분류. */
  category_is_active: boolean | null
  /** 영업담당 employee; null = none. */
  sales_rep_code: string | null
  sales_rep_name: string | null
  /** 재직 (true) / 퇴사 (false). */
  sales_rep_is_active: boolean | null
  /** Whether the employee still has 담당업무 영업담당. */
  sales_rep_has_duty: boolean | null
  /** 배송담당 employee; null = none. */
  delivery_rep_code: string | null
  delivery_rep_name: string | null
  delivery_rep_is_active: boolean | null
  /** Whether the employee still has 담당업무 배송담당. */
  delivery_rep_has_duty: boolean | null
  /** The 기본 배송지 (all null when the partner has no 배송지). */
  default_address_id: string | null
  default_address_label: string | null
  default_address_postal_code: string | null
  default_address: string | null
  default_address_detail: string | null
  /** 주소 + " " + 상세주소 of the 기본 배송지. */
  default_address_text: string | null
  contact_count: number
  address_count: number
}

/**
 * The partner_list_items columns behind each sortable grid column. Enum
 * columns sort in their declared order: 구분 매출처 → 매입처 → 매출·매입;
 * 업종 in the PARTNER_INDUSTRIES order; 결제일 건별 즉시 → 매월 1…28일 →
 * 매월 말일 → 미지정; 외상한도 외상 불가 → 한도 금액 (small first) →
 * 무제한. 거래처분류 follows the order set in 분류값 설정 (대분류 first,
 * then its 중분류 and 소분류). 사용여부:
 * 미사용 → 사용.
 */
const SORT_COLUMNS = {
  type: ["partner_type"],
  code: ["code"],
  name: ["name"],
  representative: ["representative"],
  business_number: ["business_number"],
  phone: ["phone"],
  sales_rep: ["sales_rep_name"],
  delivery_rep: ["delivery_rep_name"],
  industry: ["industry"],
  category: ["category_sort_key", "category_path"],
  address: ["default_address_text"],
  payment: ["payment_term", "payment_day"],
  credit: ["credit_limit_type", "credit_limit"],
  status: ["is_active"],
} as const satisfies Record<PartnerColumnId, readonly string[]>

/**
 * Prepares the list query for the given search and filters. `build()` makes
 * a fresh request each time (one page, the count only, or a batch for the
 * 엑셀 download), always with the same filters and a stable sort order.
 */
async function prepareListQuery(params: PartnerListParams) {
  const supabase = await createClient()
  const search = params.q.trim().slice(0, PARTNER_SEARCH_MAX_LENGTH)

  // The chosen 거래처분류 (any level) includes every category below it:
  // the view has the partner's category and the two above it. A category
  // id that does not exist (deleted, typed by hand) is ignored, like the
  // 상품 list's category filter.
  let categoryFilter: string | null = null
  if (!params.uncategorized && isUuid(params.categoryId)) {
    const tree = await getPartnerCategoryTree()
    const category = findCategory(tree, params.categoryId.toLowerCase())
    if (category) {
      categoryFilter = [
        `category_id.eq.${category.id}`,
        `category_parent_id.eq.${category.id}`,
        `category_grandparent_id.eq.${category.id}`,
      ].join(",")
    }
  }

  function build({ countOnly = false, withCount = true } = {}) {
    let query = supabase.from("partner_list_items").select("*", {
      count: withCount ? "exact" : undefined,
      head: countOnly,
    })

    if (search) query = query.or(buildPartnerSearchFilter(search))
    if (params.partnerType) {
      query = query.in("partner_type", partnerTypesOfFilter(params.partnerType))
    }
    if (params.uncategorized) {
      query = query.is("category_id", null)
    } else if (categoryFilter) {
      query = query.or(categoryFilter)
    }
    if (params.salesRepId === REP_FILTER_NONE) {
      query = query.is("sales_rep_id", null)
    } else if (isUuid(params.salesRepId)) {
      query = query.eq("sales_rep_id", params.salesRepId.toLowerCase())
    }
    if (params.deliveryRepId === REP_FILTER_NONE) {
      query = query.is("delivery_rep_id", null)
    } else if (isUuid(params.deliveryRepId)) {
      query = query.eq("delivery_rep_id", params.deliveryRepId.toLowerCase())
    }
    if (params.industry) query = query.eq("industry", params.industry)
    if (params.status === "active") query = query.eq("is_active", true)
    if (params.status === "inactive") query = query.eq("is_active", false)

    // Rows with equal values follow 거래처코드, then id, so the order is the
    // same every time and no partner shows up on two pages. Empty values
    // come last, whichever the direction.
    const sort = partnerSortState(params.sort)
    if (sort === null) {
      query = query.order("created_at", { ascending: false })
    } else {
      const ascending = sort.direction === "asc"
      for (const column of SORT_COLUMNS[sort.column]) {
        query = query.order(column, { ascending, nullsFirst: false })
      }
      if (sort.column !== "code") query = query.order("code")
    }
    return query.order("id")
  }

  return { build }
}

// ---------------------------------------------------------------------------
// The 거래처 list
// ---------------------------------------------------------------------------

/**
 * One row of the 거래처 list. Phone numbers and 사업자번호 are digits only:
 * show them with formatPhone / formatBusinessNumber
 * (`@/lib/partners/phone`, `@/lib/partners/business-number`).
 */
export type PartnerListRow = {
  id: string
  /** 구분 (매출처 / 매입처 / 매출·매입): partnerTypeLabel. */
  partnerType: PartnerType
  code: string
  name: string
  /** 대표자명. */
  representative: string | null
  /** 상호(법인명). */
  companyName: string | null
  /** 사업자등록번호, 10 digits. */
  businessNumber: string | null
  /** 대표연락처, digits. */
  phone: string | null
  salesRepCode: string | null
  salesRepName: string | null
  /** False when the 영업담당 is 퇴사 (null when none). */
  salesRepIsActive: boolean | null
  /** False when the employee lost 담당업무 영업담당 (null when none). */
  salesRepHasDuty: boolean | null
  deliveryRepCode: string | null
  deliveryRepName: string | null
  /** False when the 배송담당 is 퇴사 (null when none). */
  deliveryRepIsActive: boolean | null
  /** False when the employee lost 담당업무 배송담당 (null when none). */
  deliveryRepHasDuty: boolean | null
  /** 업종 (partnerIndustryLabel), null = 미지정. */
  industry: PartnerIndustry | null
  /** 거래처분류 id (any level); null = 미분류. */
  categoryId: string | null
  /** 거래처분류 name (the category itself); null = 미분류. */
  categoryName: string | null
  /**
   * 적용분류: "대분류 > 중분류 > 소분류"; null = 미분류
   * (UNCATEGORIZED_PARTNER_LABEL).
   */
  categoryPath: string | null
  /**
   * False when the category or one above it is 사용 중지 (null when
   * 미분류).
   */
  categoryIsActive: boolean | null
  /** 기본 배송지: 주소 + 상세주소, null when the partner has no 배송지. */
  defaultAddress: string | null
  defaultAddressLabel: string | null
  defaultPostalCode: string | null
  /** 결제일: formatPaymentTerm(paymentTerm, paymentDay). */
  paymentTerm: PaymentTerm
  paymentDay: number | null
  /** 외상한도: formatCreditLimit(creditLimitType, creditLimit). */
  creditLimitType: CreditLimitType
  creditLimit: number | null
  isActive: boolean
  contactCount: number
  addressCount: number
}

export type PartnerList = {
  rows: PartnerListRow[]
  /** Number of partners matching the search and filters (all pages). */
  total: number
  /** The page shown (clamped to the last page). */
  page: number
  /** Number of pages (at least 1). */
  pageCount: number
}

/**
 * One page of the 거래처 list, with search, filters and sort (see
 * PartnerListParams). A page number past the end shows the last page.
 */
export async function listPartners(
  options: Partial<PartnerListParams> = {}
): Promise<PartnerList> {
  const params = { ...defaultPartnerListParams, ...options }
  const pageSize = PARTNER_PAGE_SIZES.includes(params.pageSize)
    ? params.pageSize
    : defaultPartnerListParams.pageSize
  const { build } = await prepareListQuery(params)

  function fetchPage(page: number) {
    const from = (page - 1) * pageSize
    return build()
      .range(from, from + pageSize - 1)
      .overrideTypes<PartnerListItem[], { merge: false }>()
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
      throw new Error(`거래처 목록을 불러오지 못했습니다: ${error.message}`)
    }
    page = Math.max(Math.ceil((count ?? 0) / pageSize), 1)
    result = await fetchPage(page)
  }

  if (result.error) {
    throw new Error(
      `거래처 목록을 불러오지 못했습니다: ${result.error.message}`
    )
  }

  const total = result.count ?? result.data.length
  return {
    rows: result.data.map(toPartnerListRow),
    total,
    page,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
  }
}

function toPartnerListRow(item: PartnerListItem): PartnerListRow {
  return {
    id: item.id,
    partnerType: item.partner_type,
    code: item.code,
    name: item.name,
    representative: item.representative,
    companyName: item.company_name,
    businessNumber: item.business_number,
    phone: item.phone,
    salesRepCode: item.sales_rep_code,
    salesRepName: item.sales_rep_name,
    salesRepIsActive: item.sales_rep_is_active,
    salesRepHasDuty: item.sales_rep_has_duty,
    deliveryRepCode: item.delivery_rep_code,
    deliveryRepName: item.delivery_rep_name,
    deliveryRepIsActive: item.delivery_rep_is_active,
    deliveryRepHasDuty: item.delivery_rep_has_duty,
    industry: item.industry,
    categoryId: item.category_id,
    categoryName: item.category_name,
    categoryPath: item.category_path,
    categoryIsActive: item.category_is_active,
    defaultAddress: item.default_address_text,
    defaultAddressLabel: item.default_address_label,
    defaultPostalCode: item.default_address_postal_code,
    paymentTerm: item.payment_term,
    paymentDay: item.payment_day,
    creditLimitType: item.credit_limit_type,
    creditLimit: item.credit_limit,
    isActive: item.is_active,
    contactCount: item.contact_count,
    addressCount: item.address_count,
  }
}

/**
 * Whether at least one partner exists (사용 or 미사용). Used to tell "no
 * partners yet" apart from "nothing matches the filters".
 */
export async function hasAnyPartners(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("partners").select("id").limit(1)
  if (error) {
    throw new Error(`거래처 목록을 불러오지 못했습니다: ${error.message}`)
  }
  return data.length > 0
}

// ---------------------------------------------------------------------------
// 엑셀 download
// ---------------------------------------------------------------------------

/** Rows asked for per request (the API returns at most 1,000 at a time). */
const EXPORT_BATCH_SIZE = 1000

/**
 * Every partner matching the list's search and filters (all pages, in the
 * list's sort order), at most PARTNER_EXPORT_MAX_ROWS, as rows of the
 * partner_list_items view (turn them into a file with buildPartnerCsv in
 * `@/lib/partners/export`). `total` is the number of matching partners,
 * which may be more than the rows returned.
 */
export async function listPartnersForExport(
  options: Partial<PartnerListParams> = {}
): Promise<{ rows: PartnerListItem[]; total: number }> {
  const params = { ...defaultPartnerListParams, ...options }
  const { build } = await prepareListQuery(params)

  const rows: PartnerListItem[] = []
  let total = 0
  while (rows.length < PARTNER_EXPORT_MAX_ROWS) {
    const from = rows.length
    const to = Math.min(from + EXPORT_BATCH_SIZE, PARTNER_EXPORT_MAX_ROWS) - 1
    const isFirst = from === 0
    const { data, error, count } = await build({ withCount: isFirst })
      .range(from, to)
      .overrideTypes<PartnerListItem[], { merge: false }>()
    if (error) {
      throw new Error(`거래처 목록을 불러오지 못했습니다: ${error.message}`)
    }
    if (isFirst) total = count ?? data.length
    rows.push(...data)
    // Stop at the end. (Not "fewer rows than asked": the API may send fewer
    // per request than we ask for.)
    if (data.length === 0 || rows.length >= total) break
  }

  return { rows, total: Math.max(total, rows.length) }
}

// ---------------------------------------------------------------------------
// One partner
// ---------------------------------------------------------------------------

/** The 거래처분류 a partner is in, as the form shows it. */
export type PartnerCategoryReference = {
  id: string
  name: string
  /** "대분류 > 중분류 > 소분류" ("-" if it is no longer in the tree). */
  path: string
  /**
   * False when it (or a category above it) was switched off after it was
   * chosen: the partner keeps it, but it can't be newly chosen.
   */
  isActive: boolean
}

/**
 * The 영업담당 / 배송담당 a partner points to, as the form shows it
 * (formatEmployeeLabel in `@/lib/employees/schema` adds "(퇴사)" or
 * "(영업담당 해제)" when the partner keeps one that can't be newly chosen).
 */
export type PartnerEmployeeReference = {
  id: string
  code: string
  name: string
  /** 재직 (true) / 퇴사 (false). */
  isActive: boolean
  isSalesRep: boolean
  isDeliveryDriver: boolean
  vehicleNumber: string | null
}

/** Another partner with the same 사업자등록번호 (non-blocking warning). */
export type SameBusinessNumberPartner = {
  id: string
  code: string
  name: string
  partnerType: PartnerType
  isActive: boolean
}

/** One partner with its 담당자, 배송지 and the names it points to. */
export type PartnerDetail = Tables<"partners"> & {
  /** 담당자 in screen order. */
  contacts: Tables<"partner_contacts">[]
  /** 배송지 in screen order (exactly one is_default when any). */
  addresses: Tables<"partner_addresses">[]
  /** 거래처분류; null = 미분류. */
  category: PartnerCategoryReference | null
  salesRep: PartnerEmployeeReference | null
  deliveryRep: PartnerEmployeeReference | null
  /** Other partners with the same 사업자등록번호 (empty when none). */
  sameBusinessNumberPartners: SameBusinessNumberPartner[]
}

/**
 * One partner, or null when it does not exist or `id` is not a UUID (so a
 * mistyped address shows "not found" instead of an error).
 *
 * Wrapped in React `cache()`: callers in one request share one read.
 */
export const getPartner = cache(
  async (id: string): Promise<PartnerDetail | null> => {
    if (!isUuid(id)) return null
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("partners")
      .select(
        "*, contacts:partner_contacts(*), addresses:partner_addresses(*), sales_rep:employees!partners_sales_rep_id_fkey(id, code, name, is_active, is_sales_rep, is_delivery_driver, vehicle_number), delivery_rep:employees!partners_delivery_rep_id_fkey(id, code, name, is_active, is_sales_rep, is_delivery_driver, vehicle_number)"
      )
      .eq("id", id.toLowerCase())
      .order("sort_order", { referencedTable: "partner_contacts" })
      .order("created_at", { referencedTable: "partner_contacts" })
      .order("sort_order", { referencedTable: "partner_addresses" })
      .order("created_at", { referencedTable: "partner_addresses" })
      .maybeSingle()
    if (error) {
      throw new Error(`거래처 정보를 불러오지 못했습니다: ${error.message}`)
    }
    if (!data) return null

    const {
      contacts,
      addresses,
      sales_rep: salesRep,
      delivery_rep: deliveryRep,
      ...partner
    } = data
    return {
      ...partner,
      contacts,
      addresses,
      category: partner.category_id
        ? toCategoryReference(
            await getPartnerCategoryTree(),
            partner.category_id
          )
        : null,
      salesRep: toEmployeeReference(salesRep),
      deliveryRep: toEmployeeReference(deliveryRep),
      sameBusinessNumberPartners: partner.business_number
        ? await findPartnersByBusinessNumber(
            partner.business_number,
            partner.id
          )
        : [],
    }
  }
)

function toCategoryReference(
  tree: PartnerCategoryNode[],
  categoryId: string
): PartnerCategoryReference {
  const path = findCategoryPath(tree, categoryId)
  return {
    id: categoryId,
    name: path.at(-1)?.name ?? "-",
    path: formatCategoryPath(path) || "-",
    isActive: isCategorySelectable(tree, categoryId),
  }
}

function toEmployeeReference(
  row: {
    id: string
    code: string
    name: string
    is_active: boolean
    is_sales_rep: boolean
    is_delivery_driver: boolean
    vehicle_number: string | null
  } | null
): PartnerEmployeeReference | null {
  if (!row) return null
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    isActive: row.is_active,
    isSalesRep: row.is_sales_rep,
    isDeliveryDriver: row.is_delivery_driver,
    vehicleNumber: row.vehicle_number,
  }
}

/** Most partners the 사업자번호 warning lists. */
const SAME_BUSINESS_NUMBER_LIMIT = 20

/**
 * The partners (사용 and 미사용) with this 사업자등록번호 (10 digits),
 * except `excludeId` (the partner being edited), in 거래처코드 order. The
 * number is not unique: this is only for a warning.
 */
export async function findPartnersByBusinessNumber(
  businessNumber: string,
  excludeId: string | null = null
): Promise<SameBusinessNumberPartner[]> {
  if (!/^[0-9]{10}$/.test(businessNumber)) return []
  const supabase = await createClient()
  let query = supabase
    .from("partners")
    .select("id, code, name, partner_type, is_active")
    .eq("business_number", businessNumber)
  if (isUuid(excludeId)) query = query.neq("id", excludeId.toLowerCase())
  const { data, error } = await query
    .order("code")
    .limit(SAME_BUSINESS_NUMBER_LIMIT)
  if (error) {
    throw new Error(`사업자등록번호를 확인하지 못했습니다: ${error.message}`)
  }
  return data.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    partnerType: row.partner_type,
    isActive: row.is_active,
  }))
}

/**
 * Whether another partner already uses this 거래처코드 (ignoring case).
 * `excludeId` = the partner being edited.
 */
export async function isPartnerCodeTaken(
  code: string,
  excludeId: string | null = null
): Promise<boolean> {
  const supabase = await createClient()
  // "_" is a LIKE wildcard: escape it (codes cannot contain % or \), so
  // ilike compares the whole code ignoring case.
  let query = supabase
    .from("partners")
    .select("id")
    .ilike(
      "code",
      code.replace(/[\\%_]/g, (character) => `\\${character}`)
    )
  if (isUuid(excludeId)) query = query.neq("id", excludeId.toLowerCase())
  const { data, error } = await query.limit(1)
  if (error) {
    throw new Error(`거래처코드를 확인하지 못했습니다: ${error.message}`)
  }
  return data.length > 0
}
