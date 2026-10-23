/**
 * 직원 (employees): the company's staff list, managed on the 직원관리 screen
 * (/employees, sidebar group 기초정보). Not linked to login accounts. Never
 * deleted: 재직여부 (is_active) 재직 / 퇴사.
 *
 * 담당업무 (an employee may have both, or neither):
 * - 영업담당 (is_sales_rep): a sales channel / platform such as 쿠팡,
 *   스마트스토어 or 배민상회 (later shown on 매출/매입 내역: which platform
 *   an order was sold through), or a salesperson.
 * - 배송담당 (is_delivery_driver): a driver who delivers a partner's orders
 *   (직배송 기사), with 배송기사 정보 (운영형태, 차량번호, 차량 종류).
 * A partner can newly choose only a 재직 employee with the matching
 * 담당업무; partners keep one whose status or 담당업무 changed later.
 *
 * Shared by the browser and the server:
 * - employeeFormSchema: the 직원 등록/수정 form;
 * - choices and labels (고용형태, 운영형태, 차량 종류, 재직/퇴사, Y/N);
 * - the 영업담당 / 배송담당 pickers of the 거래처 form (EmployeeOption);
 * - the list URL (search, filters, sort, page, page size), its grid
 *   columns, and the modal URL (?modal=new, ?modal=edit&id=<uuid>);
 * - employeeIdsSchema: 선택 재직 / 선택 퇴사.
 *
 * The database checks the same rules (employees in
 * supabase/migrations/*_partners.sql and
 * *_partner_categories_tree_employees_v2.sql). No server imports here.
 */

import { z } from "zod"

import { formatDate } from "@/lib/format"
import {
  optionalEmail,
  optionalPhone,
  optionalText,
  requiredText,
} from "@/lib/partners/schema"
import {
  PHONE_EXAMPLES,
  formatPhone,
  isValidPhone,
  toPhoneDigits,
} from "@/lib/partners/phone"
import { isUuid } from "@/lib/products/schema"
import { Constants, type Enums, type Tables } from "@/types/database"

// ---------------------------------------------------------------------------
// Choices and labels
// ---------------------------------------------------------------------------

/** Maximum lengths (characters); the database checks the same. */
export const EMPLOYEE_LIMITS = {
  codeMaxLength: 30,
  nameMaxLength: 30,
  departmentMaxLength: 50,
  jobTitleMaxLength: 50,
  emailMaxLength: 254,
  addressMaxLength: 200,
  addressDetailMaxLength: 200,
  vehicleNumberMaxLength: 20,
  noteMaxLength: 1000,
} as const

/** 직원코드: 1–30 letters, digits, ".", "_" or "-" (same as 상품코드). */
export const EMPLOYEE_CODE_PATTERN = /^[A-Za-z0-9._-]{1,30}$/

/** Database value of 고용형태, e.g. "regular". */
export type EmploymentType = Enums<"employment_type">

/** 고용형태 choices, in display order (optional: "" = 미지정). */
export const EMPLOYMENT_TYPES = [
  { value: "regular", label: "정규직" },
  { value: "contract", label: "계약직" },
  { value: "daily", label: "일용직" },
  { value: "freelancer", label: "프리랜서" },
  { value: "other", label: "기타" },
] as const satisfies readonly { value: EmploymentType; label: string }[]

/** Database value of 운영형태 (배송기사), e.g. "direct". */
export type DriverOperationType = Enums<"driver_operation_type">

/**
 * 운영형태 choices (배송기사 정보, optional).
 * - 직영: the company's own vehicle and driver.
 * - 지입: the driver's own vehicle, registered with the company.
 * - 용차: a vehicle hired when needed.
 */
export const DRIVER_OPERATION_TYPES = [
  { value: "direct", label: "직영" },
  { value: "consigned", label: "지입" },
  { value: "chartered", label: "용차" },
] as const satisfies readonly { value: DriverOperationType; label: string }[]

/** Database value of 차량 종류, e.g. "frozen_truck". */
export type VehicleType = Enums<"vehicle_type">

/** 차량 종류 choices (배송기사 정보, optional). */
export const VEHICLE_TYPES = [
  { value: "refrigerated_truck", label: "냉장탑차" },
  { value: "frozen_truck", label: "냉동탑차" },
  { value: "box_truck", label: "일반탑차" },
  { value: "cargo_truck", label: "카고" },
  { value: "small_van", label: "소형(다마스·라보)" },
  { value: "other", label: "기타" },
] as const satisfies readonly { value: VehicleType; label: string }[]

/** Korean label of a 고용형태, e.g. "계약직". */
export function employmentTypeLabel(value: EmploymentType): string {
  return EMPLOYMENT_TYPES.find((type) => type.value === value)?.label ?? value
}

/** Korean label of a 운영형태, e.g. "지입". */
export function driverOperationTypeLabel(value: DriverOperationType): string {
  return (
    DRIVER_OPERATION_TYPES.find((type) => type.value === value)?.label ?? value
  )
}

/** Korean label of a 차량 종류, e.g. "냉동탑차". */
export function vehicleTypeLabel(value: VehicleType): string {
  return VEHICLE_TYPES.find((type) => type.value === value)?.label ?? value
}

/** 재직여부 as text: true → "재직", false → "퇴사". */
export function employeeStatusLabel(isActive: boolean): string {
  return isActive ? "재직" : "퇴사"
}

/** A yes/no column as the list shows it: "Y" / "N". */
export function yesNo(value: boolean): "Y" | "N" {
  return value ? "Y" : "N"
}

/**
 * Database constraint names a Server Action turns into a field error
 * (23505 = duplicate, the name is in `error.message`).
 */
export const EMPLOYEE_DB_CONSTRAINTS = {
  /** Same 직원코드 already used (ignoring case). */
  codeUnique: "employees_code_lower_key",
} as const

/** Shown under 직원코드 when another employee uses it. */
export const EMPLOYEE_CODE_TAKEN_MESSAGE = "이미 사용 중인 직원코드입니다."

/** Today in Korea as "YYYY-MM-DD" (the 입사일 of a new employee). */
export function todayInKorea(): string {
  return formatDate(new Date())
}

// ---------------------------------------------------------------------------
// 직원 등록/수정 form
// ---------------------------------------------------------------------------

const PHONE_HINT = `(예: ${PHONE_EXAMPLES})`

/** A date typed as "YYYY-MM-DD" that exists in the calendar (1950–2100). */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  if (year < 1950 || year > 2100) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** A select box of an enum: "" → null, otherwise one of `values`. */
function optionalChoice<T extends string>(
  values: readonly T[],
  message: string
) {
  return z.string({ error: message }).transform((value, ctx): T | null => {
    if (value === "") return null
    if (!(values as readonly string[]).includes(value)) {
      ctx.addIssue({ code: "custom", message })
      return z.NEVER
    }
    return value as T
  })
}

/** The form's fields, each checked on its own (see employeeFormSchema). */
const employeeFieldsSchema = z.object({
  // Top: 재직여부, 담당업무
  /** 재직여부: true = 재직, false = 퇴사. */
  isActive: z.boolean({ error: "재직여부를 선택해 주세요." }),
  /** 담당업무: 영업담당. */
  isSalesRep: z.boolean({ error: "담당업무를 다시 선택해 주세요." }),
  /** 담당업무: 배송담당. */
  isDeliveryDriver: z.boolean({ error: "담당업무를 다시 선택해 주세요." }),
  // 기본정보
  code: requiredText(
    "직원코드를 입력해 주세요.",
    EMPLOYEE_LIMITS.codeMaxLength,
    `직원코드는 ${EMPLOYEE_LIMITS.codeMaxLength}자 이하로 입력해 주세요.`
  ).regex(EMPLOYEE_CODE_PATTERN, {
    error:
      "직원코드는 영문, 숫자, 하이픈(-), 밑줄(_), 마침표(.)만 쓸 수 있습니다. (띄어쓰기 불가)",
  }),
  name: requiredText(
    "직원명을 입력해 주세요.",
    EMPLOYEE_LIMITS.nameMaxLength,
    `직원명은 ${EMPLOYEE_LIMITS.nameMaxLength}자 이하로 입력해 주세요.`
  ),
  /** 입사일 "YYYY-MM-DD" (required). */
  hireDate: z
    .string({ error: "입사일을 입력해 주세요." })
    .trim()
    .min(1, { error: "입사일을 입력해 주세요." })
    .refine(isCalendarDate, {
      error: "입사일을 날짜로 입력해 주세요. (예: 2026-03-02)",
    }),
  /** 휴대폰번호1 (required), typed with or without hyphens → digits. */
  mobile: z
    .string({ error: "휴대폰번호1을 입력해 주세요." })
    .transform((value, ctx) => {
      if (value.trim() === "") {
        ctx.addIssue({
          code: "custom",
          message: "휴대폰번호1을 입력해 주세요.",
        })
        return z.NEVER
      }
      const digits = toPhoneDigits(value)
      if (!isValidPhone(digits)) {
        ctx.addIssue({
          code: "custom",
          message: `휴대폰번호1을 확인해 주세요. ${PHONE_HINT}`,
        })
        return z.NEVER
      }
      return digits
    }),
  mobile2: optionalPhone(`휴대폰번호2를 확인해 주세요. ${PHONE_HINT}`),
  email: optionalEmail("이메일 주소를 확인해 주세요. (예: name@example.com)"),
  phone: optionalPhone(`전화번호를 확인해 주세요. ${PHONE_HINT}`),
  /** 우편번호: "" or 5 digits. */
  postalCode: z
    .string({ error: "우편번호는 숫자 5자리로 입력해 주세요." })
    .trim()
    .refine((value) => value === "" || /^[0-9]{5}$/.test(value), {
      error: "우편번호는 숫자 5자리로 입력해 주세요.",
    })
    .transform((value) => (value === "" ? null : value)),
  address: optionalText(
    EMPLOYEE_LIMITS.addressMaxLength,
    `주소는 ${EMPLOYEE_LIMITS.addressMaxLength}자 이하로 입력해 주세요.`
  ),
  addressDetail: optionalText(
    EMPLOYEE_LIMITS.addressDetailMaxLength,
    `상세주소는 ${EMPLOYEE_LIMITS.addressDetailMaxLength}자 이하로 입력해 주세요.`
  ),
  note: optionalText(
    EMPLOYEE_LIMITS.noteMaxLength,
    `비고는 ${EMPLOYEE_LIMITS.noteMaxLength.toLocaleString("ko-KR")}자 이하로 입력해 주세요.`
  ),
  // 소속정보
  department: optionalText(
    EMPLOYEE_LIMITS.departmentMaxLength,
    `부서명은 ${EMPLOYEE_LIMITS.departmentMaxLength}자 이하로 입력해 주세요.`
  ),
  jobTitle: optionalText(
    EMPLOYEE_LIMITS.jobTitleMaxLength,
    `직급/직책은 ${EMPLOYEE_LIMITS.jobTitleMaxLength}자 이하로 입력해 주세요.`
  ),
  /** 고용형태: "" = 미지정. */
  employmentType: optionalChoice(
    Constants.public.Enums.employment_type,
    "고용형태를 다시 선택해 주세요."
  ),
  /** 급여지급여부: true = Y. */
  isSalaryPaid: z.boolean({ error: "급여지급여부를 선택해 주세요." }),
  /** 퇴사일: "" or "YYYY-MM-DD"; only kept for a 퇴사 employee. */
  resignationDate: z
    .string({ error: "퇴사일을 날짜로 입력해 주세요." })
    .trim()
    .refine((value) => value === "" || isCalendarDate(value), {
      error: "퇴사일을 날짜로 입력해 주세요. (예: 2026-09-30)",
    }),
  // 배송기사 정보 (only kept for a 배송담당)
  driverOperationType: optionalChoice(
    Constants.public.Enums.driver_operation_type,
    "운영형태를 다시 선택해 주세요."
  ),
  vehicleNumber: optionalText(
    EMPLOYEE_LIMITS.vehicleNumberMaxLength,
    `차량번호는 ${EMPLOYEE_LIMITS.vehicleNumberMaxLength}자 이하로 입력해 주세요.`
  ),
  vehicleType: optionalChoice(
    Constants.public.Enums.vehicle_type,
    "차량 종류를 다시 선택해 주세요."
  ),
})

/**
 * The 직원 등록/수정 form.
 * Input (EmployeeFormInput): what the form holds; text boxes and select
 * boxes are strings ("" = empty), check boxes and radios booleans.
 * Output (EmployeeFormValues): values ready to save — trimmed, empty → null,
 * phones → digits, and:
 * - 재직: 퇴사일 → null (it is only kept for 퇴사); 퇴사일 must not be
 *   before the 입사일 (error under "resignationDate");
 * - no 배송담당: 운영형태, 차량번호, 차량 종류 → null;
 * - 우편번호/상세주소 need a 주소 (error under "address").
 */
export const employeeFormSchema = employeeFieldsSchema.transform(
  (values, ctx) => {
    let failed = false

    const resignationDate =
      values.isActive || values.resignationDate === ""
        ? null
        : values.resignationDate
    if (resignationDate !== null && resignationDate < values.hireDate) {
      ctx.addIssue({
        code: "custom",
        path: ["resignationDate"],
        message: `퇴사일은 입사일(${values.hireDate})과 같거나 그 뒤여야 합니다.`,
      })
      failed = true
    }

    if (
      values.address === null &&
      (values.postalCode !== null || values.addressDetail !== null)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["address"],
        message:
          "주소를 입력해 주세요. (우편번호나 상세주소만 따로 저장할 수 없습니다.)",
      })
      failed = true
    }

    if (failed) return z.NEVER

    return {
      ...values,
      resignationDate,
      driverOperationType: values.isDeliveryDriver
        ? values.driverOperationType
        : null,
      vehicleNumber: values.isDeliveryDriver ? values.vehicleNumber : null,
      vehicleType: values.isDeliveryDriver ? values.vehicleType : null,
    }
  }
)

/** What the 직원 form holds while the user is typing. */
export type EmployeeFormInput = z.input<typeof employeeFormSchema>

/** Checked form values, ready to save. */
export type EmployeeFormValues = z.output<typeof employeeFormSchema>

/** Name of a field in the 직원 form. */
export type EmployeeFieldName = keyof EmployeeFormInput

/** One Korean error message per form field. */
export type EmployeeFieldErrors = Partial<Record<EmployeeFieldName, string>>

/**
 * Starting values of the 직원 등록 form: 재직, no 담당업무, 급여지급 Y.
 * Fill in `code` with the suggested next code (suggestEmployeeCode in
 * `@/lib/employees/actions`) and `hireDate` with todayInKorea().
 */
export const emptyEmployeeFormInput: EmployeeFormInput = {
  isActive: true,
  isSalesRep: false,
  isDeliveryDriver: false,
  code: "",
  name: "",
  hireDate: "",
  mobile: "",
  mobile2: "",
  email: "",
  phone: "",
  postalCode: "",
  address: "",
  addressDetail: "",
  note: "",
  department: "",
  jobTitle: "",
  employmentType: "",
  isSalaryPaid: true,
  resignationDate: "",
  driverOperationType: "",
  vehicleNumber: "",
  vehicleType: "",
}

/** A saved employee as starting values of the 직원 수정 form. */
export function employeeToFormInput(
  employee: Tables<"employees">
): EmployeeFormInput {
  return {
    isActive: employee.is_active,
    isSalesRep: employee.is_sales_rep,
    isDeliveryDriver: employee.is_delivery_driver,
    code: employee.code,
    name: employee.name,
    hireDate: employee.hire_date,
    mobile: formatPhone(employee.mobile),
    mobile2: formatPhone(employee.mobile2),
    email: employee.email ?? "",
    phone: formatPhone(employee.phone),
    postalCode: employee.postal_code ?? "",
    address: employee.address ?? "",
    addressDetail: employee.address_detail ?? "",
    note: employee.note ?? "",
    department: employee.department ?? "",
    jobTitle: employee.job_title ?? "",
    employmentType: employee.employment_type ?? "",
    isSalaryPaid: employee.is_salary_paid,
    resignationDate: employee.resignation_date ?? "",
    driverOperationType: employee.driver_operation_type ?? "",
    vehicleNumber: employee.vehicle_number ?? "",
    vehicleType: employee.vehicle_type ?? "",
  }
}

// ---------------------------------------------------------------------------
// 영업담당 / 배송담당 choices (거래처 form and filters)
// ---------------------------------------------------------------------------

/** 담당업무: "sales" = 영업담당, "delivery" = 배송담당. */
export type EmployeeDuty = "sales" | "delivery"

/** Korean name of a 담당업무, e.g. "배송담당". */
export function employeeDutyLabel(duty: EmployeeDuty): string {
  return duty === "sales" ? "영업담당" : "배송담당"
}

/** One employee as a choice for 영업담당 / 배송담당. */
export type EmployeeOption = {
  id: string
  code: string
  name: string
  department: string | null
  jobTitle: string | null
  /** 재직 (true) / 퇴사 (false). */
  isActive: boolean
  isSalesRep: boolean
  isDeliveryDriver: boolean
  /** 차량번호 (배송담당), shown next to the name in the 배송담당 picker. */
  vehicleNumber: string | null
  /** 거래처 (사용 and 미사용) that have this employee as 영업담당 now. */
  salesPartnerCount: number
  /** 거래처 (사용 and 미사용) that have this employee as 배송담당 now. */
  deliveryPartnerCount: number
}

/** Whether the employee has this 담당업무. */
export function employeeHasDuty(
  employee: { isSalesRep: boolean; isDeliveryDriver: boolean },
  duty: EmployeeDuty
): boolean {
  return duty === "sales" ? employee.isSalesRep : employee.isDeliveryDriver
}

/**
 * How an employee is shown in a 영업담당 / 배송담당 box or column:
 * "쿠팡", "최민호 · 80가1234" (배송담당 with a 차량번호), plus
 * " (퇴사)" or " (영업담당 해제)" / " (배송담당 해제)" when the partner keeps
 * an employee who can no longer be newly chosen.
 */
export function formatEmployeeLabel(
  employee: {
    name: string
    isActive: boolean
    isSalesRep: boolean
    isDeliveryDriver: boolean
    vehicleNumber?: string | null
  },
  duty: EmployeeDuty
): string {
  const vehicle =
    duty === "delivery" && employee.vehicleNumber
      ? ` · ${employee.vehicleNumber}`
      : ""
  const notes = [
    employee.isActive ? null : "퇴사",
    employeeHasDuty(employee, duty) ? null : `${employeeDutyLabel(duty)} 해제`,
  ].filter((note) => note !== null)
  return `${employee.name}${vehicle}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}`
}

/**
 * The employees a 영업담당 (`duty` "sales") or 배송담당(기사) ("delivery")
 * box of the 거래처 form may offer: every 재직 employee with that 담당업무,
 * plus the partner's current one even when it is 퇴사 or lost the
 * 담당업무 later (so the form can keep it). In the given order.
 */
export function selectableEmployees(
  employees: readonly EmployeeOption[],
  duty: EmployeeDuty,
  currentId: string | null
): EmployeeOption[] {
  return employees.filter(
    (employee) =>
      (employee.isActive && employeeHasDuty(employee, duty)) ||
      employee.id === currentId
  )
}

/**
 * The employees a 영업담당 / 배송담당 FILTER of a list offers: every
 * employee with that 담당업무, plus those who lost it but are still the
 * 영업담당 / 배송담당 of a partner (so those partners can be found and given
 * a new one); 재직 first, then 퇴사 (in the given order within each group).
 */
export function employeesWithDuty(
  employees: readonly EmployeeOption[],
  duty: EmployeeDuty
): EmployeeOption[] {
  const withDuty = employees.filter(
    (employee) =>
      employeeHasDuty(employee, duty) ||
      (duty === "sales"
        ? employee.salesPartnerCount
        : employee.deliveryPartnerCount) > 0
  )
  return [
    ...withDuty.filter((employee) => employee.isActive),
    ...withDuty.filter((employee) => !employee.isActive),
  ]
}

// ---------------------------------------------------------------------------
// 선택 재직 / 선택 퇴사
// ---------------------------------------------------------------------------

/** Most employees one 선택 재직 / 선택 퇴사 may change (= biggest page). */
export const EMPLOYEE_BULK_MAX = 300

/** The ids of the checked employees: 1 to EMPLOYEE_BULK_MAX UUIDs. */
export const employeeIdsSchema = z
  .array(
    z.string({ error: "직원을 다시 선택해 주세요." }).refine(isUuid, {
      error: "직원을 다시 선택해 주세요.",
    }),
    { error: "직원을 다시 선택해 주세요." }
  )
  .min(1, { error: "먼저 직원을 체크해 주세요." })
  .max(EMPLOYEE_BULK_MAX, {
    error: `한 번에 ${EMPLOYEE_BULK_MAX}명까지 바꿀 수 있습니다.`,
  })
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))])

// ---------------------------------------------------------------------------
// The list's grid columns
// ---------------------------------------------------------------------------

/**
 * Grid columns of the 직원관리 list, in the default order (after the
 * checkbox column). Every column can be sorted with a click on its title:
 * the id is also the sort key (URL param "sort"). Users can drag columns
 * to another place (useColumnOrder with EMPLOYEE_COLUMN_ORDER_KEY).
 */
export const EMPLOYEE_COLUMNS = [
  { id: "code", title: "직원코드" },
  { id: "name", title: "직원명" },
  { id: "mobile", title: "휴대폰번호" },
  { id: "address", title: "주소" },
  { id: "department", title: "부서" },
  { id: "job_title", title: "직급" },
  { id: "employment_type", title: "고용형태" },
  { id: "sales_rep", title: "영업담당" },
  { id: "delivery_driver", title: "배송담당" },
  { id: "operation_type", title: "운영형태" },
  { id: "vehicle_number", title: "차량번호" },
  { id: "status", title: "재직여부" },
  { id: "hire_date", title: "입사일" },
  { id: "resignation_date", title: "퇴사일" },
  { id: "salary", title: "급여지급" },
  { id: "partner_count", title: "담당 거래처 수" },
] as const

/** A grid column id (= its sort key), e.g. "hire_date". */
export type EmployeeColumnId = (typeof EMPLOYEE_COLUMNS)[number]["id"]

/** Every column id in the default order (for useColumnOrder). */
export const EMPLOYEE_COLUMN_IDS: readonly EmployeeColumnId[] =
  EMPLOYEE_COLUMNS.map((column) => column.id)

/** localStorage key of the column order (raise the version if ids change). */
export const EMPLOYEE_COLUMN_ORDER_KEY = "employees.grid.columnOrder.v2"

/** Title of a grid column, e.g. "입사일". */
export function employeeColumnTitle(id: EmployeeColumnId): string {
  return EMPLOYEE_COLUMNS.find((column) => column.id === id)?.title ?? id
}

// ---------------------------------------------------------------------------
// The list URL: /employees?q=김&status=all&duty=delivery&sort=name_desc
// ---------------------------------------------------------------------------

/** 재직여부 filter (radio). Default: "active" (재직). */
export const EMPLOYEE_STATUS_FILTERS = [
  { value: "all", label: "전체" },
  { value: "active", label: "재직" },
  { value: "inactive", label: "퇴사" },
] as const

export type EmployeeStatusFilter =
  (typeof EMPLOYEE_STATUS_FILTERS)[number]["value"]

/** 담당업무 filter. Default: "all". */
export const EMPLOYEE_DUTY_FILTERS = [
  { value: "all", label: "전체" },
  { value: "sales", label: "영업담당" },
  { value: "delivery", label: "배송담당" },
] as const

export type EmployeeDutyFilter = (typeof EMPLOYEE_DUTY_FILTERS)[number]["value"]

export type SortDirection = "asc" | "desc"

/**
 * Sort order (URL param "sort"; default "code" = 직원코드순): a column id
 * = 오름차순 (▲), the id + "_desc" = 내림차순 (▼). Empty values last.
 */
export type EmployeeListSort = EmployeeColumnId | `${EmployeeColumnId}_desc`

const EMPLOYEE_LIST_SORT_VALUES: readonly EmployeeListSort[] =
  EMPLOYEE_COLUMN_IDS.flatMap((id) => [id, `${id}_desc` as const])

/** The column and direction of a sort. */
export function employeeSortState(sort: EmployeeListSort): {
  column: EmployeeColumnId
  direction: SortDirection
} {
  if (sort.endsWith("_desc")) {
    return {
      column: sort.slice(0, -"_desc".length) as EmployeeColumnId,
      direction: "desc",
    }
  }
  return { column: sort as EmployeeColumnId, direction: "asc" }
}

/**
 * The sort after a click on a column title: 오름차순 (▲) → 내림차순 (▼) →
 * back to the default (직원코드순). The 직원코드 title switches between ▲
 * and ▼.
 */
export function nextEmployeeColumnSort(
  current: EmployeeListSort,
  column: EmployeeColumnId
): EmployeeListSort {
  const state = employeeSortState(current)
  if (state.column !== column) return column
  if (state.direction === "asc") return `${column}_desc`
  return defaultEmployeeListParams.sort
}

/** Rows per page the list offers (URL param "size"). Default 100. */
export const EMPLOYEE_PAGE_SIZES = [50, 100, 300] as const

export type EmployeePageSize = (typeof EMPLOYEE_PAGE_SIZES)[number]

/** Longest search text that is used; anything longer is cut off. */
export const EMPLOYEE_SEARCH_MAX_LENGTH = 100

/** Most rows the 엑셀 download contains. */
export const EMPLOYEE_EXPORT_MAX_ROWS = 10_000

/** Highest page number accepted from the URL. */
const MAX_PAGE = 10_000

/** Search, filters, sort and page of the 직원 list (all from the URL). */
export type EmployeeListParams = {
  /**
   * Search text (URL param "q"): 직원코드, 직원명, 차량번호, and — by its
   * digits — 휴대폰번호1/2. "" = no search.
   */
  q: string
  /** 재직여부 (URL param "status"). */
  status: EmployeeStatusFilter
  /** 담당업무 (URL param "duty"). */
  duty: EmployeeDutyFilter
  sort: EmployeeListSort
  /** 1-based page number. */
  page: number
  /** Rows per page (URL param "size"). */
  pageSize: EmployeePageSize
}

export const defaultEmployeeListParams: EmployeeListParams = {
  q: "",
  status: "active",
  duty: "all",
  sort: "code",
  page: 1,
  pageSize: 100,
}

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
 * Reads the list's search, filters, sort and page from the URL. Anything
 * missing or invalid falls back to the default. The modal params are
 * ignored.
 */
export function parseEmployeeListParams(
  searchParams: Record<string, string | string[] | undefined>
): EmployeeListParams {
  const page = firstParam(searchParams.page)
  const pageNumber = /^\d{1,6}$/.test(page) ? Number(page) : 1
  const size = Number(firstParam(searchParams.size))
  return {
    q: firstParam(searchParams.q).trim().slice(0, EMPLOYEE_SEARCH_MAX_LENGTH),
    status:
      pickValue(
        firstParam(searchParams.status),
        EMPLOYEE_STATUS_FILTERS.map((filter) => filter.value)
      ) ?? defaultEmployeeListParams.status,
    duty:
      pickValue(
        firstParam(searchParams.duty),
        EMPLOYEE_DUTY_FILTERS.map((filter) => filter.value)
      ) ?? defaultEmployeeListParams.duty,
    sort:
      pickValue(firstParam(searchParams.sort), EMPLOYEE_LIST_SORT_VALUES) ??
      defaultEmployeeListParams.sort,
    page: Math.min(Math.max(pageNumber, 1), MAX_PAGE),
    pageSize: EMPLOYEE_PAGE_SIZES.includes(size as EmployeePageSize)
      ? (size as EmployeePageSize)
      : defaultEmployeeListParams.pageSize,
  }
}

/**
 * The search, filters and sort as URL params (no page / page size).
 * Default values are left out. Used by the list URL and the 엑셀 URL.
 */
export function employeeListFilterQuery(
  params: EmployeeListParams
): URLSearchParams {
  const query = new URLSearchParams()
  if (params.q) query.set("q", params.q)
  if (params.status !== defaultEmployeeListParams.status) {
    query.set("status", params.status)
  }
  if (params.duty !== defaultEmployeeListParams.duty) {
    query.set("duty", params.duty)
  }
  if (params.sort !== defaultEmployeeListParams.sort) {
    query.set("sort", params.sort)
  }
  return query
}

/** The 직원 list URL ("/employees" for the default list). */
export function buildEmployeeListHref(params: EmployeeListParams): string {
  const query = employeeListFilterQuery(params)
  if (params.page > 1) query.set("page", String(params.page))
  if (params.pageSize !== defaultEmployeeListParams.pageSize) {
    query.set("size", String(params.pageSize))
  }
  const search = query.toString()
  return search ? `/employees?${search}` : "/employees"
}

/** The 엑셀 (CSV) download URL for the list's current search and filters. */
export function buildEmployeeExportHref(params: EmployeeListParams): string {
  const search = employeeListFilterQuery(params).toString()
  return search ? `/employees/export?${search}` : "/employees/export"
}

/** Whether any search or filter differs from the default list. */
export function hasEmployeeListFilters(params: EmployeeListParams): boolean {
  return (
    params.q !== "" ||
    params.status !== defaultEmployeeListParams.status ||
    params.duty !== defaultEmployeeListParams.duty
  )
}

// ---------------------------------------------------------------------------
// 등록/수정 modal in the URL:
//   /employees?modal=new              직원 등록
//   /employees?modal=edit&id=<uuid>   직원 수정
// ---------------------------------------------------------------------------

/** Which 직원 modal is open (`id` may be invalid: "not found"). */
export type EmployeeModalState = { mode: "new" } | { mode: "edit"; id: string }

/** The open modal from the URL params, or null when none is open. */
export function parseEmployeeModal(
  searchParams: Pick<URLSearchParams, "get">
): EmployeeModalState | null {
  const modal = searchParams.get("modal")
  if (modal === "new") return { mode: "new" }
  if (modal === "edit")
    return { mode: "edit", id: searchParams.get("id") ?? "" }
  return null
}

/**
 * The list URL with this modal open (or closed, for null), keeping the
 * other params of `currentSearch`.
 */
export function buildEmployeeModalHref(
  currentSearch: string,
  modal: EmployeeModalState | null
): string {
  const query = new URLSearchParams(currentSearch)
  query.delete("modal")
  query.delete("id")
  if (modal?.mode === "edit") {
    query.set("modal", "edit")
    query.set("id", modal.id)
  } else if (modal?.mode === "new") {
    query.set("modal", "new")
  }
  const search = query.toString()
  return search ? `/employees?${search}` : "/employees"
}
