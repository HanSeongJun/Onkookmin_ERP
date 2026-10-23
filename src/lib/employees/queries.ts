import "server-only"

import { cache } from "react"

import {
  defaultEmployeeListParams,
  EMPLOYEE_EXPORT_MAX_ROWS,
  EMPLOYEE_PAGE_SIZES,
  EMPLOYEE_SEARCH_MAX_LENGTH,
  employeeSortState,
  type DriverOperationType,
  type EmployeeColumnId,
  type EmployeeListParams,
  type EmployeeOption,
  type EmploymentType,
  type VehicleType,
} from "@/lib/employees/schema"
import { buildEmployeeSearchFilter } from "@/lib/partners/search"
import { isUuid } from "@/lib/products/schema"
import { createClient } from "@/lib/supabase/server"
import type { Tables } from "@/types/database"

// Every function here reads request cookies (Supabase login) through the
// server client: call them inside a <Suspense> boundary (or a Route
// Handler / Server Action), never inside "use cache".

export type { EmployeeOption } from "@/lib/employees/schema"

// ---------------------------------------------------------------------------
// The list query (shared by the list page and the 엑셀 download)
// ---------------------------------------------------------------------------

/**
 * One row of the employee_list_items view: every employees column, plus
 * the address as one text and the partner counts. (Postgres reports view
 * columns as "may be empty"; the employees columns keep their own types.)
 */
export type EmployeeListItem = Tables<"employees"> & {
  /** 주소 + " " + 상세주소; null when there is no 주소. */
  address_text: string | null
  /** 거래처 whose 영업담당 is this employee (사용 and 미사용). */
  sales_partner_count: number
  /** 거래처 whose 배송담당 is this employee (사용 and 미사용). */
  delivery_partner_count: number
  /** 거래처 with this employee as 영업담당 or 배송담당 (each once). */
  partner_count: number
}

/**
 * The employee_list_items columns behind each sortable grid column. Enum
 * columns sort in their declared order (고용형태 정규직 → … → 기타;
 * 운영형태 직영 → 지입 → 용차); yes/no columns N → Y; 재직여부 퇴사 → 재직.
 */
const SORT_COLUMNS = {
  code: ["code"],
  name: ["name"],
  mobile: ["mobile"],
  address: ["address_text"],
  department: ["department"],
  job_title: ["job_title"],
  employment_type: ["employment_type"],
  sales_rep: ["is_sales_rep"],
  delivery_driver: ["is_delivery_driver"],
  operation_type: ["driver_operation_type"],
  vehicle_number: ["vehicle_number"],
  status: ["is_active"],
  hire_date: ["hire_date"],
  resignation_date: ["resignation_date"],
  salary: ["is_salary_paid"],
  partner_count: ["partner_count"],
} as const satisfies Record<EmployeeColumnId, readonly string[]>

/**
 * The list query for the given search and filters. `build()` makes a fresh
 * request each time (one page, the count only, or a batch for 엑셀), always
 * with the same filters and a stable order (ties: 직원코드, then id).
 */
async function prepareListQuery(params: EmployeeListParams) {
  const supabase = await createClient()
  const search = params.q.trim().slice(0, EMPLOYEE_SEARCH_MAX_LENGTH)

  function build({ countOnly = false, withCount = true } = {}) {
    let query = supabase.from("employee_list_items").select("*", {
      count: withCount ? "exact" : undefined,
      head: countOnly,
    })
    if (search) query = query.or(buildEmployeeSearchFilter(search))
    if (params.status === "active") query = query.eq("is_active", true)
    if (params.status === "inactive") query = query.eq("is_active", false)
    if (params.duty === "sales") query = query.eq("is_sales_rep", true)
    if (params.duty === "delivery") query = query.eq("is_delivery_driver", true)

    const sort = employeeSortState(params.sort)
    const ascending = sort.direction === "asc"
    for (const column of SORT_COLUMNS[sort.column]) {
      query = query.order(column, { ascending, nullsFirst: false })
    }
    if (sort.column !== "code") query = query.order("code")
    return query.order("id")
  }

  return { build }
}

/**
 * One row of the 직원 list. Phone numbers are digits only (show them with
 * formatPhone from `@/lib/partners/phone`); dates are "YYYY-MM-DD".
 */
export type EmployeeListRow = {
  id: string
  code: string
  name: string
  /** 휴대폰번호1 (digits; null for an old row without one). */
  mobile: string | null
  mobile2: string | null
  /** 전화번호 (digits). */
  phone: string | null
  email: string | null
  /** 주소 + 상세주소 (null when there is no 주소). */
  address: string | null
  postalCode: string | null
  department: string | null
  /** 직급/직책. */
  jobTitle: string | null
  employmentType: EmploymentType | null
  isSalesRep: boolean
  isDeliveryDriver: boolean
  driverOperationType: DriverOperationType | null
  vehicleNumber: string | null
  vehicleType: VehicleType | null
  /** 재직 (true) / 퇴사 (false). */
  isActive: boolean
  hireDate: string
  resignationDate: string | null
  isSalaryPaid: boolean
  note: string | null
  salesPartnerCount: number
  deliveryPartnerCount: number
  /** 담당 거래처 수 (영업담당 or 배송담당, each partner once). */
  partnerCount: number
}

export type EmployeeList = {
  rows: EmployeeListRow[]
  /** Employees matching the search and filters (all pages). */
  total: number
  /** The page shown (clamped to the last page). */
  page: number
  /** Number of pages (at least 1). */
  pageCount: number
}

/**
 * One page of the 직원 list with search, filters and sort (see
 * EmployeeListParams). A page number past the end shows the last page.
 */
export async function listEmployees(
  options: Partial<EmployeeListParams> = {}
): Promise<EmployeeList> {
  const params = { ...defaultEmployeeListParams, ...options }
  const pageSize = EMPLOYEE_PAGE_SIZES.includes(params.pageSize)
    ? params.pageSize
    : defaultEmployeeListParams.pageSize
  const { build } = await prepareListQuery(params)

  function fetchPage(page: number) {
    const from = (page - 1) * pageSize
    return build()
      .range(from, from + pageSize - 1)
      .overrideTypes<EmployeeListItem[], { merge: false }>()
  }

  let page = Math.max(Math.floor(params.page), 1)
  let result = await fetchPage(page)

  // Past the last page: PostgREST answers PGRST103 ("range not
  // satisfiable"), or no rows when the offset is exactly the total.
  if (
    page > 1 &&
    (result.error?.code === "PGRST103" ||
      (!result.error && result.data.length === 0))
  ) {
    const { count, error } = await build({ countOnly: true })
    if (error) {
      throw new Error(`직원 목록을 불러오지 못했습니다: ${error.message}`)
    }
    page = Math.max(Math.ceil((count ?? 0) / pageSize), 1)
    result = await fetchPage(page)
  }

  if (result.error) {
    throw new Error(`직원 목록을 불러오지 못했습니다: ${result.error.message}`)
  }

  const total = result.count ?? result.data.length
  return {
    rows: result.data.map(toEmployeeListRow),
    total,
    page,
    pageCount: Math.max(Math.ceil(total / pageSize), 1),
  }
}

function toEmployeeListRow(item: EmployeeListItem): EmployeeListRow {
  return {
    id: item.id,
    code: item.code,
    name: item.name,
    mobile: item.mobile,
    mobile2: item.mobile2,
    phone: item.phone,
    email: item.email,
    address: item.address_text,
    postalCode: item.postal_code,
    department: item.department,
    jobTitle: item.job_title,
    employmentType: item.employment_type,
    isSalesRep: item.is_sales_rep,
    isDeliveryDriver: item.is_delivery_driver,
    driverOperationType: item.driver_operation_type,
    vehicleNumber: item.vehicle_number,
    vehicleType: item.vehicle_type,
    isActive: item.is_active,
    hireDate: item.hire_date,
    resignationDate: item.resignation_date,
    isSalaryPaid: item.is_salary_paid,
    note: item.note,
    salesPartnerCount: item.sales_partner_count,
    deliveryPartnerCount: item.delivery_partner_count,
    partnerCount: item.partner_count,
  }
}

/** Rows asked for per request (the API returns at most 1,000 at a time). */
const EXPORT_BATCH_SIZE = 1000

/**
 * Every employee matching the list's search and filters (all pages, in the
 * list's order), at most EMPLOYEE_EXPORT_MAX_ROWS, for the 엑셀 download
 * (buildEmployeeCsv in `@/lib/employees/export`). `total` = all matching
 * employees, which may be more than the rows returned.
 */
export async function listEmployeesForExport(
  options: Partial<EmployeeListParams> = {}
): Promise<{ rows: EmployeeListItem[]; total: number }> {
  const params = { ...defaultEmployeeListParams, ...options }
  const { build } = await prepareListQuery(params)

  const rows: EmployeeListItem[] = []
  let total = 0
  while (rows.length < EMPLOYEE_EXPORT_MAX_ROWS) {
    const from = rows.length
    const to = Math.min(from + EXPORT_BATCH_SIZE, EMPLOYEE_EXPORT_MAX_ROWS) - 1
    const isFirst = from === 0
    const { data, error, count } = await build({ withCount: isFirst })
      .range(from, to)
      .overrideTypes<EmployeeListItem[], { merge: false }>()
    if (error) {
      throw new Error(`직원 목록을 불러오지 못했습니다: ${error.message}`)
    }
    if (isFirst) total = count ?? data.length
    rows.push(...data)
    if (data.length === 0 || rows.length >= total) break
  }

  return { rows, total: Math.max(total, rows.length) }
}

/** Whether at least one employee exists (재직 or 퇴사). */
export async function hasAnyEmployees(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("employees").select("id").limit(1)
  if (error) {
    throw new Error(`직원 목록을 불러오지 못했습니다: ${error.message}`)
  }
  return data.length > 0
}

// ---------------------------------------------------------------------------
// One employee
// ---------------------------------------------------------------------------

/**
 * One employee for the 직원 수정 modal, with how many partners have them as
 * 영업담당 / 배송담당 (e.g. to tell the user those partners keep them when
 * a 담당업무 is unchecked or they are switched to 퇴사).
 */
export type EmployeeDetail = Tables<"employees"> & {
  salesPartnerCount: number
  deliveryPartnerCount: number
}

/**
 * One employee, or null when there is none or `id` is not a UUID.
 */
export async function getEmployee(id: string): Promise<EmployeeDetail | null> {
  if (!isUuid(id)) return null
  const supabase = await createClient()
  const employeeId = id.toLowerCase()
  const [employee, counts] = await Promise.all([
    supabase.from("employees").select("*").eq("id", employeeId).maybeSingle(),
    supabase
      .from("employee_list_items")
      .select("sales_partner_count, delivery_partner_count")
      .eq("id", employeeId)
      .maybeSingle(),
  ])
  const error = employee.error ?? counts.error
  if (error) {
    throw new Error(`직원 정보를 불러오지 못했습니다: ${error.message}`)
  }
  if (!employee.data) return null
  return {
    ...employee.data,
    salesPartnerCount: counts.data?.sales_partner_count ?? 0,
    deliveryPartnerCount: counts.data?.delivery_partner_count ?? 0,
  }
}

/** Most employees the pickers offer (a company has far fewer). */
const EMPLOYEE_OPTIONS_MAX = 1000

/**
 * Every employee (재직 and 퇴사) as choices for 영업담당 / 배송담당 and the
 * list filters, in 직원명 order, with the number of partners that have
 * them as 영업담당 / 배송담당. Forms offer the 재직 ones with the
 * 담당업무 plus the current one (selectableEmployees); filters use
 * employeesWithDuty (`@/lib/employees/schema`).
 *
 * Wrapped in React `cache()`: callers in one request share one read.
 */
export const getEmployeeOptions = cache(async (): Promise<EmployeeOption[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("employee_list_items")
    .select(
      "id, code, name, department, job_title, is_active, is_sales_rep, is_delivery_driver, vehicle_number, sales_partner_count, delivery_partner_count"
    )
    .order("name")
    .order("code")
    .limit(EMPLOYEE_OPTIONS_MAX)
    .overrideTypes<
      Pick<
        EmployeeListItem,
        | "id"
        | "code"
        | "name"
        | "department"
        | "job_title"
        | "is_active"
        | "is_sales_rep"
        | "is_delivery_driver"
        | "vehicle_number"
        | "sales_partner_count"
        | "delivery_partner_count"
      >[],
      { merge: false }
    >()
  if (error) {
    throw new Error(`직원 목록을 불러오지 못했습니다: ${error.message}`)
  }
  return data.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    department: row.department,
    jobTitle: row.job_title,
    isActive: row.is_active,
    isSalesRep: row.is_sales_rep,
    isDeliveryDriver: row.is_delivery_driver,
    vehicleNumber: row.vehicle_number,
    salesPartnerCount: row.sales_partner_count,
    deliveryPartnerCount: row.delivery_partner_count,
  }))
})

/**
 * Whether another employee already uses this 직원코드 (ignoring case).
 * `excludeId` = the employee being edited.
 */
export async function isEmployeeCodeTaken(
  code: string,
  excludeId: string | null = null
): Promise<boolean> {
  const supabase = await createClient()
  // "_" is a LIKE wildcard: escape it (codes cannot contain % or \), so
  // ilike compares the whole code ignoring case.
  let query = supabase
    .from("employees")
    .select("id")
    .ilike(
      "code",
      code.replace(/[\\%_]/g, (character) => `\\${character}`)
    )
  if (isUuid(excludeId)) query = query.neq("id", excludeId.toLowerCase())
  const { data, error } = await query.limit(1)
  if (error) {
    throw new Error(`직원코드를 확인하지 못했습니다: ${error.message}`)
  }
  return data.length > 0
}

/**
 * The 직원코드 to suggest for a new employee: the highest code made only of
 * digits + 1, at least 4 digits (0001, 0002, …). Database function
 * suggest_employee_code.
 */
export async function getSuggestedEmployeeCode(): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("suggest_employee_code")
  if (error) {
    throw new Error(`직원코드를 만들지 못했습니다: ${error.message}`)
  }
  return data
}
