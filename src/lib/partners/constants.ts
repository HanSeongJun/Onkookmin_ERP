/**
 * Fixed choices and input rules for 거래처 (partners).
 *
 * The database checks the same rules (supabase/migrations/*_partners.sql).
 * When you change a rule here, change it there too with a new migration.
 *
 * No server imports: Client Components use this file too.
 */

import type { Enums } from "@/types/database"

// ---------------------------------------------------------------------------
// 구분 (partner type)
// ---------------------------------------------------------------------------

/** Database value of 구분: "sales" | "purchase" | "both". */
export type PartnerType = Enums<"partner_type">

/**
 * 구분 choices, in display order.
 * - 매출처: we sell to them (restaurants, 급식 ...).
 * - 매입처: we buy from them (suppliers).
 * - 매출·매입: both.
 */
export const PARTNER_TYPES = [
  { value: "sales", label: "매출처", description: "우리가 상품을 파는 거래처" },
  {
    value: "purchase",
    label: "매입처",
    description: "우리가 상품을 사 오는 거래처",
  },
  {
    value: "both",
    label: "매출·매입",
    description: "팔기도 하고 사 오기도 함",
  },
] as const satisfies readonly {
  value: PartnerType
  label: string
  description: string
}[]

/**
 * Korean label of a 구분 value.
 * @example partnerTypeLabel("both") // "매출·매입"
 */
export function partnerTypeLabel(value: PartnerType): string {
  return PARTNER_TYPES.find((type) => type.value === value)?.label ?? value
}

// ---------------------------------------------------------------------------
// 업종 (industry)
// ---------------------------------------------------------------------------

/** Database value of 업종, e.g. "korean". */
export type PartnerIndustry = Enums<"partner_industry">

/** 업종 choices, in display order (optional field: empty = 미지정). */
export const PARTNER_INDUSTRIES = [
  { value: "korean", label: "한식" },
  { value: "chinese", label: "중식" },
  { value: "japanese", label: "일식" },
  { value: "western", label: "양식" },
  { value: "snack", label: "분식" },
  { value: "cafe_bakery", label: "카페·베이커리" },
  { value: "pub", label: "주점" },
  { value: "catering", label: "단체급식" },
  { value: "franchise", label: "프랜차이즈" },
  { value: "food_distribution", label: "식자재 도소매" },
  { value: "other", label: "기타" },
] as const satisfies readonly { value: PartnerIndustry; label: string }[]

/**
 * Korean label of a 업종 value.
 * @example partnerIndustryLabel("cafe_bakery") // "카페·베이커리"
 */
export function partnerIndustryLabel(value: PartnerIndustry): string {
  return (
    PARTNER_INDUSTRIES.find((industry) => industry.value === value)?.label ??
    value
  )
}

// ---------------------------------------------------------------------------
// 거래조건: 결제일, 외상 한도, 계산서 발행, 전표 인쇄
// ---------------------------------------------------------------------------

/** Database value of 결제일: "unspecified" | "per_order" | "monthly_day" | "month_end". */
export type PaymentTerm = Enums<"payment_term">

/**
 * 결제일 choices, in display order. "monthly_day" (매월 N일) also needs
 * the day (1–28) in `payment_day`.
 */
export const PAYMENT_TERMS = [
  { value: "unspecified", label: "미지정" },
  { value: "per_order", label: "건별 즉시" },
  { value: "monthly_day", label: "매월 N일" },
  { value: "month_end", label: "매월 말일" },
] as const satisfies readonly { value: PaymentTerm; label: string }[]

/**
 * The 결제일 as text for the list and the 엑셀 file.
 * @example formatPaymentTerm("monthly_day", 10) // "매월 10일"
 * @example formatPaymentTerm("month_end", null) // "매월 말일"
 */
export function formatPaymentTerm(
  term: PaymentTerm,
  day: number | null
): string {
  if (term === "monthly_day") return day === null ? "매월 -일" : `매월 ${day}일`
  return PAYMENT_TERMS.find((option) => option.value === term)?.label ?? term
}

/** Database value of 외상 한도: "unlimited" | "limited" | "none". */
export type CreditLimitType = Enums<"credit_limit_type">

/**
 * 외상(잔액) 한도 choices, in display order. "limited" (한도 설정) also
 * needs the amount in won in `credit_limit`.
 */
export const CREDIT_LIMIT_TYPES = [
  { value: "unlimited", label: "무제한" },
  { value: "limited", label: "한도 설정" },
  { value: "none", label: "외상 불가" },
] as const satisfies readonly { value: CreditLimitType; label: string }[]

/**
 * The 외상 한도 as text for the list and the 엑셀 file.
 * @example formatCreditLimit("limited", 3000000) // "3,000,000원"
 * @example formatCreditLimit("none", null) // "외상 불가"
 */
export function formatCreditLimit(
  type: CreditLimitType,
  amount: number | null
): string {
  if (type === "limited") {
    return amount === null ? "-" : `${amount.toLocaleString("ko-KR")}원`
  }
  return (
    CREDIT_LIMIT_TYPES.find((option) => option.value === type)?.label ?? type
  )
}

/** Database value of 계산서 발행: "per_order" | "monthly" | "none". */
export type InvoiceType = Enums<"invoice_type">

/** 계산서 발행 choices, in display order. */
export const INVOICE_TYPES = [
  { value: "per_order", label: "건별" },
  { value: "monthly", label: "월합계" },
  { value: "none", label: "미발행" },
] as const satisfies readonly { value: InvoiceType; label: string }[]

/** Korean label of a 계산서 발행 value, e.g. "월합계". */
export function invoiceTypeLabel(value: InvoiceType): string {
  return INVOICE_TYPES.find((option) => option.value === value)?.label ?? value
}

/** Database value of 전표 인쇄: "with_amount" | "quantity_only". */
export type SlipPrintType = Enums<"slip_print_type">

/** 전표 인쇄 choices, in display order (default 금액 인쇄). */
export const SLIP_PRINT_TYPES = [
  { value: "with_amount", label: "금액 인쇄" },
  { value: "quantity_only", label: "수량만 인쇄" },
] as const satisfies readonly { value: SlipPrintType; label: string }[]

/** Korean label of a 전표 인쇄 value, e.g. "수량만 인쇄". */
export function slipPrintLabel(value: SlipPrintType): string {
  return (
    SLIP_PRINT_TYPES.find((option) => option.value === value)?.label ?? value
  )
}

// ---------------------------------------------------------------------------
// Input rules (the database checks the same rules)
// ---------------------------------------------------------------------------

/** 거래처코드: 1–30 letters, digits, ".", "_" or "-". Unique ignoring case. */
export const PARTNER_CODE_PATTERN = /^[A-Za-z0-9._-]{1,30}$/

/** 우편번호: the 5-digit 국가기초구역번호. */
export const POSTAL_CODE_PATTERN = /^[0-9]{5}$/

/**
 * E-mail: something@something.something without spaces (a check against
 * typos, not a full RFC check). Same rule as the database function
 * is_valid_email (also at most 254 characters, PARTNER_LIMITS.emailMaxLength).
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Maximum lengths (characters), counts and number ranges. Text is stored
 * trimmed; empty optional text is stored as null.
 */
export const PARTNER_LIMITS = {
  codeMaxLength: 30,
  nameMaxLength: 100,
  companyNameMaxLength: 100,
  representativeMaxLength: 50,
  businessCategoryMaxLength: 100,
  businessItemMaxLength: 100,
  addressMaxLength: 200,
  addressDetailMaxLength: 200,
  emailMaxLength: 254,
  noteMaxLength: 2000,
  categoryNameMaxLength: 30,
  contactNameMaxLength: 50,
  contactJobTitleMaxLength: 50,
  contactMemoMaxLength: 500,
  addressLabelMaxLength: 50,
  recipientMaxLength: 50,
  deliveryMemoMaxLength: 200,
  /** 담당자 per partner (create_partner / update_partner check it too). */
  contactsMax: 50,
  /** 배송지 per partner (create_partner / update_partner check it too). */
  addressesMax: 50,
  /** 결제일 매월 N일: N from 1 to 28 (매월 말일 covers 29–31). */
  paymentDayMin: 1,
  paymentDayMax: 28,
  /** 외상 한도 금액: whole won, 0 to 100억 (the database only checks ≥ 0). */
  creditLimitMax: 10_000_000_000,
} as const

/**
 * Names of database constraints that a Server Action can turn into a field
 * error. A violation comes back from Supabase with `error.code` "23505"
 * (duplicate), "23503" (foreign key) or "23514" (check) and the constraint
 * name inside `error.message`.
 */
export const PARTNER_DB_CONSTRAINTS = {
  /** Same 거래처코드 already used (ignoring case). → "이미 사용 중인 거래처코드입니다." */
  codeUnique: "partners_code_lower_key",
  /** Same 거래처분류 name under the same parent (two 대분류 included). */
  categoryNameUnique: "partner_categories_parent_id_name_key",
  /** A partner still uses the 거래처분류 (delete refused). */
  categoryForeignKey: "partners_category_id_fkey",
  /** A second 대표 담당자 (unique index). */
  primaryContactUnique: "partner_contacts_one_primary_key",
  /** A second 기본 배송지 (unique index). */
  defaultAddressUnique: "partner_addresses_one_default_key",
} as const

/**
 * Keys of the rules that the database's own functions and triggers check
 * for 거래처 and 거래처분류 (supabase/migrations/*_partners.sql and
 * *_partner_categories_tree_employees_v2.sql). The database sends a Korean
 * message (`error.message`, ready to show) and this key in `error.hint`, so
 * a Server Action knows which field it belongs to. Change both places
 * together.
 */
export const PARTNER_DB_RULES = {
  /** update_partner: no such partner. */
  partnerNotFound: "partner_not_found",
  /** update_partner: saved by someone else after the form was opened. */
  partnerChanged: "partner_changed",
  /** The 담당자 / 배송지 lists could not be read (a broken request). */
  rowsInvalid: "partner_rows_invalid",
  /** More than PARTNER_LIMITS.contactsMax 담당자. */
  contactsTooMany: "partner_contacts_too_many",
  /** More than PARTNER_LIMITS.addressesMax 배송지. */
  addressesTooMany: "partner_addresses_too_many",
  /** Two 대표 담당자. */
  primaryContactDuplicate: "partner_primary_contact_duplicate",
  /** Two 기본 배송지. */
  defaultAddressDuplicate: "partner_default_address_duplicate",
  /** Addresses but no 기본 배송지 (checked when the save ends). */
  defaultAddressRequired: "partner_default_address_required",
  /** The chosen 거래처분류 does not exist (deleted meanwhile). */
  categoryNotFound: "partner_category_not_found",
  /**
   * The chosen 거래처분류, or a category above it, is 사용 중지 (only a
   * change is checked).
   */
  categoryInactive: "partner_category_inactive",
  /** The chosen 영업담당 does not exist. */
  salesRepNotFound: "sales_rep_not_found",
  /** The chosen 영업담당 is 퇴사 (only a change is checked). */
  salesRepInactive: "sales_rep_inactive",
  /** The chosen 영업담당 does not have 담당업무 영업담당. */
  salesRepDutyMissing: "sales_rep_duty_missing",
  /** The chosen 배송담당 does not exist. */
  deliveryRepNotFound: "delivery_rep_not_found",
  /** The chosen 배송담당 is 퇴사 (only a change is checked). */
  deliveryRepInactive: "delivery_rep_inactive",
  /** The chosen 배송담당 does not have 담당업무 배송담당. */
  deliveryRepDutyMissing: "delivery_rep_duty_missing",
  // 분류값 설정 (save_partner_categories) and 분류적용 (set_partner_category)
  /** Someone changed the 거래처분류 after the window was opened. */
  categoryTreeChanged: "partner_category_tree_changed",
  /** The window's changes could not be read (a broken request). */
  categoryChangesInvalid: "partner_category_changes_invalid",
  /** A name is empty, too long or has spaces at either end. */
  categoryNameInvalid: "partner_category_name_invalid",
  /** Two categories with the same name under the same parent. */
  categoryNameDuplicate: "partner_category_name_duplicate",
  /** A category to delete still has partners. */
  categoryInUse: "partner_category_in_use",
  /** A category to delete still has sub-categories. */
  categoryHasChildren: "partner_category_has_children",
  /** A fourth level (below a 소분류). */
  categoryTooDeep: "partner_category_too_deep",
  /** A category under itself or under one of its own sub-categories. */
  categoryCycle: "partner_category_cycle",
  /** The parent of a new category was deleted meanwhile. */
  categoryParentNotFound: "partner_category_parent_not_found",
  /** 분류적용 / 분류해제 without (or with too many) checked partners. */
  partnerIdsInvalid: "partner_ids_invalid",
} as const

/** Whether `hint` is one of the keys of PARTNER_DB_RULES. */
export function isPartnerDbRule(hint: string | null | undefined): boolean {
  return (Object.values(PARTNER_DB_RULES) as string[]).includes(hint ?? "")
}
