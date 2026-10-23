"use server"

import type { PostgrestError } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"
import type { z } from "zod"

import { requireUser } from "@/lib/auth/user"
import { getEmployeeOptions } from "@/lib/employees/queries"
import type { EmployeeOption } from "@/lib/employees/schema"
import { getPartnerCategoryTree } from "@/lib/partner-categories/queries"
import type { PartnerCategoryNode } from "@/lib/partner-categories/tree"
import {
  isValidBusinessNumber,
  toBusinessNumberDigits,
} from "@/lib/partners/business-number"
import {
  PARTNER_CODE_PATTERN,
  PARTNER_DB_CONSTRAINTS,
  PARTNER_DB_RULES,
} from "@/lib/partners/constants"
import {
  findPartnersByBusinessNumber,
  getPartner,
  isPartnerCodeTaken,
  type PartnerDetail,
  type SameBusinessNumberPartner,
} from "@/lib/partners/queries"
import {
  partnerFormSchema,
  partnerIdsSchema,
  type PartnerFieldErrors,
  type PartnerFieldPath,
  type PartnerFormValues,
} from "@/lib/partners/schema"
import { isUuid } from "@/lib/products/schema"
import { createClient } from "@/lib/supabase/server"

/**
 * What the 거래처 form gets back from createPartner / updatePartner.
 * On success the form shows a toast and closes the modal.
 */
export type PartnerActionResult =
  | { ok: true; partnerId: string }
  | {
      ok: false
      /** Korean message for the whole form (shown as a toast). */
      message: string
      /**
       * Korean messages under individual fields, keyed like react-hook-form
       * names them: "code", "contacts.0.name", or "contacts" / "addresses"
       * for a message about the whole list (see PartnerFieldPath).
       */
      fieldErrors: PartnerFieldErrors
    }

const CHECK_INPUT_MESSAGE = "입력한 내용을 확인해 주세요."
const SAVE_FAILED_MESSAGE =
  "거래처를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."
const PARTNER_NOT_FOUND_MESSAGE =
  "거래처를 찾을 수 없습니다. 목록에서 다시 선택해 주세요."
const PARTNER_CHANGED_MESSAGE =
  "이 창을 연 뒤에 거래처 정보가 바뀌었습니다. 다른 직원이 먼저 수정했을 수 있습니다. 창을 닫고 다시 열어 수정해 주세요."
const CODE_TAKEN_MESSAGE = "이미 사용 중인 거래처코드입니다."

// ---------------------------------------------------------------------------
// 거래처 등록 / 수정
// ---------------------------------------------------------------------------

/**
 * 거래처 등록. `input` is the raw form input (checked here again: never
 * trust the browser). The partner, its 담당자 and its 배송지 are saved in
 * one transaction (database function create_partner).
 */
export async function createPartner(
  input: unknown
): Promise<PartnerActionResult> {
  await requireUser()
  const parsed = partnerFormSchema.safeParse(input)
  if (!parsed.success) return validationFailed(parsed.error)
  const values = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_partner", {
    partner: toPartnerJson(values),
    contacts: toContactsJson(values),
    addresses: toAddressesJson(values),
  })
  if (error) return saveFailed(error)

  revalidatePartnerPages()
  return { ok: true, partnerId: data }
}

/**
 * 거래처 수정. `partnerId` comes from the modal's address; `input` is the
 * raw form input (checked here again).
 *
 * `loadedUpdatedAt` is the partner's `updated_at` when the form was opened.
 * If someone saved the partner after that, nothing is saved and the user is
 * asked to open it again: otherwise their older form would silently undo
 * the other person's changes. The partner, its 담당자 and its 배송지 are
 * saved in one transaction (database function update_partner); saved
 * 담당자/배송지 keep their ids.
 */
export async function updatePartner(
  partnerId: string,
  loadedUpdatedAt: string,
  input: unknown
): Promise<PartnerActionResult> {
  await requireUser()
  if (!isUuid(partnerId)) return formFailed(PARTNER_NOT_FOUND_MESSAGE)
  if (typeof loadedUpdatedAt !== "string" || loadedUpdatedAt === "") {
    return formFailed(PARTNER_CHANGED_MESSAGE)
  }
  const parsed = partnerFormSchema.safeParse(input)
  if (!parsed.success) return validationFailed(parsed.error)
  const values = parsed.data
  const id = partnerId.toLowerCase()

  const supabase = await createClient()
  const { error } = await supabase.rpc("update_partner", {
    partner_id: id,
    loaded_updated_at: loadedUpdatedAt,
    partner: toPartnerJson(values),
    contacts: toContactsJson(values),
    addresses: toAddressesJson(values),
  })
  if (error) return saveFailed(error)

  revalidatePartnerPages()
  return { ok: true, partnerId: id }
}

/**
 * The partner for the 거래처 수정 modal (with its 담당자, 배송지, the names
 * of its 거래처분류/영업담당/배송담당 and the other partners with the same
 * 사업자등록번호), or null when there is none (or `partnerId` is not a
 * UUID). Throws when it cannot be read.
 */
export async function loadPartnerForEdit(
  partnerId: unknown
): Promise<PartnerDetail | null> {
  await requireUser()
  if (!isUuid(partnerId)) return null
  return getPartner(partnerId.toLowerCase())
}

/**
 * The choices of the 거래처 form, read fresh when the modal opens (so
 * categories or employees added in another tab show up): the whole
 * 거래처분류 tree and every employee, 사용/재직 or not. The form offers the
 * choosable ones plus the partner's current ones (category picker with
 * isCategorySelectable + keep the current one; selectableEmployees with
 * the 담당업무). Throws when they cannot be read.
 */
export async function loadPartnerFormOptions(): Promise<{
  categories: PartnerCategoryNode[]
  employees: EmployeeOption[]
}> {
  await requireUser()
  const [categories, employees] = await Promise.all([
    getPartnerCategoryTree(),
    getEmployeeOptions(),
  ])
  return { categories, employees }
}

/**
 * The other partners that use this 사업자등록번호 (typed with or without
 * hyphens), for the non-blocking warning under the field ("같은
 * 사업자등록번호를 쓰는 거래처가 있습니다: …"). `excludePartnerId` = the
 * partner being edited. Empty when the number is incomplete or invalid, or
 * when it cannot be checked.
 */
export async function findPartnersWithBusinessNumber(
  businessNumber: unknown,
  excludePartnerId: unknown = null
): Promise<SameBusinessNumberPartner[]> {
  await requireUser()
  if (typeof businessNumber !== "string") return []
  const digits = toBusinessNumberDigits(businessNumber)
  if (!isValidBusinessNumber(digits)) return []
  try {
    return await findPartnersByBusinessNumber(
      digits,
      isUuid(excludePartnerId) ? excludePartnerId : null
    )
  } catch (error) {
    console.error("Could not check business number:", error)
    return []
  }
}

/**
 * Whether a 거래처코드 can be used (ignoring case), for the hint next to the
 * field: "available" (사용할 수 있는 코드), "taken" (이미 사용 중),
 * "invalid" (not a valid code) or "unknown" (could not be checked).
 * `excludePartnerId` = the partner being edited. Only a hint: saving still
 * fails with "이미 사용 중인 거래처코드입니다." when someone takes the code
 * meanwhile.
 */
export async function checkPartnerCode(
  code: unknown,
  excludePartnerId: unknown = null
): Promise<"available" | "taken" | "invalid" | "unknown"> {
  await requireUser()
  if (typeof code !== "string") return "invalid"
  const trimmed = code.trim()
  if (!PARTNER_CODE_PATTERN.test(trimmed)) return "invalid"
  try {
    const taken = await isPartnerCodeTaken(
      trimmed,
      isUuid(excludePartnerId) ? excludePartnerId : null
    )
    return taken ? "taken" : "available"
  } catch (error) {
    console.error("Could not check partner code:", error)
    return "unknown"
  }
}

// ---------------------------------------------------------------------------
// 선택 사용 / 선택 미사용
// ---------------------------------------------------------------------------

/** What the list gets back from setPartnersActive. */
export type PartnerStatusActionResult =
  | {
      ok: true
      /** Partners that were switched. */
      changed: number
      /** Checked partners that already had that status. */
      unchanged: number
    }
  | { ok: false; message: string }

/** Ids per update request, so the request address stays short. */
const STATUS_UPDATE_CHUNK = 100

/**
 * 선택 사용 (`isActive` true) / 선택 미사용 (false) for the checked
 * partners. Partners are never deleted; this only switches 사용 여부.
 * `partnerIds` is checked here again (1–300 UUIDs).
 */
export async function setPartnersActive(
  partnerIds: unknown,
  isActive: unknown
): Promise<PartnerStatusActionResult> {
  await requireUser()
  if (typeof isActive !== "boolean") {
    return { ok: false, message: "사용 여부를 다시 선택해 주세요." }
  }
  const parsed = partnerIdsSchema.safeParse(partnerIds)
  if (!parsed.success) {
    return {
      ok: false,
      message:
        parsed.error.issues[0]?.message ?? "거래처를 다시 선택해 주세요.",
    }
  }
  const ids = parsed.data

  const supabase = await createClient()
  let changed = 0
  for (let start = 0; start < ids.length; start += STATUS_UPDATE_CHUNK) {
    const chunk = ids.slice(start, start + STATUS_UPDATE_CHUNK)
    const { data, error } = await supabase
      .from("partners")
      .update({ is_active: isActive })
      .in("id", chunk)
      .eq("is_active", !isActive)
      .select("id")
    if (error) {
      console.error("Could not change partner status:", error)
      if (changed > 0) revalidatePartnerPages()
      if (error.code === "42501") {
        return {
          ok: false,
          message: "사용 여부를 바꿀 권한이 없습니다. 다시 로그인해 주세요.",
        }
      }
      return {
        ok: false,
        message:
          changed > 0
            ? `${changed}개만 바꾸고 나머지는 바꾸지 못했습니다. 목록을 확인한 뒤 다시 시도해 주세요.`
            : "사용 여부를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.",
      }
    }
    changed += data.length
  }

  revalidatePartnerPages()
  return { ok: true, changed, unchanged: ids.length - changed }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The `partner` argument of create_partner / update_partner: the checked
 * values under the database column names. Who/when are filled in by the
 * database.
 */
function toPartnerJson(values: PartnerFormValues) {
  return {
    partner_type: values.partnerType,
    code: values.code,
    name: values.name,
    phone: values.phone,
    industry: values.industry,
    sales_rep_id: values.salesRepId,
    delivery_rep_id: values.deliveryRepId,
    category_id: values.categoryId,
    is_active: values.isActive,
    payment_term: values.paymentTerm,
    payment_day: values.paymentDay,
    credit_limit_type: values.creditLimitType,
    credit_limit: values.creditLimit,
    invoice_type: values.invoiceType,
    slip_print: values.slipPrint,
    business_number: values.businessNumber,
    company_name: values.companyName,
    representative: values.representative,
    business_category: values.businessCategory,
    business_item: values.businessItem,
    postal_code: values.postalCode,
    address: values.address,
    address_detail: values.addressDetail,
    tax_email: values.taxEmail,
    note: values.note,
  }
}

/** The `contacts` argument (담당자 in screen order; id null = new). */
function toContactsJson(values: PartnerFormValues) {
  return values.contacts.map((contact) => ({
    id: contact.id,
    name: contact.name,
    job_title: contact.jobTitle,
    mobile: contact.mobile,
    phone: contact.phone,
    email: contact.email,
    memo: contact.memo,
    is_primary: contact.isPrimary,
  }))
}

/** The `addresses` argument (배송지 in screen order; id null = new). */
function toAddressesJson(values: PartnerFormValues) {
  return values.addresses.map((address) => ({
    id: address.id,
    label: address.label,
    postal_code: address.postalCode,
    address: address.address,
    address_detail: address.addressDetail,
    recipient: address.recipient,
    phone: address.phone,
    memo: address.memo,
    is_default: address.isDefault,
  }))
}

/**
 * 거래처 lists, filters and forms live under /partners (and the 거래처분류
 * counts on 거래처분류설정), so refresh all pages there.
 */
function revalidatePartnerPages() {
  revalidatePath("/(app)/partners", "layout")
}

function formFailed(message: string): PartnerActionResult {
  return { ok: false, message, fieldErrors: {} }
}

function fieldFailed(fieldErrors: PartnerFieldErrors): PartnerActionResult {
  return { ok: false, message: CHECK_INPUT_MESSAGE, fieldErrors }
}

/**
 * The first message of each field from a zod validation error, keyed by
 * its react-hook-form name ("code", "contacts.1.mobile", "addresses").
 */
function validationFailed(error: z.ZodError): PartnerActionResult {
  const fieldErrors: PartnerFieldErrors = {}
  for (const issue of error.issues) {
    if (issue.path.length === 0) continue
    const path = issue.path.join(".") as PartnerFieldPath
    if (!fieldErrors[path]) fieldErrors[path] = issue.message
  }
  if (Object.keys(fieldErrors).length === 0 && error.issues[0]) {
    return formFailed(error.issues[0].message)
  }
  return { ok: false, message: CHECK_INPUT_MESSAGE, fieldErrors }
}

/**
 * Database check constraints → the form field they belong to. The form
 * checks the same rules, so these only show up when the rules were changed
 * in one place only.
 */
const CHECK_FIELDS: Record<string, PartnerFieldPath> = {
  partners_code_check: "code",
  partners_name_check: "name",
  partners_phone_check: "phone",
  partners_payment_day_check: "paymentDay",
  partners_credit_limit_check: "creditLimit",
  partners_business_number_check: "businessNumber",
  partners_company_name_check: "companyName",
  partners_representative_check: "representative",
  partners_business_category_check: "businessCategory",
  partners_business_item_check: "businessItem",
  partners_postal_code_check: "postalCode",
  partners_address_check: "address",
  partners_address_detail_check: "addressDetail",
  partners_address_parts_check: "address",
  partners_tax_email_check: "taxEmail",
  partners_note_check: "note",
}

/** Turns a database error into Korean messages for the form. */
function saveFailed(error: PostgrestError): PartnerActionResult {
  // Rules checked by the database's own functions and triggers carry a key
  // in `hint` and a Korean message (ready to show) in `message`.
  switch (error.hint) {
    case PARTNER_DB_RULES.partnerNotFound:
      return formFailed(PARTNER_NOT_FOUND_MESSAGE)
    case PARTNER_DB_RULES.partnerChanged:
      return formFailed(error.message)
    case PARTNER_DB_RULES.rowsInvalid:
      return formFailed(error.message)
    case PARTNER_DB_RULES.contactsTooMany:
    case PARTNER_DB_RULES.primaryContactDuplicate:
      return fieldFailed({ contacts: error.message })
    case PARTNER_DB_RULES.addressesTooMany:
    case PARTNER_DB_RULES.defaultAddressDuplicate:
    case PARTNER_DB_RULES.defaultAddressRequired:
      return fieldFailed({ addresses: error.message })
    case PARTNER_DB_RULES.categoryNotFound:
    case PARTNER_DB_RULES.categoryInactive:
      return fieldFailed({ categoryId: error.message })
    case PARTNER_DB_RULES.salesRepNotFound:
    case PARTNER_DB_RULES.salesRepInactive:
    case PARTNER_DB_RULES.salesRepDutyMissing:
      return fieldFailed({ salesRepId: error.message })
    case PARTNER_DB_RULES.deliveryRepNotFound:
    case PARTNER_DB_RULES.deliveryRepInactive:
    case PARTNER_DB_RULES.deliveryRepDutyMissing:
      return fieldFailed({ deliveryRepId: error.message })
  }

  // The constraint name is in `message` (Supabase leaves `details` empty).
  const text = `${error.message} ${error.details ?? ""}`

  // 23505 = unique_violation (a duplicate)
  if (error.code === "23505") {
    if (text.includes(PARTNER_DB_CONSTRAINTS.codeUnique)) {
      return fieldFailed({ code: CODE_TAKEN_MESSAGE })
    }
    if (text.includes(PARTNER_DB_CONSTRAINTS.primaryContactUnique)) {
      return fieldFailed({ contacts: "대표 담당자는 1명만 정할 수 있습니다." })
    }
    if (text.includes(PARTNER_DB_CONSTRAINTS.defaultAddressUnique)) {
      return fieldFailed({ addresses: "기본 배송지는 1곳만 정할 수 있습니다." })
    }
  }

  // 23503 = foreign_key_violation (a category or employee was deleted)
  if (error.code === "23503") {
    if (text.includes("partners_sales_rep_id_fkey")) {
      return fieldFailed({ salesRepId: "영업담당을 다시 선택해 주세요." })
    }
    if (text.includes("partners_delivery_rep_id_fkey")) {
      return fieldFailed({ deliveryRepId: "배송담당을 다시 선택해 주세요." })
    }
    return fieldFailed({ categoryId: "거래처분류를 다시 선택해 주세요." })
  }

  // 23514 = check_violation
  if (error.code === "23514") {
    for (const [constraint, field] of Object.entries(CHECK_FIELDS)) {
      if (text.includes(constraint)) {
        return fieldFailed({ [field]: "입력한 값을 확인해 주세요." })
      }
    }
    if (text.includes("partner_contacts_")) {
      return fieldFailed({ contacts: "담당자 정보를 확인해 주세요." })
    }
    if (text.includes("partner_addresses_")) {
      return fieldFailed({ addresses: "배송지 정보를 확인해 주세요." })
    }
  }

  // 42501 = insufficient_privilege
  if (error.code === "42501") {
    return formFailed("거래처를 저장할 권한이 없습니다. 다시 로그인해 주세요.")
  }

  console.error("Could not save partner:", error)
  return formFailed(SAVE_FAILED_MESSAGE)
}
