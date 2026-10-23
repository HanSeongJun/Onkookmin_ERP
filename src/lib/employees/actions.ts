"use server"

import type { PostgrestError } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"
import type { z } from "zod"

import { requireUser } from "@/lib/auth/user"
import {
  getEmployee,
  getEmployeeOptions,
  getSuggestedEmployeeCode,
  isEmployeeCodeTaken,
  type EmployeeDetail,
} from "@/lib/employees/queries"
import {
  EMPLOYEE_CODE_PATTERN,
  EMPLOYEE_CODE_TAKEN_MESSAGE,
  EMPLOYEE_DB_CONSTRAINTS,
  employeeFormSchema,
  employeeIdsSchema,
  type EmployeeFieldErrors,
  type EmployeeFieldName,
  type EmployeeFormValues,
  type EmployeeOption,
} from "@/lib/employees/schema"
import { isUuid } from "@/lib/products/schema"
import { createClient } from "@/lib/supabase/server"
import type { TablesInsert } from "@/types/database"

/**
 * What the 직원 form gets back from createEmployee / updateEmployee.
 * On success the form shows a toast and closes the modal.
 */
export type EmployeeActionResult =
  | { ok: true; employeeId: string }
  | {
      ok: false
      /** Korean message for the whole form (shown as a toast). */
      message: string
      /** Korean messages shown under individual fields. */
      fieldErrors: EmployeeFieldErrors
    }

const CHECK_INPUT_MESSAGE = "입력한 내용을 확인해 주세요."
const SAVE_FAILED_MESSAGE =
  "직원 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."
const EMPLOYEE_NOT_FOUND_MESSAGE =
  "직원을 찾을 수 없습니다. 목록에서 다시 선택해 주세요."
const EMPLOYEE_CHANGED_MESSAGE =
  "이 창을 연 뒤에 직원 정보가 바뀌었습니다. 다른 사람이 먼저 수정했을 수 있습니다. 창을 닫고 다시 열어 수정해 주세요."

/** 직원 등록. `input` is the raw form input (checked here again). */
export async function createEmployee(
  input: unknown
): Promise<EmployeeActionResult> {
  await requireUser()
  const parsed = employeeFormSchema.safeParse(input)
  if (!parsed.success) return validationFailed(parsed.error)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("employees")
    .insert(toEmployeeRow(parsed.data))
    .select("id")
    .single()
  if (error) return saveFailed(error)

  revalidateEmployeePages()
  return { ok: true, employeeId: data.id }
}

/**
 * 직원 수정. `loadedUpdatedAt` is the employee's `updated_at` when the form
 * was opened: if someone saved the employee after that, nothing is saved
 * (the older form would silently undo the other person's changes).
 * Switching an employee to 퇴사 or unchecking a 담당업무 does not change
 * the 거래처 that have them as 영업담당/배송담당.
 */
export async function updateEmployee(
  employeeId: string,
  loadedUpdatedAt: string,
  input: unknown
): Promise<EmployeeActionResult> {
  await requireUser()
  if (!isUuid(employeeId)) return formFailed(EMPLOYEE_NOT_FOUND_MESSAGE)
  if (typeof loadedUpdatedAt !== "string" || loadedUpdatedAt === "") {
    return formFailed(EMPLOYEE_CHANGED_MESSAGE)
  }
  const parsed = employeeFormSchema.safeParse(input)
  if (!parsed.success) return validationFailed(parsed.error)

  const id = employeeId.toLowerCase()
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("employees")
    .update(toEmployeeRow(parsed.data))
    .eq("id", id)
    .eq("updated_at", loadedUpdatedAt)
    .select("id")
    .maybeSingle()
  if (error) return saveFailed(error)
  if (!data) {
    // Not saved: the employee is gone, or someone saved it after the form
    // was opened.
    const { data: exists } = await supabase
      .from("employees")
      .select("id")
      .eq("id", id)
      .maybeSingle()
    return formFailed(
      exists ? EMPLOYEE_CHANGED_MESSAGE : EMPLOYEE_NOT_FOUND_MESSAGE
    )
  }

  revalidateEmployeePages()
  return { ok: true, employeeId: data.id }
}

/**
 * The employee for the 직원 수정 modal (with the number of partners that
 * have them as 영업담당 / 배송담당), or null when there is none (or
 * `employeeId` is not a UUID). Throws when it cannot be read.
 */
export async function loadEmployeeForEdit(
  employeeId: unknown
): Promise<EmployeeDetail | null> {
  await requireUser()
  if (!isUuid(employeeId)) return null
  return getEmployee(employeeId)
}

/**
 * Every employee (재직 and 퇴사) as 영업담당 / 배송담당 choices, read fresh
 * (e.g. when the 거래처 modal opens, so employees added in another tab show
 * up). Forms offer the 재직 ones with the 담당업무 plus the current one
 * (selectableEmployees).
 */
export async function loadEmployeeOptions(): Promise<EmployeeOption[]> {
  await requireUser()
  return getEmployeeOptions()
}

/**
 * The 직원코드 the 직원 등록 form fills in: the highest number + 1 with at
 * least 4 digits ("0001", "0012", …). "" when it cannot be worked out (the
 * user then types one).
 */
export async function suggestEmployeeCode(): Promise<string> {
  await requireUser()
  try {
    return await getSuggestedEmployeeCode()
  } catch (error) {
    console.error("Could not suggest an employee code:", error)
    return ""
  }
}

/**
 * Whether a 직원코드 can be used (ignoring case), for the hint next to the
 * field: "available" (사용할 수 있는 코드입니다), "taken" (이미 사용 중),
 * "invalid" (not a valid code) or "unknown" (could not be checked).
 * `excludeEmployeeId` = the employee being edited. Only a hint: saving
 * still fails with "이미 사용 중인 직원코드입니다." when someone takes the
 * code meanwhile.
 */
export async function checkEmployeeCode(
  code: unknown,
  excludeEmployeeId: unknown = null
): Promise<"available" | "taken" | "invalid" | "unknown"> {
  await requireUser()
  if (typeof code !== "string") return "invalid"
  const trimmed = code.trim()
  if (!EMPLOYEE_CODE_PATTERN.test(trimmed)) return "invalid"
  try {
    const taken = await isEmployeeCodeTaken(
      trimmed,
      isUuid(excludeEmployeeId) ? excludeEmployeeId : null
    )
    return taken ? "taken" : "available"
  } catch (error) {
    console.error("Could not check employee code:", error)
    return "unknown"
  }
}

/** What the list gets back from setEmployeesActive. */
export type EmployeeStatusActionResult =
  | {
      ok: true
      /** Employees that were switched. */
      changed: number
      /** Checked employees that already had that status. */
      unchanged: number
    }
  | { ok: false; message: string }

/**
 * Ids per update request: 300 ids in one request address are too long for
 * the API gateway (it answers 414 "URI too long").
 */
const STATUS_UPDATE_CHUNK = 100

/**
 * 선택 재직 (`isActive` true) / 선택 퇴사 (false) for the checked
 * employees. Employees are never deleted. 재직 again clears the 퇴사일
 * (the database keeps a 퇴사일 only for 퇴사). Partners keep their
 * 영업담당 / 배송담당.
 */
export async function setEmployeesActive(
  employeeIds: unknown,
  isActive: unknown
): Promise<EmployeeStatusActionResult> {
  await requireUser()
  if (typeof isActive !== "boolean") {
    return { ok: false, message: "재직여부를 다시 선택해 주세요." }
  }
  const parsed = employeeIdsSchema.safeParse(employeeIds)
  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "직원을 다시 선택해 주세요.",
    }
  }
  const ids = parsed.data

  const supabase = await createClient()
  let changed = 0
  for (let start = 0; start < ids.length; start += STATUS_UPDATE_CHUNK) {
    const chunk = ids.slice(start, start + STATUS_UPDATE_CHUNK)
    const { data, error } = await supabase
      .from("employees")
      .update(
        isActive
          ? { is_active: true, resignation_date: null }
          : { is_active: false }
      )
      .in("id", chunk)
      .eq("is_active", !isActive)
      .select("id")
    if (error) {
      console.error("Could not change employee status:", error)
      if (changed > 0) revalidateEmployeePages()
      if (error.code === "42501") {
        return {
          ok: false,
          message: "재직여부를 바꿀 권한이 없습니다. 다시 로그인해 주세요.",
        }
      }
      return {
        ok: false,
        message:
          changed > 0
            ? `${changed}명만 바꾸고 나머지는 바꾸지 못했습니다. 목록을 확인한 뒤 다시 시도해 주세요.`
            : "재직여부를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.",
      }
    }
    changed += data.length
  }

  revalidateEmployeePages()
  return { ok: true, changed, unchanged: ids.length - changed }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The database row for checked form values (who/when: database trigger). */
function toEmployeeRow(values: EmployeeFormValues): TablesInsert<"employees"> {
  return {
    code: values.code,
    name: values.name,
    is_active: values.isActive,
    is_sales_rep: values.isSalesRep,
    is_delivery_driver: values.isDeliveryDriver,
    hire_date: values.hireDate,
    mobile: values.mobile,
    mobile2: values.mobile2,
    email: values.email,
    phone: values.phone,
    postal_code: values.postalCode,
    address: values.address,
    address_detail: values.addressDetail,
    note: values.note,
    department: values.department,
    job_title: values.jobTitle,
    employment_type: values.employmentType,
    is_salary_paid: values.isSalaryPaid,
    resignation_date: values.resignationDate,
    driver_operation_type: values.driverOperationType,
    vehicle_number: values.vehicleNumber,
    vehicle_type: values.vehicleType,
  }
}

/**
 * Employee names appear on the 직원관리 screen and on the 거래처 pages
 * (영업담당/배송담당 columns, filters and form), so refresh both.
 */
function revalidateEmployeePages() {
  revalidatePath("/employees")
  revalidatePath("/(app)/partners", "layout")
}

function formFailed(message: string): EmployeeActionResult {
  return { ok: false, message, fieldErrors: {} }
}

/** The first message of each field from a zod validation error. */
function validationFailed(error: z.ZodError): EmployeeActionResult {
  const fieldErrors: EmployeeFieldErrors = {}
  for (const issue of error.issues) {
    const field = issue.path[0] as EmployeeFieldName | undefined
    if (field && !fieldErrors[field]) fieldErrors[field] = issue.message
  }
  if (Object.keys(fieldErrors).length === 0 && error.issues[0]) {
    return formFailed(error.issues[0].message)
  }
  return { ok: false, message: CHECK_INPUT_MESSAGE, fieldErrors }
}

/** Database check constraint → the form field it belongs to. */
const CHECK_FIELDS: Record<string, EmployeeFieldName> = {
  employees_code_check: "code",
  employees_name_check: "name",
  employees_job_title_check: "jobTitle",
  employees_mobile_check: "mobile",
  employees_mobile2_check: "mobile2",
  employees_phone_check: "phone",
  employees_email_check: "email",
  employees_note_check: "note",
  employees_postal_code_check: "postalCode",
  employees_address_check: "address",
  employees_address_detail_check: "addressDetail",
  employees_address_parts_check: "address",
  employees_department_check: "department",
  employees_resignation_date_check: "resignationDate",
  employees_vehicle_number_check: "vehicleNumber",
  employees_driver_fields_check: "isDeliveryDriver",
}

/** Turns a database error into Korean messages for the form. */
function saveFailed(error: PostgrestError): EmployeeActionResult {
  const text = `${error.message} ${error.details ?? ""}`
  // 23505 = unique_violation: the same 직원코드 (ignoring case).
  if (
    error.code === "23505" &&
    text.includes(EMPLOYEE_DB_CONSTRAINTS.codeUnique)
  ) {
    return {
      ok: false,
      message: CHECK_INPUT_MESSAGE,
      fieldErrors: { code: EMPLOYEE_CODE_TAKEN_MESSAGE },
    }
  }
  // 23514 = check_violation (the form checks the same rules, so this only
  // happens when the rules were changed in one place only).
  if (error.code === "23514") {
    for (const [constraint, field] of Object.entries(CHECK_FIELDS)) {
      if (text.includes(constraint)) {
        return {
          ok: false,
          message: CHECK_INPUT_MESSAGE,
          fieldErrors: { [field]: "입력한 값을 확인해 주세요." },
        }
      }
    }
  }
  if (error.code === "42501") {
    return formFailed(
      "직원 정보를 저장할 권한이 없습니다. 다시 로그인해 주세요."
    )
  }
  console.error("Could not save employee:", error)
  return formFailed(SAVE_FAILED_MESSAGE)
}
