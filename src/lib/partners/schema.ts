/**
 * Input rules for 거래처 (partners), shared by the browser and the server:
 * - partnerFormSchema: the 거래처 등록/수정 form (기본정보 + 거래조건,
 *   사업자정보, 담당자정보, 배송지, 특이사항). The form checks it while the
 *   user types, and the Server Actions check it again before saving.
 * - The list URL (search, filters, sort, page, page size):
 *   parsePartnerListParams, buildPartnerListHref, buildPartnerExportHref.
 * - The grid's columns (ids, titles, sort keys) and the column-order key.
 * - 등록/수정 modal in the URL (?modal=new, ?modal=edit&id=<uuid>):
 *   parsePartnerModal and buildPartnerModalHref.
 * - 선택 사용 / 선택 미사용: partnerIdsSchema.
 *
 * The database checks the same rules (supabase/migrations/*_partners.sql).
 * Keep both in sync. No server imports: Client Components use this file.
 */

import { z } from "zod"

import {
  formatBusinessNumber,
  isValidBusinessNumber,
  toBusinessNumberDigits,
} from "@/lib/partners/business-number"
import {
  EMAIL_PATTERN,
  PARTNER_CODE_PATTERN,
  PARTNER_LIMITS,
  POSTAL_CODE_PATTERN,
  type PartnerIndustry,
  type PartnerType,
} from "@/lib/partners/constants"
import {
  formatPhone,
  isValidPhone,
  PHONE_EXAMPLES,
  toPhoneDigits,
} from "@/lib/partners/phone"
import { formatDigits, isUuid } from "@/lib/products/schema"
import { Constants, type Tables } from "@/types/database"

// ---------------------------------------------------------------------------
// Small field helpers (also used by the 직원 form, @/lib/employees/schema)
// ---------------------------------------------------------------------------

/** Text input. Not text at all (a broken request) gets `message`. */
function text(message: string) {
  return z.string({ error: message })
}

/** Required text: trimmed, 1 to `max` characters. */
export function requiredText(
  emptyMessage: string,
  max: number,
  tooLongMessage: string
) {
  return text(emptyMessage)
    .trim()
    .min(1, { error: emptyMessage })
    .max(max, { error: tooLongMessage })
}

/** Optional text: trimmed, at most `max` characters, empty → null. */
export function optionalText(max: number, tooLongMessage: string) {
  return text(tooLongMessage)
    .trim()
    .max(max, { error: tooLongMessage })
    .transform((value) => (value === "" ? null : value))
}

/**
 * Optional phone number, typed with or without hyphens. Empty → null;
 * otherwise the digits ("02-123-4567" → "021234567"), which must be a valid
 * Korean phone number (isValidPhone in `@/lib/partners/phone`).
 */
export function optionalPhone(invalidMessage: string) {
  return text(invalidMessage).transform((value, ctx) => {
    if (value.trim() === "") return null
    const digits = toPhoneDigits(value)
    if (!isValidPhone(digits)) {
      ctx.addIssue({ code: "custom", message: invalidMessage })
      return z.NEVER
    }
    return digits
  })
}

/** Optional e-mail address: trimmed, empty → null. */
export function optionalEmail(invalidMessage: string) {
  return text(invalidMessage)
    .trim()
    .refine(
      (value) =>
        value === "" ||
        (value.length <= PARTNER_LIMITS.emailMaxLength &&
          EMAIL_PATTERN.test(value)),
      { error: invalidMessage }
    )
    .transform((value) => (value === "" ? null : value))
}

/** Optional id of another row (a select box): "" → null, else a UUID. */
function optionalId(message: string) {
  return text(message).transform((value, ctx) => {
    if (value === "") return null
    if (!isUuid(value)) {
      ctx.addIssue({ code: "custom", message })
      return z.NEVER
    }
    return value.toLowerCase()
  })
}

/** Optional 우편번호: empty → null, else 5 digits. */
function optionalPostalCode(message: string) {
  return text(message)
    .trim()
    .refine((value) => value === "" || POSTAL_CODE_PATTERN.test(value), {
      error: message,
    })
    .transform((value) => (value === "" ? null : value))
}

/**
 * The id of a saved 담당자/배송지 row ("" for a row added in the form).
 * Output: the UUID, or null for a new row.
 */
const rowIdSchema = text("담당자·배송지를 다시 불러와 주세요.").transform(
  (value, ctx) => {
    if (value === "") return null
    if (!isUuid(value)) {
      ctx.addIssue({
        code: "custom",
        message: "담당자·배송지를 다시 불러와 주세요.",
      })
      return z.NEVER
    }
    return value.toLowerCase()
  }
)

const PHONE_HINT = `(예: ${PHONE_EXAMPLES})`

// ---------------------------------------------------------------------------
// 담당자 (contacts) and 배송지 (addresses): rows of the form
// ---------------------------------------------------------------------------

/** One 담당자 row of the form (담당자정보 tab). */
export const partnerContactSchema = z.object({
  /** "" for a new row; the saved row's id otherwise (it keeps its id). */
  id: rowIdSchema,
  name: requiredText(
    "담당자 이름을 입력해 주세요.",
    PARTNER_LIMITS.contactNameMaxLength,
    `담당자 이름은 ${PARTNER_LIMITS.contactNameMaxLength}자 이하로 입력해 주세요.`
  ),
  jobTitle: optionalText(
    PARTNER_LIMITS.contactJobTitleMaxLength,
    `부서/직책은 ${PARTNER_LIMITS.contactJobTitleMaxLength}자 이하로 입력해 주세요.`
  ),
  mobile: optionalPhone(`휴대폰 번호를 확인해 주세요. ${PHONE_HINT}`),
  phone: optionalPhone(`전화번호를 확인해 주세요. ${PHONE_HINT}`),
  email: optionalEmail("이메일 주소를 확인해 주세요. (예: name@example.com)"),
  memo: optionalText(
    PARTNER_LIMITS.contactMemoMaxLength,
    `메모는 ${PARTNER_LIMITS.contactMemoMaxLength}자 이하로 입력해 주세요.`
  ),
  /** 대표 담당자 (at most one per partner). */
  isPrimary: z.boolean({ error: "대표 담당자 여부를 다시 선택해 주세요." }),
})

/** One 배송지 row of the form (배송지 tab). */
export const partnerAddressSchema = z.object({
  /** "" for a new row; the saved row's id otherwise (it keeps its id). */
  id: rowIdSchema,
  label: requiredText(
    "배송지명을 입력해 주세요. (예: 본점, 2호점 주방)",
    PARTNER_LIMITS.addressLabelMaxLength,
    `배송지명은 ${PARTNER_LIMITS.addressLabelMaxLength}자 이하로 입력해 주세요.`
  ),
  postalCode: optionalPostalCode("우편번호는 숫자 5자리로 입력해 주세요."),
  address: requiredText(
    "배송지 주소를 입력해 주세요.",
    PARTNER_LIMITS.addressMaxLength,
    `주소는 ${PARTNER_LIMITS.addressMaxLength}자 이하로 입력해 주세요.`
  ),
  addressDetail: optionalText(
    PARTNER_LIMITS.addressDetailMaxLength,
    `상세주소는 ${PARTNER_LIMITS.addressDetailMaxLength}자 이하로 입력해 주세요.`
  ),
  recipient: optionalText(
    PARTNER_LIMITS.recipientMaxLength,
    `받는 분은 ${PARTNER_LIMITS.recipientMaxLength}자 이하로 입력해 주세요.`
  ),
  phone: optionalPhone(`연락처를 확인해 주세요. ${PHONE_HINT}`),
  memo: optionalText(
    PARTNER_LIMITS.deliveryMemoMaxLength,
    `배송 메모는 ${PARTNER_LIMITS.deliveryMemoMaxLength}자 이하로 입력해 주세요.`
  ),
  /**
   * 기본 배송지. When there are addresses, exactly one is the 기본 배송지:
   * if none is marked, the first one becomes it when saving.
   */
  isDefault: z.boolean({ error: "기본 배송지를 다시 선택해 주세요." }),
})

/** One 담당자 row while the user is typing (all text fields are strings). */
export type PartnerContactInput = z.input<typeof partnerContactSchema>

/** One 배송지 row while the user is typing (all text fields are strings). */
export type PartnerAddressInput = z.input<typeof partnerAddressSchema>

/** Checked 담당자 row: empty optional text → null, phones as digits. */
export type PartnerContactValues = z.output<typeof partnerContactSchema>

/** Checked 배송지 row: empty optional text → null, phones as digits. */
export type PartnerAddressValues = z.output<typeof partnerAddressSchema>

/** A new, empty 담당자 row for the form. */
export function emptyPartnerContactInput(): PartnerContactInput {
  return {
    id: "",
    name: "",
    jobTitle: "",
    mobile: "",
    phone: "",
    email: "",
    memo: "",
    isPrimary: false,
  }
}

/**
 * A new, empty 배송지 row for the form. Pass `isDefault: true` for the
 * first address of a partner (it becomes the 기본 배송지 automatically).
 */
export function emptyPartnerAddressInput(
  isDefault = false
): PartnerAddressInput {
  return {
    id: "",
    label: "",
    postalCode: "",
    address: "",
    addressDetail: "",
    recipient: "",
    phone: "",
    memo: "",
    isDefault,
  }
}

// ---------------------------------------------------------------------------
// 거래처 등록/수정 form
// ---------------------------------------------------------------------------

const partnerTypeMessage = "구분(매출처/매입처/매출·매입)을 선택해 주세요."
const paymentDayMessage = `결제일은 매월 ${PARTNER_LIMITS.paymentDayMin}~${PARTNER_LIMITS.paymentDayMax}일 중에서 골라 주세요. (말일은 ‘매월 말일’을 고르세요.)`
const creditLimitInvalidMessage =
  "외상 한도 금액은 0 이상의 숫자(원 단위)로 입력해 주세요."

/** The form's fields, each checked on its own (see partnerFormSchema). */
const partnerFieldsSchema = z.object({
  // 기본정보
  partnerType: text(partnerTypeMessage).pipe(
    z.enum(Constants.public.Enums.partner_type, { error: partnerTypeMessage })
  ),
  code: requiredText(
    "거래처코드를 입력해 주세요.",
    PARTNER_LIMITS.codeMaxLength,
    `거래처코드는 ${PARTNER_LIMITS.codeMaxLength}자 이하로 입력해 주세요.`
  ).regex(PARTNER_CODE_PATTERN, {
    error:
      "거래처코드는 영문, 숫자, 하이픈(-), 밑줄(_), 마침표(.)만 쓸 수 있습니다. (띄어쓰기 불가)",
  }),
  name: requiredText(
    "거래처명을 입력해 주세요.",
    PARTNER_LIMITS.nameMaxLength,
    `거래처명은 ${PARTNER_LIMITS.nameMaxLength}자 이하로 입력해 주세요.`
  ),
  phone: optionalPhone(`대표연락처를 확인해 주세요. ${PHONE_HINT}`),
  /** 업종: "" = 미지정. */
  industry: text("업종을 다시 선택해 주세요.").transform((value, ctx) => {
    if (value === "") return null
    const industries: readonly string[] =
      Constants.public.Enums.partner_industry
    if (!industries.includes(value)) {
      ctx.addIssue({ code: "custom", message: "업종을 다시 선택해 주세요." })
      return z.NEVER
    }
    return value as PartnerIndustry
  }),
  /** 영업담당: an employee id, "" = 없음. */
  salesRepId: optionalId("영업담당을 다시 선택해 주세요."),
  /** 배송담당: an employee id, "" = 없음. */
  deliveryRepId: optionalId("배송담당을 다시 선택해 주세요."),
  /** 거래처분류: a category id, "" = 미분류. */
  categoryId: optionalId("거래처분류를 다시 선택해 주세요."),
  isActive: z.boolean({ error: "사용 여부를 선택해 주세요." }),
  // 거래조건 (추가정보)
  paymentTerm: text("결제일을 선택해 주세요.").pipe(
    z.enum(Constants.public.Enums.payment_term, {
      error: "결제일을 선택해 주세요.",
    })
  ),
  /** 매월 N일의 N ("1"–"28"); only used when paymentTerm is "monthly_day". */
  paymentDay: text(paymentDayMessage).trim(),
  creditLimitType: text("외상 한도를 선택해 주세요.").pipe(
    z.enum(Constants.public.Enums.credit_limit_type, {
      error: "외상 한도를 선택해 주세요.",
    })
  ),
  /**
   * 외상 한도 금액 in won, with or without commas ("3,000,000"); only used
   * when creditLimitType is "limited".
   */
  creditLimit: text(creditLimitInvalidMessage),
  invoiceType: text("계산서 발행을 선택해 주세요.").pipe(
    z.enum(Constants.public.Enums.invoice_type, {
      error: "계산서 발행을 선택해 주세요.",
    })
  ),
  slipPrint: text("전표 인쇄를 선택해 주세요.").pipe(
    z.enum(Constants.public.Enums.slip_print_type, {
      error: "전표 인쇄를 선택해 주세요.",
    })
  ),
  // 사업자정보
  /** Typed with or without hyphens; saved as 10 digits, or null. */
  businessNumber: text("사업자등록번호를 확인해 주세요.").transform(
    (value, ctx) => {
      if (value.trim() === "") return null
      const digits = toBusinessNumberDigits(value)
      if (digits.length !== 10) {
        ctx.addIssue({
          code: "custom",
          message:
            "사업자등록번호는 숫자 10자리로 입력해 주세요. (예: 123-45-67890)",
        })
        return z.NEVER
      }
      if (!isValidBusinessNumber(digits)) {
        ctx.addIssue({
          code: "custom",
          message:
            "올바른 사업자등록번호가 아닙니다. 사업자등록증의 번호를 다시 확인해 주세요.",
        })
        return z.NEVER
      }
      return digits
    }
  ),
  companyName: optionalText(
    PARTNER_LIMITS.companyNameMaxLength,
    `상호(법인명)는 ${PARTNER_LIMITS.companyNameMaxLength}자 이하로 입력해 주세요.`
  ),
  representative: optionalText(
    PARTNER_LIMITS.representativeMaxLength,
    `대표자명은 ${PARTNER_LIMITS.representativeMaxLength}자 이하로 입력해 주세요.`
  ),
  businessCategory: optionalText(
    PARTNER_LIMITS.businessCategoryMaxLength,
    `업태는 ${PARTNER_LIMITS.businessCategoryMaxLength}자 이하로 입력해 주세요.`
  ),
  businessItem: optionalText(
    PARTNER_LIMITS.businessItemMaxLength,
    `종목은 ${PARTNER_LIMITS.businessItemMaxLength}자 이하로 입력해 주세요.`
  ),
  postalCode: optionalPostalCode("우편번호는 숫자 5자리로 입력해 주세요."),
  address: optionalText(
    PARTNER_LIMITS.addressMaxLength,
    `사업장 주소는 ${PARTNER_LIMITS.addressMaxLength}자 이하로 입력해 주세요.`
  ),
  addressDetail: optionalText(
    PARTNER_LIMITS.addressDetailMaxLength,
    `상세주소는 ${PARTNER_LIMITS.addressDetailMaxLength}자 이하로 입력해 주세요.`
  ),
  taxEmail: optionalEmail(
    "세금계산서 이메일 주소를 확인해 주세요. (예: tax@example.com)"
  ),
  // 담당자정보 / 배송지
  contacts: z
    .array(partnerContactSchema, { error: "담당자 목록을 다시 불러와 주세요." })
    .max(PARTNER_LIMITS.contactsMax, {
      error: `담당자는 ${PARTNER_LIMITS.contactsMax}명까지 등록할 수 있습니다.`,
    }),
  addresses: z
    .array(partnerAddressSchema, { error: "배송지 목록을 다시 불러와 주세요." })
    .max(PARTNER_LIMITS.addressesMax, {
      error: `배송지는 ${PARTNER_LIMITS.addressesMax}곳까지 등록할 수 있습니다.`,
    }),
  // 특이사항
  note: optionalText(
    PARTNER_LIMITS.noteMaxLength,
    `특이사항은 ${PARTNER_LIMITS.noteMaxLength.toLocaleString("ko-KR")}자 이하로 입력해 주세요.`
  ),
})

/**
 * The 거래처 등록/수정 form.
 * Input (PartnerFormInput): what the form holds; every text box is a string
 * (e.g. creditLimit "3,000,000", paymentDay "10", phone "02-123-4567").
 * Output (PartnerFormValues): values ready to save — trimmed, empty optional
 * text → null, phones and 사업자등록번호 → digits, select boxes with nothing
 * chosen → null, and:
 * - paymentDay: a number 1–28 for 매월 N일, otherwise null;
 * - creditLimit: a number for 한도 설정, otherwise null;
 * - 우편번호/상세주소 need a 사업장 주소;
 * - at most one 대표 담당자 (error under "contacts");
 * - at most one 기본 배송지 (error under "addresses"); when there are
 *   addresses and none is marked, the first one becomes the 기본 배송지.
 * These rules between fields run only once every field is valid on its own.
 */
export const partnerFormSchema = partnerFieldsSchema.transform(
  (values, ctx) => {
    let failed = false
    function fail(path: string, message: string) {
      ctx.addIssue({ code: "custom", path: [path], message })
      failed = true
    }

    let paymentDay: number | null = null
    if (values.paymentTerm === "monthly_day") {
      const day = /^\d{1,2}$/.test(values.paymentDay)
        ? Number(values.paymentDay)
        : NaN
      if (
        day >= PARTNER_LIMITS.paymentDayMin &&
        day <= PARTNER_LIMITS.paymentDayMax
      ) {
        paymentDay = day
      } else {
        fail("paymentDay", paymentDayMessage)
      }
    }

    let creditLimit: number | null = null
    if (values.creditLimitType === "limited") {
      const digits = values.creditLimit.replace(/[,\s]/g, "")
      if (digits === "") {
        fail(
          "creditLimit",
          "외상 한도 금액을 입력해 주세요. (0원 = 외상 안 됨)"
        )
      } else if (!/^\d+$/.test(digits)) {
        fail("creditLimit", creditLimitInvalidMessage)
      } else if (Number(digits) > PARTNER_LIMITS.creditLimitMax) {
        fail("creditLimit", "외상 한도 금액은 100억 원 이하로 입력해 주세요.")
      } else {
        creditLimit = Number(digits)
      }
    }

    if (
      values.address === null &&
      (values.postalCode !== null || values.addressDetail !== null)
    ) {
      fail(
        "address",
        "사업장 주소를 입력해 주세요. (우편번호나 상세주소만 따로 저장할 수 없습니다.)"
      )
    }

    if (values.contacts.filter((contact) => contact.isPrimary).length > 1) {
      fail("contacts", "대표 담당자는 1명만 정할 수 있습니다.")
    }
    if (values.addresses.filter((address) => address.isDefault).length > 1) {
      fail("addresses", "기본 배송지는 1곳만 정할 수 있습니다.")
    }
    if (hasDuplicateIds(values.contacts)) {
      fail(
        "contacts",
        "같은 담당자가 두 번 들어 있습니다. 창을 다시 열어 주세요."
      )
    }
    if (hasDuplicateIds(values.addresses)) {
      fail(
        "addresses",
        "같은 배송지가 두 번 들어 있습니다. 창을 다시 열어 주세요."
      )
    }

    if (failed) return z.NEVER

    const markedDefault = values.addresses.findIndex(
      (address) => address.isDefault
    )
    const defaultIndex = markedDefault === -1 ? 0 : markedDefault
    return {
      ...values,
      paymentDay,
      creditLimit,
      addresses: values.addresses.map((address, index) => ({
        ...address,
        isDefault: index === defaultIndex,
      })),
    }
  }
)

function hasDuplicateIds(rows: readonly { id: string | null }[]): boolean {
  const ids = rows.flatMap((row) => (row.id === null ? [] : [row.id]))
  return new Set(ids).size !== ids.length
}

/** What the 거래처 form holds while the user is typing. */
export type PartnerFormInput = z.input<typeof partnerFormSchema>

/** Checked form values, ready to save (see partnerFormSchema). */
export type PartnerFormValues = z.output<typeof partnerFormSchema>

/** Name of a top-level field of the 거래처 form, e.g. "code" or "contacts". */
export type PartnerFieldName = keyof PartnerFormInput

/**
 * A field of the form as react-hook-form names it: a top-level field
 * ("code"), a whole list ("contacts", "addresses" for messages about the
 * list) or a field of one row ("contacts.0.name", "addresses.2.address").
 */
export type PartnerFieldPath =
  | PartnerFieldName
  | `contacts.${number}.${keyof PartnerContactInput}`
  | `addresses.${number}.${keyof PartnerAddressInput}`

/** One Korean error message per field (see PartnerFieldPath). */
export type PartnerFieldErrors = Partial<Record<PartnerFieldPath, string>>

/**
 * Starting values of the 거래처 등록 form: 매출처, 사용, 결제일 미지정,
 * 외상 무제한, 계산서 건별, 금액 인쇄, no 담당자 and no 배송지.
 */
export const emptyPartnerFormInput: PartnerFormInput = {
  partnerType: "sales",
  code: "",
  name: "",
  phone: "",
  industry: "",
  salesRepId: "",
  deliveryRepId: "",
  categoryId: "",
  isActive: true,
  paymentTerm: "unspecified",
  paymentDay: "",
  creditLimitType: "unlimited",
  creditLimit: "",
  invoiceType: "monthly",
  slipPrint: "with_amount",
  businessNumber: "",
  companyName: "",
  representative: "",
  businessCategory: "",
  businessItem: "",
  postalCode: "",
  address: "",
  addressDetail: "",
  taxEmail: "",
  contacts: [],
  addresses: [],
  note: "",
}

/**
 * A saved partner (with its 담당자 and 배송지, as getPartner /
 * loadPartnerForEdit return it) as starting values of the 거래처 수정 form.
 * Phones and 사업자등록번호 are shown with hyphens, amounts with commas.
 */
export function partnerToFormInput(
  partner: Tables<"partners"> & {
    contacts: readonly Tables<"partner_contacts">[]
    addresses: readonly Tables<"partner_addresses">[]
  }
): PartnerFormInput {
  return {
    partnerType: partner.partner_type,
    code: partner.code,
    name: partner.name,
    phone: formatPhone(partner.phone),
    industry: partner.industry ?? "",
    salesRepId: partner.sales_rep_id ?? "",
    deliveryRepId: partner.delivery_rep_id ?? "",
    categoryId: partner.category_id ?? "",
    isActive: partner.is_active,
    paymentTerm: partner.payment_term,
    paymentDay: partner.payment_day === null ? "" : String(partner.payment_day),
    creditLimitType: partner.credit_limit_type,
    creditLimit:
      partner.credit_limit === null
        ? ""
        : formatDigits(String(partner.credit_limit)),
    invoiceType: partner.invoice_type,
    slipPrint: partner.slip_print,
    businessNumber: formatBusinessNumber(partner.business_number),
    companyName: partner.company_name ?? "",
    representative: partner.representative ?? "",
    businessCategory: partner.business_category ?? "",
    businessItem: partner.business_item ?? "",
    postalCode: partner.postal_code ?? "",
    address: partner.address ?? "",
    addressDetail: partner.address_detail ?? "",
    taxEmail: partner.tax_email ?? "",
    contacts: partner.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      jobTitle: contact.job_title ?? "",
      mobile: formatPhone(contact.mobile),
      phone: formatPhone(contact.phone),
      email: contact.email ?? "",
      memo: contact.memo ?? "",
      isPrimary: contact.is_primary,
    })),
    addresses: partner.addresses.map((address) => ({
      id: address.id,
      label: address.label,
      postalCode: address.postal_code ?? "",
      address: address.address,
      addressDetail: address.address_detail ?? "",
      recipient: address.recipient ?? "",
      phone: formatPhone(address.phone),
      memo: address.memo ?? "",
      isDefault: address.is_default,
    })),
    note: partner.note ?? "",
  }
}

// ---------------------------------------------------------------------------
// Tabs of the 등록/수정 modal and which tab shows each field
// ---------------------------------------------------------------------------

/** Tabs of the 거래처 등록/수정 modal, in display order. */
export const PARTNER_FORM_TABS = [
  { value: "basic", label: "기본정보" },
  { value: "business", label: "사업자정보" },
  { value: "contacts", label: "담당자정보" },
  { value: "addresses", label: "배송지" },
  { value: "note", label: "특이사항" },
] as const

export type PartnerFormTab = (typeof PARTNER_FORM_TABS)[number]["value"]

const FIELD_TABS: Record<PartnerFieldName, PartnerFormTab> = {
  partnerType: "basic",
  code: "basic",
  name: "basic",
  phone: "basic",
  industry: "basic",
  salesRepId: "basic",
  deliveryRepId: "basic",
  categoryId: "basic",
  isActive: "basic",
  paymentTerm: "basic",
  paymentDay: "basic",
  creditLimitType: "basic",
  creditLimit: "basic",
  invoiceType: "basic",
  slipPrint: "basic",
  businessNumber: "business",
  companyName: "business",
  representative: "business",
  businessCategory: "business",
  businessItem: "business",
  postalCode: "business",
  address: "business",
  addressDetail: "business",
  taxEmail: "business",
  contacts: "contacts",
  addresses: "addresses",
  note: "note",
}

/**
 * The tab that shows a field (to switch to the first tab with an error).
 * @example partnerFieldTab("contacts.2.mobile") // "contacts"
 * @example partnerFieldTab("businessNumber") // "business"
 */
export function partnerFieldTab(path: string): PartnerFormTab {
  const field = path.split(".")[0] as PartnerFieldName
  return FIELD_TABS[field] ?? "basic"
}

// ---------------------------------------------------------------------------
// 선택 사용 / 선택 미사용 (checked rows of the list)
// ---------------------------------------------------------------------------

/** Most partners one 선택 사용 / 선택 미사용 may change (= biggest page). */
export const PARTNER_BULK_MAX = 300

/** The ids of the checked partners: 1 to PARTNER_BULK_MAX UUIDs. */
export const partnerIdsSchema = z
  .array(
    text("거래처를 다시 선택해 주세요.").refine(isUuid, {
      error: "거래처를 다시 선택해 주세요.",
    }),
    { error: "거래처를 다시 선택해 주세요." }
  )
  .min(1, { error: "먼저 거래처를 체크해 주세요." })
  .max(PARTNER_BULK_MAX, {
    error: `한 번에 ${PARTNER_BULK_MAX}개까지 바꿀 수 있습니다.`,
  })
  // No duplicates; ids in lower case like the database returns them.
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))])

// ---------------------------------------------------------------------------
// The list's grid columns
// ---------------------------------------------------------------------------

/**
 * Grid columns of the 거래처관리 list, in the default order (after the
 * checkbox column, which always stays first). Every column can be sorted
 * with a click on its title: the id is also the sort key (URL param
 * "sort", see PartnerListSort). Users can drag columns to another place
 * (useColumnOrder with PARTNER_COLUMN_ORDER_KEY).
 */
export const PARTNER_COLUMNS = [
  { id: "type", title: "구분" },
  { id: "code", title: "거래처코드" },
  { id: "name", title: "거래처명" },
  { id: "representative", title: "대표자" },
  { id: "business_number", title: "사업자번호" },
  { id: "phone", title: "대표연락처" },
  { id: "sales_rep", title: "영업담당" },
  { id: "delivery_rep", title: "배송담당" },
  { id: "industry", title: "업종" },
  { id: "category", title: "거래처분류" },
  { id: "address", title: "기본 배송지" },
  { id: "payment", title: "결제일" },
  { id: "credit", title: "외상한도" },
  { id: "status", title: "사용여부" },
] as const

/** A grid column id (= its sort key), e.g. "sales_rep". */
export type PartnerColumnId = (typeof PARTNER_COLUMNS)[number]["id"]

/** Every column id in the default order (for useColumnOrder). */
export const PARTNER_COLUMN_IDS: readonly PartnerColumnId[] =
  PARTNER_COLUMNS.map((column) => column.id)

/** localStorage key of the column order (raise the version if ids change). */
export const PARTNER_COLUMN_ORDER_KEY = "partners.grid.columnOrder.v1"

/** Title of a grid column, e.g. "영업담당". */
export function partnerColumnTitle(id: PartnerColumnId): string {
  return PARTNER_COLUMNS.find((column) => column.id === id)?.title ?? id
}

/** The 거래처분류설정 screen (partner list + 분류적용 / 분류해제). */
export const PARTNER_CATEGORIES_PATH = "/partners/categories"

/**
 * Grid columns of the 거래처분류설정 screen's partner list, in the default
 * order (after the checkbox column). Same ids (= sort keys) as the
 * 거래처관리 grid; "category" is titled 적용분류 there and shows the path.
 */
export const PARTNER_CATEGORY_SCREEN_COLUMNS = [
  { id: "code", title: "거래처코드" },
  { id: "name", title: "거래처명" },
  { id: "type", title: "구분" },
  { id: "sales_rep", title: "영업담당" },
  { id: "delivery_rep", title: "배송담당" },
  { id: "category", title: "적용분류" },
  { id: "status", title: "사용여부" },
] as const satisfies readonly { id: PartnerColumnId; title: string }[]

/** A column id of the 거래처분류설정 grid. */
export type PartnerCategoryScreenColumnId =
  (typeof PARTNER_CATEGORY_SCREEN_COLUMNS)[number]["id"]

/** Every column id of the 거래처분류설정 grid in the default order. */
export const PARTNER_CATEGORY_SCREEN_COLUMN_IDS: readonly PartnerCategoryScreenColumnId[] =
  PARTNER_CATEGORY_SCREEN_COLUMNS.map((column) => column.id)

/** localStorage key of the 거래처분류설정 grid's column order. */
export const PARTNER_CATEGORY_SCREEN_COLUMN_ORDER_KEY =
  "partners.categories.grid.columnOrder.v1"

// ---------------------------------------------------------------------------
// The list URL: /partners?q=...&type=sales&sort=name_desc&page=2&size=300
// ---------------------------------------------------------------------------

/** 사용 여부 filter of the list. Default: "active" (사용 only). */
export const PARTNER_STATUS_FILTERS = [
  { value: "active", label: "사용" },
  { value: "inactive", label: "미사용" },
  { value: "all", label: "전체" },
] as const

export type PartnerStatusFilter =
  (typeof PARTNER_STATUS_FILTERS)[number]["value"]

/**
 * 구분 filter (URL param "type"). 매출처 and 매입처 include the 매출·매입
 * partners (they are both), "both" shows only 매출·매입.
 */
export const PARTNER_TYPE_FILTERS = [
  { value: "sales", label: "매출처", description: "매출·매입 거래처 포함" },
  { value: "purchase", label: "매입처", description: "매출·매입 거래처 포함" },
  { value: "both", label: "매출·매입", description: "매출·매입 거래처만" },
] as const satisfies readonly {
  value: PartnerType
  label: string
  description: string
}[]

/**
 * The partner types a 구분 filter shows.
 * @example partnerTypesOfFilter("sales") // ["sales", "both"]
 */
export function partnerTypesOfFilter(filter: PartnerType): PartnerType[] {
  return filter === "both" ? ["both"] : [filter, "both"]
}

/**
 * 영업담당 / 배송담당 filter: an employee id, or "none" = 담당자가 없는
 * 거래처 (미지정).
 */
export const REP_FILTER_NONE = "none"

export type RepFilter = string | typeof REP_FILTER_NONE

export type SortDirection = "asc" | "desc"

/**
 * Sort order of the list (URL param "sort"; default "code" = 거래처코드순):
 * - a column id ("name", "sales_rep", …): that column, 오름차순 (▲);
 * - the id + "_desc" ("name_desc", …): that column, 내림차순 (▼);
 * - "recent": 최근 등록순 (newest first).
 * Empty values come last either way.
 */
export type PartnerListSort =
  PartnerColumnId | `${PartnerColumnId}_desc` | "recent"

const PARTNER_LIST_SORT_VALUES: readonly PartnerListSort[] = [
  ...PARTNER_COLUMN_IDS.flatMap((id) => [id, `${id}_desc` as const]),
  "recent",
]

/**
 * The choices of a 정렬 select (the current order may also have been chosen
 * with a click on a column title: show partnerSortLabel(sort) then).
 */
export const PARTNER_LIST_SORTS: readonly {
  value: PartnerListSort
  label: string
}[] = [
  { value: "code", label: "거래처코드순" },
  { value: "name", label: "거래처명순" },
  { value: "recent", label: "최근 등록순" },
]

/** The column and direction of a sort, or null for "recent". */
export function partnerSortState(
  sort: PartnerListSort
): { column: PartnerColumnId; direction: SortDirection } | null {
  if (sort === "recent") return null
  if (sort.endsWith("_desc")) {
    return {
      column: sort.slice(0, -"_desc".length) as PartnerColumnId,
      direction: "desc",
    }
  }
  return { column: sort as PartnerColumnId, direction: "asc" }
}

/** The name of a sort order, e.g. "거래처코드순", "영업담당 내림차순 ▼". */
export function partnerSortLabel(sort: PartnerListSort): string {
  const listed = PARTNER_LIST_SORTS.find((option) => option.value === sort)
  if (listed) return listed.label
  const state = partnerSortState(sort)
  if (!state) return sort
  const title = partnerColumnTitle(state.column)
  return state.direction === "asc"
    ? `${title} 오름차순 ▲`
    : `${title} 내림차순 ▼`
}

/**
 * The sort after a click on a column title: 오름차순 (▲) → 내림차순 (▼) →
 * back to the default (거래처코드순). The 거래처코드 title switches between
 * ▲ and ▼.
 */
export function nextPartnerColumnSort(
  current: PartnerListSort,
  column: PartnerColumnId
): PartnerListSort {
  const state = partnerSortState(current)
  if (state?.column !== column) return column
  if (state.direction === "asc") return `${column}_desc`
  return defaultPartnerListParams.sort
}

/** Rows per page the list offers (URL param "size"). Default 100. */
export const PARTNER_PAGE_SIZES = [50, 100, 300] as const

export type PartnerPageSize = (typeof PARTNER_PAGE_SIZES)[number]

/** Longest search text that is used; anything longer is cut off. */
export const PARTNER_SEARCH_MAX_LENGTH = 100

/** Most rows the 엑셀 download contains. */
export const PARTNER_EXPORT_MAX_ROWS = 10_000

/** Highest page number accepted from the URL. */
const MAX_PAGE = 10_000

/** Search, filters, sort and page of the 거래처 list (all from the URL). */
export type PartnerListParams = {
  /**
   * Search text (URL param "q"): 거래처명, 거래처코드, 상호, 대표자, and —
   * by its digits — 사업자번호 and 대표연락처. "" = no search.
   */
  q: string
  /** 구분 (URL param "type"), see PARTNER_TYPE_FILTERS. null = 전체. */
  partnerType: PartnerType | null
  /**
   * 거래처분류 id (URL param "category"), any level: the list shows the
   * partners in it AND in every category below it. null = 전체.
   */
  categoryId: string | null
  /**
   * "미분류 거래처만 보기" (URL param "uncategorized=1"): only partners
   * without a 거래처분류. When it is on, `categoryId` is always null.
   */
  uncategorized: boolean
  /** 영업담당 (URL param "sales_rep"): employee id or "none". null = 전체. */
  salesRepId: RepFilter | null
  /** 배송담당 (URL param "delivery_rep"): employee id or "none". null = 전체. */
  deliveryRepId: RepFilter | null
  /** 업종 (URL param "industry"). null = 전체. */
  industry: PartnerIndustry | null
  /** 사용 여부 (URL param "status"). */
  status: PartnerStatusFilter
  sort: PartnerListSort
  /** 1-based page number. */
  page: number
  /** Rows per page (URL param "size"). */
  pageSize: PartnerPageSize
}

export const defaultPartnerListParams: PartnerListParams = {
  q: "",
  partnerType: null,
  categoryId: null,
  uncategorized: false,
  salesRepId: null,
  deliveryRepId: null,
  industry: null,
  status: "active",
  sort: "code",
  page: 1,
  pageSize: 100,
}

type SearchParamsRecord = Record<string, string | string[] | undefined>

/** First value of a search param (?a=1&a=2 → "1"). */
function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

function pickValue<T extends string>(
  value: string,
  allowed: readonly T[]
): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function pickRep(value: string): RepFilter | null {
  if (value === REP_FILTER_NONE) return REP_FILTER_NONE
  return isUuid(value) ? value.toLowerCase() : null
}

/**
 * Reads the list's search, filters, sort and page from the URL. Anything
 * missing or invalid falls back to the default, so a hand-edited URL never
 * breaks the page. (Page numbers past the end are clamped by listPartners.)
 * The modal params are ignored.
 */
export function parsePartnerListParams(
  searchParams: SearchParamsRecord
): PartnerListParams {
  const category = firstParam(searchParams.category)
  const page = firstParam(searchParams.page)
  const pageNumber = /^\d{1,6}$/.test(page) ? Number(page) : 1
  const size = Number(firstParam(searchParams.size))
  const uncategorized = ["1", "true"].includes(
    firstParam(searchParams.uncategorized)
  )

  return {
    q: firstParam(searchParams.q).trim().slice(0, PARTNER_SEARCH_MAX_LENGTH),
    partnerType: pickValue(
      firstParam(searchParams.type),
      Constants.public.Enums.partner_type
    ),
    categoryId:
      !uncategorized && isUuid(category) ? category.toLowerCase() : null,
    uncategorized,
    salesRepId: pickRep(firstParam(searchParams.sales_rep)),
    deliveryRepId: pickRep(firstParam(searchParams.delivery_rep)),
    industry: pickValue(
      firstParam(searchParams.industry),
      Constants.public.Enums.partner_industry
    ),
    status:
      pickValue(
        firstParam(searchParams.status),
        PARTNER_STATUS_FILTERS.map((filter) => filter.value)
      ) ?? defaultPartnerListParams.status,
    sort:
      pickValue(firstParam(searchParams.sort), PARTNER_LIST_SORT_VALUES) ??
      defaultPartnerListParams.sort,
    page: Math.min(Math.max(pageNumber, 1), MAX_PAGE),
    pageSize: PARTNER_PAGE_SIZES.includes(size as PartnerPageSize)
      ? (size as PartnerPageSize)
      : defaultPartnerListParams.pageSize,
  }
}

/**
 * The search, filters and sort as URL params, without page and page size.
 * Default values are left out. Used by the list URL and the 엑셀 URL.
 */
export function partnerListFilterQuery(
  params: PartnerListParams
): URLSearchParams {
  const query = new URLSearchParams()
  if (params.q) query.set("q", params.q)
  if (params.partnerType) query.set("type", params.partnerType)
  if (params.uncategorized) {
    query.set("uncategorized", "1")
  } else if (params.categoryId) {
    query.set("category", params.categoryId)
  }
  if (params.salesRepId) query.set("sales_rep", params.salesRepId)
  if (params.deliveryRepId) query.set("delivery_rep", params.deliveryRepId)
  if (params.industry) query.set("industry", params.industry)
  if (params.status !== defaultPartnerListParams.status) {
    query.set("status", params.status)
  }
  if (params.sort !== defaultPartnerListParams.sort) {
    query.set("sort", params.sort)
  }
  return query
}

/**
 * The list URL for the given search, filters, sort, page and page size.
 * Default values are left out, so the plain list is just "/partners".
 * `basePath`: the screen showing the list ("/partners", or
 * PARTNER_CATEGORIES_PATH for the 거래처분류설정 screen, which reads the
 * same params).
 */
export function buildPartnerListHref(
  params: PartnerListParams,
  basePath: string = "/partners"
): string {
  const query = partnerListFilterQuery(params)
  if (params.page > 1) query.set("page", String(params.page))
  if (params.pageSize !== defaultPartnerListParams.pageSize) {
    query.set("size", String(params.pageSize))
  }
  const search = query.toString()
  return search ? `${basePath}?${search}` : basePath
}

/** The 엑셀 (CSV) download URL for the list's current search and filters. */
export function buildPartnerExportHref(params: PartnerListParams): string {
  const search = partnerListFilterQuery(params).toString()
  return search ? `/partners/export?${search}` : "/partners/export"
}

/**
 * Whether any search or filter differs from the default list (sort, page
 * and page size do not count).
 */
export function hasPartnerListFilters(params: PartnerListParams): boolean {
  return (
    params.q !== "" ||
    params.partnerType !== null ||
    params.categoryId !== null ||
    params.uncategorized ||
    params.salesRepId !== null ||
    params.deliveryRepId !== null ||
    params.industry !== null ||
    params.status !== defaultPartnerListParams.status
  )
}

// ---------------------------------------------------------------------------
// 등록/수정 modal in the URL:
//   /partners?modal=new                거래처 등록
//   /partners?modal=edit&id=<uuid>     거래처 수정
// ---------------------------------------------------------------------------

/**
 * Which 거래처 modal is open. For "edit", `id` is the text from the URL; it
 * may be invalid (the modal then says the partner was not found).
 */
export type PartnerModalState = { mode: "new" } | { mode: "edit"; id: string }

/** The open modal from the URL params, or null when none is open. */
export function parsePartnerModal(
  searchParams: Pick<URLSearchParams, "get">
): PartnerModalState | null {
  const modal = searchParams.get("modal")
  if (modal === "new") return { mode: "new" }
  if (modal === "edit")
    return { mode: "edit", id: searchParams.get("id") ?? "" }
  return null
}

/**
 * The list URL with this modal open (or closed, for null), keeping every
 * other param of `currentSearch` (filters, page).
 * @example buildPartnerModalHref("?q=한빛", { mode: "new" }) // "/partners?q=한빛&modal=new"
 */
export function buildPartnerModalHref(
  currentSearch: string,
  modal: PartnerModalState | null
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
  return search ? `/partners?${search}` : "/partners"
}
