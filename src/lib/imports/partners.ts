/**
 * 거래처 일괄등록 (/imports/partners): one row = one 거래처, with at most
 * one 기본 배송지 and one 대표 담당자. 영업담당 / 배송담당 are given by
 * 직원코드, 거래처분류 by names (대분류 / 중분류 / 소분류).
 *
 * The spec (columns, template examples) and the check of a file, reusing
 * the 거래처 등록 form's zod rules (`@/lib/partners/schema`). No server
 * imports: Client Components use this file too.
 */

import {
  addCellFlags,
  addZodIssues,
  buildPreview,
  CategoryPlanner,
  codeKey,
  findDuplicates,
  placesText,
  readCategoryPath,
  RowIssues,
  type NamedCategoryNode,
} from "@/lib/imports/check"
import { MAIN_SHEET, type ImportSpec } from "@/lib/imports/columns"
import type {
  ImportCell,
  ImportInput,
  ImportPreview,
  ImportRawRow,
  ImportRowResult,
} from "@/lib/imports/types"
import {
  amountText,
  cellText,
  choiceLabels,
  matchChoice,
  matchKey,
  NO_WORDS,
  phoneText,
  postalCodeText,
  YES_WORDS,
  type ImportChoice,
} from "@/lib/imports/values"
import { partnerCategoryNameSchema } from "@/lib/partner-categories/schema"
import {
  isValidBusinessNumber,
  toBusinessNumberDigits,
} from "@/lib/partners/business-number"
import {
  INVOICE_TYPES,
  PARTNER_INDUSTRIES,
  PARTNER_LIMITS,
  PARTNER_TYPES,
  SLIP_PRINT_TYPES,
  type CreditLimitType,
  type InvoiceType,
  type PartnerIndustry,
  type PartnerType,
  type PaymentTerm,
  type SlipPrintType,
} from "@/lib/partners/constants"
import { partnerFormSchema } from "@/lib/partners/schema"

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

const PARTNER_TYPE_ALIASES: Record<PartnerType, readonly string[]> = {
  sales: ["매출", "sales"],
  purchase: ["매입", "purchase"],
  both: ["매입매출", "매출처매입처", "매출및매입", "둘다", "both"],
}

/** 구분: 매출처 / 매입처 / 매출·매입 (also 매출매입, 매출/매입 …). */
export const PARTNER_TYPE_CHOICES: readonly ImportChoice<PartnerType>[] =
  PARTNER_TYPES.map((type) => ({
    value: type.value,
    label: type.label,
    aliases: PARTNER_TYPE_ALIASES[type.value],
  }))

const INDUSTRY_ALIASES: Partial<Record<PartnerIndustry, readonly string[]>> = {
  cafe_bakery: ["카페", "베이커리", "제과", "제과점"],
  pub: ["술집", "호프"],
  catering: ["급식", "단체급식소"],
  food_distribution: ["식자재", "도소매", "식자재유통", "식자재도매"],
}

/** 업종 (optional). */
export const INDUSTRY_CHOICES: readonly ImportChoice<PartnerIndustry>[] =
  PARTNER_INDUSTRIES.map((industry) => ({
    value: industry.value,
    label: industry.label,
    aliases: INDUSTRY_ALIASES[industry.value] ?? [],
  }))

/** 계산서발행 (empty = 월합계). */
export const INVOICE_CHOICES: readonly ImportChoice<InvoiceType>[] =
  INVOICE_TYPES.map((type) => ({
    value: type.value,
    label: type.label,
    aliases:
      type.value === "per_order"
        ? ["건별발행"]
        : type.value === "monthly"
          ? ["월합", "월합계발행"]
          : ["발행안함", "없음"],
  }))

/** 전표인쇄 (empty = 금액 인쇄). */
export const SLIP_PRINT_CHOICES: readonly ImportChoice<SlipPrintType>[] =
  SLIP_PRINT_TYPES.map((type) => ({
    value: type.value,
    label: type.label,
    aliases: type.value === "with_amount" ? ["금액"] : ["수량만", "수량"],
  }))

/** 사용여부 of 거래처: 사용 / 미사용 (also Y/N …). */
export const PARTNER_STATUS_CHOICES: readonly ImportChoice<boolean>[] = [
  { value: true, label: "사용", aliases: [...YES_WORDS, "사용중"] },
  {
    value: false,
    label: "미사용",
    aliases: [...NO_WORDS, "사용중지", "중지", "사용안함"],
  },
]

const PAYMENT_TERM_TEXT = "미지정, 건별 즉시, 매월 N일(N은 1~28), 매월 말일"
const CREDIT_LIMIT_TEXT = "무제한, 외상 불가, 또는 한도 금액(예: 3,000,000)"

/**
 * 결제일: "" / 미지정 → unspecified; 건별 즉시 (건별, 즉시) → per_order;
 * 매월 말일 (말일, 월말) → month_end; "매월 10일" / "10일" / 10 →
 * monthly_day with the day as text (the form rule checks 1–28).
 * undefined when it is none of these.
 */
export function parsePaymentTerm(
  cell: ImportCell | undefined
): { term: PaymentTerm; day: string } | undefined {
  const text = cellText(cell)
  const key = matchKey(text)
  if (key === "" || ["미지정", "없음"].includes(key)) {
    return { term: "unspecified", day: "" }
  }
  if (["건별즉시", "건별", "즉시", "건별결제", "현금"].includes(key)) {
    return { term: "per_order", day: "" }
  }
  if (["매월말일", "말일", "월말", "매월말"].includes(key)) {
    return { term: "month_end", day: "" }
  }
  const day = /^(?:매월|매달|월)?(\d{1,2})일?$/.exec(key)
  if (day) return { term: "monthly_day", day: day[1] }
  return undefined
}

/**
 * 외상한도: "" / 무제한 → unlimited; 외상 불가 (불가) → none; an amount
 * ("3,000,000", "300만"은 안 됨) → limited with the amount as digits (the
 * form rule checks it). undefined when it is none of these.
 */
export function parseCreditLimit(
  cell: ImportCell | undefined
): { type: CreditLimitType; amount: string } | undefined {
  const key = matchKey(cellText(cell))
  if (key === "" || ["무제한", "제한없음", "한도없음"].includes(key)) {
    return { type: "unlimited", amount: "" }
  }
  if (["외상불가", "불가", "외상안됨", "외상없음"].includes(key)) {
    return { type: "none", amount: "" }
  }
  const amount = amountText(cell)
  if (/^\d+$/.test(amount)) return { type: "limited", amount }
  return undefined
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

const text = (max: number) => `글자 ${max.toLocaleString("ko-KR")}자 이내`
const PHONE_FORMAT =
  "전화번호 (하이픈 있어도 없어도 됨, 예: 02-123-4567, 010-1234-5678)"

export const PARTNER_IMPORT: ImportSpec = {
  kind: "partners",
  title: "거래처 일괄등록",
  entityLabel: "거래처",
  templateFileName: "거래처_일괄등록_양식.xlsx",
  listHref: "/partners",
  listLabel: "거래처관리",
  hasCategoryOption: true,
  instructions: [
    "‘거래처’ 시트의 2행부터 한 줄에 거래처 하나씩 적어 주세요. 첫 줄(열 이름)은 지우거나 바꾸지 마세요. 열 이름 뒤의 *는 꼭 채워야 하는 칸입니다.",
    "등록만 합니다: 이미 등록된 거래처코드는 오류로 표시되고 등록되지 않습니다. 이미 있는 거래처는 거래처관리에서 수정해 주세요.",
    "영업담당·배송담당은 직원관리의 직원코드로 적습니다(예: 0005). 재직 중이고 담당업무(영업담당/배송담당)가 체크된 직원만 지정할 수 있습니다.",
    "거래처분류는 이름으로 적습니다(대분류 > 중분류 > 소분류). 화면의 ‘없는 분류는 자동으로 만들기’가 켜져 있으면 없는 분류를 새로 만듭니다.",
    "배송지 칸을 하나라도 채우면 기본 배송지 1곳이 함께 등록됩니다(배송지주소 필수, 배송지명을 비우면 ‘기본’). 담당자 칸을 채우면 대표 담당자 1명이 함께 등록됩니다(담당자명 필수).",
    "사업자번호가 다른 거래처와 같아도 등록됩니다(미리보기에 알림만 표시).",
    "‘예시’ 시트는 작성 예입니다. 등록되지 않습니다.",
    "엑셀(.xlsx) 또는 CSV 파일을 올릴 수 있고, 한 번에 3,000행까지 올릴 수 있습니다.",
  ],
  sheets: [
    {
      key: MAIN_SHEET,
      sheetName: "거래처",
      columns: [
        {
          key: "code",
          header: "거래처코드",
          required: true,
          format: `영문, 숫자, 하이픈(-), 밑줄(_), 마침표(.) ${PARTNER_LIMITS.codeMaxLength}자 이내 (띄어쓰기 불가)`,
          help: "회사에서 정한 거래처코드. 대소문자를 구분하지 않고 이미 등록된 코드나 파일 안에서 겹치는 코드는 오류입니다.",
          width: 14,
          textFormat: true,
        },
        {
          key: "name",
          header: "거래처명",
          required: true,
          format: text(PARTNER_LIMITS.nameMaxLength),
          help: "거래처 이름 (간판 이름).",
          width: 24,
          textFormat: true,
        },
        {
          key: "partnerType",
          header: "구분",
          required: true,
          format: "목록에 있는 값 하나",
          allowed: `${choiceLabels(PARTNER_TYPE_CHOICES)} (매출매입, 매출/매입도 됨)`,
          help: "매출처 = 우리가 파는 곳, 매입처 = 우리가 사 오는 곳, 매출·매입 = 둘 다.",
          width: 10,
          textFormat: true,
        },
        {
          key: "phone",
          header: "대표연락처",
          required: false,
          format: PHONE_FORMAT,
          help: "거래처 대표 전화번호.",
          width: 15,
          textFormat: true,
        },
        {
          key: "industry",
          header: "업종",
          required: false,
          format: "목록에 있는 값 하나",
          allowed: `${choiceLabels(INDUSTRY_CHOICES)} (비우면 미지정)`,
          help: "거래처의 업종.",
          width: 12,
          textFormat: true,
        },
        {
          key: "salesRep",
          header: "영업담당(직원코드)",
          aliases: ["영업담당", "영업담당 직원코드"],
          required: false,
          format: "직원코드 (예: 0005)",
          help: "직원관리의 직원코드. 재직 중이고 담당업무 ‘영업담당’이 체크된 직원(판매 채널·플랫폼 포함)만 됩니다.",
          width: 16,
          textFormat: true,
        },
        {
          key: "deliveryRep",
          header: "배송담당(직원코드)",
          aliases: ["배송담당", "배송담당 직원코드", "배송담당(기사)"],
          required: false,
          format: "직원코드 (예: 0009)",
          help: "직원관리의 직원코드. 재직 중이고 담당업무 ‘배송담당’이 체크된 직원(배송 기사)만 됩니다.",
          width: 16,
          textFormat: true,
        },
        {
          key: "categoryMajor",
          header: "대분류",
          aliases: ["거래처분류 대분류"],
          required: false,
          format: "분류 이름 (30자 이내)",
          help: "거래처분류의 대분류 이름. 대분류·중분류·소분류를 모두 비우면 미분류로 등록됩니다.",
          width: 14,
          textFormat: true,
        },
        {
          key: "categoryMiddle",
          header: "중분류",
          aliases: ["거래처분류 중분류"],
          required: false,
          format: "분류 이름 (30자 이내)",
          help: "대분류 아래 중분류 이름. 적으려면 대분류도 적어야 합니다.",
          width: 14,
          textFormat: true,
        },
        {
          key: "categoryMinor",
          header: "소분류",
          aliases: ["거래처분류 소분류"],
          required: false,
          format: "분류 이름 (30자 이내)",
          help: "중분류 아래 소분류 이름. 없는 분류는 ‘없는 분류는 자동으로 만들기’가 켜져 있으면 새로 만듭니다. 사용 중지된 분류에는 넣을 수 없습니다.",
          width: 14,
          textFormat: true,
        },
        {
          key: "paymentTerm",
          header: "결제일",
          required: false,
          format:
            "목록에 있는 값 하나 (매월 N일은 숫자를 넣어 적기, 예: 매월 10일)",
          allowed: `${PAYMENT_TERM_TEXT} (비우면 미지정)`,
          help: "29~31일은 ‘매월 말일’로 적어 주세요.",
          width: 12,
          textFormat: true,
        },
        {
          key: "creditLimit",
          header: "외상한도",
          aliases: ["외상(잔액) 한도", "외상 한도"],
          required: false,
          format: "무제한 / 외상 불가 / 금액(원)",
          allowed: `${CREDIT_LIMIT_TEXT} (비우면 무제한)`,
          help: "금액을 적으면 그 금액까지 외상(잔액)을 허용합니다. 0원도 됩니다.",
          width: 14,
          textFormat: false,
        },
        {
          key: "invoiceType",
          header: "계산서발행",
          aliases: ["계산서 발행"],
          required: false,
          format: "목록에 있는 값 하나",
          allowed: `${choiceLabels(INVOICE_CHOICES)} (비우면 월합계)`,
          help: "세금계산서 발행 방식.",
          width: 11,
          textFormat: true,
        },
        {
          key: "slipPrint",
          header: "전표인쇄",
          aliases: ["전표 인쇄"],
          required: false,
          format: "목록에 있는 값 하나",
          allowed: `${choiceLabels(SLIP_PRINT_CHOICES)} (비우면 금액 인쇄)`,
          help: "거래명세표에 금액을 인쇄할지.",
          width: 12,
          textFormat: true,
        },
        {
          key: "businessNumber",
          header: "사업자번호",
          aliases: ["사업자등록번호"],
          required: false,
          format: "숫자 10자리 (하이픈 있어도 없어도 됨, 예: 123-45-67890)",
          help: "사업자등록증의 번호(검증번호까지 확인합니다). 다른 거래처와 같아도 등록됩니다.",
          width: 15,
          textFormat: true,
        },
        {
          key: "companyName",
          header: "상호",
          aliases: ["상호(법인명)", "법인명"],
          required: false,
          format: text(PARTNER_LIMITS.companyNameMaxLength),
          help: "사업자등록증의 상호(법인명).",
          width: 18,
          textFormat: true,
        },
        {
          key: "representative",
          header: "대표자",
          aliases: ["대표자명"],
          required: false,
          format: text(PARTNER_LIMITS.representativeMaxLength),
          help: "사업자등록증의 대표자 이름.",
          width: 10,
          textFormat: true,
        },
        {
          key: "businessCategory",
          header: "업태",
          required: false,
          format: text(PARTNER_LIMITS.businessCategoryMaxLength),
          help: "사업자등록증의 업태. 예: 음식점업",
          width: 12,
          textFormat: true,
        },
        {
          key: "businessItem",
          header: "종목",
          required: false,
          format: text(PARTNER_LIMITS.businessItemMaxLength),
          help: "사업자등록증의 종목. 예: 한식",
          width: 12,
          textFormat: true,
        },
        {
          key: "postalCode",
          header: "사업장우편번호",
          aliases: ["사업장 우편번호"],
          required: false,
          format: "숫자 5자리",
          help: "사업장 주소의 우편번호. 사업장주소가 있어야 합니다.",
          width: 12,
          textFormat: true,
        },
        {
          key: "address",
          header: "사업장주소",
          aliases: ["사업장 주소"],
          required: false,
          format: text(PARTNER_LIMITS.addressMaxLength),
          help: "사업장 도로명 주소.",
          width: 30,
          textFormat: true,
        },
        {
          key: "addressDetail",
          header: "사업장상세주소",
          aliases: ["사업장 상세주소"],
          required: false,
          format: text(PARTNER_LIMITS.addressDetailMaxLength),
          help: "동·호수 등. 사업장주소가 있어야 합니다.",
          width: 20,
          textFormat: true,
        },
        {
          key: "taxEmail",
          header: "세금계산서이메일",
          aliases: ["세금계산서 이메일"],
          required: false,
          format: "이메일 주소 (예: tax@example.com)",
          help: "세금계산서를 받을 이메일.",
          width: 22,
          textFormat: true,
        },
        {
          key: "deliveryLabel",
          header: "배송지명",
          required: false,
          format: text(PARTNER_LIMITS.addressLabelMaxLength),
          help: "기본 배송지 이름. 배송지 칸을 채웠는데 비우면 ‘기본’이 됩니다.",
          width: 12,
          textFormat: true,
        },
        {
          key: "deliveryPostalCode",
          header: "배송지우편번호",
          aliases: ["배송지 우편번호"],
          required: false,
          format: "숫자 5자리",
          help: "기본 배송지의 우편번호.",
          width: 12,
          textFormat: true,
        },
        {
          key: "deliveryAddress",
          header: "배송지주소",
          aliases: ["배송지 주소"],
          required: false,
          format: text(PARTNER_LIMITS.addressMaxLength),
          help: "기본 배송지의 도로명 주소. 배송지 칸을 하나라도 채우면 꼭 적어야 합니다.",
          width: 30,
          textFormat: true,
        },
        {
          key: "deliveryAddressDetail",
          header: "배송지상세주소",
          aliases: ["배송지 상세주소"],
          required: false,
          format: text(PARTNER_LIMITS.addressDetailMaxLength),
          help: "동·호수, 주방 위치 등.",
          width: 20,
          textFormat: true,
        },
        {
          key: "recipient",
          header: "받는분",
          aliases: ["받는 분"],
          required: false,
          format: text(PARTNER_LIMITS.recipientMaxLength),
          help: "배송 물건을 받는 사람.",
          width: 10,
          textFormat: true,
        },
        {
          key: "deliveryPhone",
          header: "배송지연락처",
          aliases: ["배송지 연락처"],
          required: false,
          format: PHONE_FORMAT,
          help: "받는 분 연락처.",
          width: 15,
          textFormat: true,
        },
        {
          key: "deliveryMemo",
          header: "배송메모",
          aliases: ["배송 메모"],
          required: false,
          format: text(PARTNER_LIMITS.deliveryMemoMaxLength),
          help: "예: 오전 10시 전 납품, 뒷문",
          width: 20,
          textFormat: true,
        },
        {
          key: "contactName",
          header: "담당자명",
          required: false,
          format: text(PARTNER_LIMITS.contactNameMaxLength),
          help: "대표 담당자 이름. 담당자 칸을 하나라도 채우면 꼭 적어야 합니다.",
          width: 10,
          textFormat: true,
        },
        {
          key: "contactJobTitle",
          header: "담당자직책",
          aliases: ["담당자 직책", "담당자 부서/직책"],
          required: false,
          format: text(PARTNER_LIMITS.contactJobTitleMaxLength),
          help: "예: 주방 실장",
          width: 12,
          textFormat: true,
        },
        {
          key: "contactMobile",
          header: "담당자휴대폰",
          aliases: ["담당자 휴대폰"],
          required: false,
          format: PHONE_FORMAT,
          help: "대표 담당자 휴대폰 번호.",
          width: 15,
          textFormat: true,
        },
        {
          key: "contactEmail",
          header: "담당자이메일",
          aliases: ["담당자 이메일"],
          required: false,
          format: "이메일 주소",
          help: "대표 담당자 이메일.",
          width: 20,
          textFormat: true,
        },
        {
          key: "note",
          header: "특이사항",
          aliases: ["비고"],
          required: false,
          format: text(PARTNER_LIMITS.noteMaxLength),
          help: "메모.",
          width: 24,
          textFormat: true,
        },
        {
          key: "isActive",
          header: "사용여부",
          required: false,
          format: "사용 또는 미사용",
          allowed: `${choiceLabels(PARTNER_STATUS_CHOICES)} (비우면 사용)`,
          help: "미사용으로 등록하면 판매·구매에서 고를 수 없습니다.",
          width: 10,
          textFormat: true,
        },
      ],
      examples: [
        {
          code: "100101",
          name: "한우마을 본점",
          partnerType: "매출처",
          phone: "02-123-4567",
          industry: "한식",
          salesRep: "0002",
          deliveryRep: "0009",
          categoryMajor: "오프라인 거래처",
          categoryMiddle: "외식업",
          categoryMinor: "",
          paymentTerm: "매월 10일",
          creditLimit: 3000000,
          invoiceType: "월합계",
          slipPrint: "금액 인쇄",
          businessNumber: "123-45-67891",
          companyName: "(주)한우마을",
          representative: "김한우",
          businessCategory: "음식점업",
          businessItem: "한식",
          postalCode: "06236",
          address: "서울특별시 강남구 테헤란로 123",
          addressDetail: "1층",
          taxEmail: "tax@example.com",
          deliveryLabel: "본점 주방",
          deliveryPostalCode: "06236",
          deliveryAddress: "서울특별시 강남구 테헤란로 123",
          deliveryAddressDetail: "1층 주방 뒷문",
          recipient: "이주방",
          deliveryPhone: "010-1234-5678",
          deliveryMemo: "오전 10시 전 납품",
          contactName: "이주방",
          contactJobTitle: "주방 실장",
          contactMobile: "010-1234-5678",
          contactEmail: "kitchen@example.com",
          note: "",
          isActive: "사용",
        },
        {
          code: "200101",
          name: "싱싱농산",
          partnerType: "매입처",
          phone: "031-123-4567",
          industry: "식자재 도소매",
          salesRep: "",
          deliveryRep: "",
          categoryMajor: "",
          categoryMiddle: "",
          categoryMinor: "",
          paymentTerm: "건별 즉시",
          creditLimit: "외상 불가",
          invoiceType: "건별",
          slipPrint: "수량만 인쇄",
          businessNumber: "",
          companyName: "",
          representative: "",
          businessCategory: "",
          businessItem: "",
          postalCode: "",
          address: "",
          addressDetail: "",
          taxEmail: "",
          deliveryLabel: "",
          deliveryPostalCode: "",
          deliveryAddress: "",
          deliveryAddressDetail: "",
          recipient: "",
          deliveryPhone: "",
          deliveryMemo: "",
          contactName: "",
          contactJobTitle: "",
          contactMobile: "",
          contactEmail: "",
          note: "",
          isActive: "사용",
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

/** A partner already in the database (import_find_partners). */
export type ExistingPartner = {
  code: string
  name: string
  businessNumber: string | null
}

/** An employee already in the database (import_find_employees). */
export type ExistingEmployee = {
  code: string
  name: string
  isActive: boolean
  isSalesRep: boolean
  isDeliveryDriver: boolean
  /** 휴대폰번호1 (digits), for the 직원 일괄등록's "already registered?" note. */
  mobile?: string | null
}

/** What the database knows for the check. */
export type PartnerImportLookups = {
  /** Partners with a 거래처코드 or 사업자번호 the file uses. */
  partners: readonly ExistingPartner[]
  /**
   * Employees whose 직원코드 (ignoring case) or 직원명 is one the file
   * names as 영업담당 / 배송담당.
   */
  employees: readonly ExistingEmployee[]
  /** Every 거래처분류 (사용 and 사용 중지), as getPartnerCategoryTree returns it. */
  categories: readonly NamedCategoryNode[]
}

/** One 거래처 row for import_partners (database column names). */
export type PartnerImportRow = {
  excel_row: number
  partner_type: PartnerType
  code: string
  name: string
  phone: string | null
  industry: PartnerIndustry | null
  sales_rep_code: string | null
  delivery_rep_code: string | null
  category_path: string[] | null
  is_active: boolean
  payment_term: PaymentTerm
  payment_day: number | null
  credit_limit_type: CreditLimitType
  credit_limit: number | null
  invoice_type: InvoiceType
  slip_print: SlipPrintType
  business_number: string | null
  company_name: string | null
  representative: string | null
  business_category: string | null
  business_item: string | null
  postal_code: string | null
  address: string | null
  address_detail: string | null
  tax_email: string | null
  note: string | null
  contacts: {
    name: string
    job_title: string | null
    mobile: string | null
    phone: string | null
    email: string | null
    memo: string | null
    is_primary: boolean
  }[]
  addresses: {
    label: string
    postal_code: string | null
    address: string
    address_detail: string | null
    recipient: string | null
    phone: string | null
    memo: string | null
    is_default: boolean
  }[]
}

/** The arguments of the database function import_partners. */
export type PartnerImportPayload = {
  rows: PartnerImportRow[]
  create_missing_categories: boolean
}

/** Form field (path) → column key, for the zod messages. */
const PARTNER_FIELDS: Record<string, string> = {
  partnerType: "partnerType",
  code: "code",
  name: "name",
  phone: "phone",
  industry: "industry",
  isActive: "isActive",
  paymentTerm: "paymentTerm",
  paymentDay: "paymentTerm",
  creditLimitType: "creditLimit",
  creditLimit: "creditLimit",
  invoiceType: "invoiceType",
  slipPrint: "slipPrint",
  businessNumber: "businessNumber",
  companyName: "companyName",
  representative: "representative",
  businessCategory: "businessCategory",
  businessItem: "businessItem",
  postalCode: "postalCode",
  address: "address",
  addressDetail: "addressDetail",
  taxEmail: "taxEmail",
  note: "note",
  contacts: "contactName",
  "contacts.0.name": "contactName",
  "contacts.0.jobTitle": "contactJobTitle",
  "contacts.0.mobile": "contactMobile",
  "contacts.0.email": "contactEmail",
  addresses: "deliveryAddress",
  "addresses.0.label": "deliveryLabel",
  "addresses.0.postalCode": "deliveryPostalCode",
  "addresses.0.address": "deliveryAddress",
  "addresses.0.addressDetail": "deliveryAddressDetail",
  "addresses.0.recipient": "recipient",
  "addresses.0.phone": "deliveryPhone",
  "addresses.0.memo": "deliveryMemo",
  salesRepId: "salesRep",
  deliveryRepId: "deliveryRep",
  categoryId: "categoryMajor",
}

const CONTACT_KEYS = [
  "contactName",
  "contactJobTitle",
  "contactMobile",
  "contactEmail",
]
const ADDRESS_KEYS = [
  "deliveryLabel",
  "deliveryPostalCode",
  "deliveryAddress",
  "deliveryAddressDetail",
  "recipient",
  "deliveryPhone",
  "deliveryMemo",
]

/**
 * The codes the check needs from the database: every 거래처코드 and
 * 사업자번호 of the file, and the 영업담당 / 배송담당 직원코드 (for
 * import_find_partners and import_find_employees).
 */
export function partnerImportLookupKeys(input: ImportInput): {
  codes: string[]
  businessNumbers: string[]
  employeeCodes: string[]
} {
  const codes = new Set<string>()
  const businessNumbers = new Set<string>()
  const employeeCodes = new Set<string>()
  for (const row of input.sheets[MAIN_SHEET] ?? []) {
    const code = cellText(row.values.code)
    if (code !== "") codes.add(code)
    const digits = toBusinessNumberDigits(cellText(row.values.businessNumber))
    if (isValidBusinessNumber(digits)) businessNumbers.add(digits)
    for (const key of ["salesRep", "deliveryRep"]) {
      const employee = cellText(row.values[key])
      if (employee !== "") employeeCodes.add(employee)
      // Excel drops the leading zeros of a number cell (0002 → 2): look up
      // the 4-digit code too, so the message can name it.
      if (/^\d{1,3}$/.test(employee))
        employeeCodes.add(employee.padStart(4, "0"))
    }
  }
  return {
    codes: [...codes],
    businessNumbers: [...businessNumbers],
    employeeCodes: [...employeeCodes],
  }
}

type PartnerRowState = {
  raw: ImportRawRow
  issues: RowIssues
  code: string
  /** A valid 사업자번호 (10 digits) of the row, or null (for the warnings). */
  businessNumber: string | null
  categoryPath: string[] | null
  createdCategories: string[]
  row: PartnerImportRow | null
}

function anyFilled(
  values: Record<string, ImportCell>,
  keys: string[]
): boolean {
  return keys.some((key) => cellText(values[key]) !== "")
}

/** Checks one 거래처 row on its own (form rules, choices, 분류 names). */
function readPartnerRow(raw: ImportRawRow): PartnerRowState {
  const issues = new RowIssues()
  addCellFlags(issues, raw)
  const values = raw.values

  const partnerType = matchChoice(values.partnerType, PARTNER_TYPE_CHOICES)
  if (partnerType === null) {
    issues.error(
      "partnerType",
      `구분을 입력해 주세요. (${choiceLabels(PARTNER_TYPE_CHOICES)})`
    )
  }
  if (partnerType === undefined) {
    issues.error(
      "partnerType",
      `구분은 ${choiceLabels(PARTNER_TYPE_CHOICES)} 중 하나로 입력해 주세요.`
    )
  }
  const industry = matchChoice(values.industry, INDUSTRY_CHOICES)
  if (industry === undefined) {
    issues.error(
      "industry",
      `업종은 ${choiceLabels(INDUSTRY_CHOICES)} 중 하나로 입력해 주세요. (비우면 미지정)`
    )
  }
  const payment = parsePaymentTerm(values.paymentTerm)
  if (!payment) {
    issues.error(
      "paymentTerm",
      `결제일은 ${PAYMENT_TERM_TEXT} 중 하나로 입력해 주세요.`
    )
  }
  if (payment?.term === "monthly_day") {
    const day = Number(payment.day)
    if (!(
      day >= PARTNER_LIMITS.paymentDayMin && day <= PARTNER_LIMITS.paymentDayMax
    )) {
      issues.error(
        "paymentTerm",
        `결제일은 매월 ${PARTNER_LIMITS.paymentDayMin}~${PARTNER_LIMITS.paymentDayMax}일 중에서 적어 주세요. (29~31일은 ‘매월 말일’로 적어 주세요.)`
      )
    }
  }
  const credit = parseCreditLimit(values.creditLimit)
  if (!credit) {
    issues.error(
      "creditLimit",
      `외상한도는 ${CREDIT_LIMIT_TEXT}으로 입력해 주세요.`
    )
  } else if (
    credit.type === "limited" &&
    Number(credit.amount) > PARTNER_LIMITS.creditLimitMax
  ) {
    issues.error(
      "creditLimit",
      "외상 한도 금액은 100억 원 이하로 입력해 주세요."
    )
  }
  // (The form checks this only once every other field is fine; checked
  // here too, so a file shows all its problems at once.)
  if (
    cellText(values.address) === "" &&
    (cellText(values.postalCode) !== "" ||
      cellText(values.addressDetail) !== "")
  ) {
    issues.error(
      "address",
      "사업장주소를 입력해 주세요. (사업장우편번호나 사업장상세주소만 따로 등록할 수 없습니다.)"
    )
  }
  const invoiceType = matchChoice(values.invoiceType, INVOICE_CHOICES)
  if (invoiceType === undefined) {
    issues.error(
      "invoiceType",
      `계산서발행은 ${choiceLabels(INVOICE_CHOICES)} 중 하나로 입력해 주세요. (비우면 월합계)`
    )
  }
  const slipPrint = matchChoice(values.slipPrint, SLIP_PRINT_CHOICES)
  if (slipPrint === undefined) {
    issues.error(
      "slipPrint",
      `전표인쇄는 ${choiceLabels(SLIP_PRINT_CHOICES)} 중 하나로 입력해 주세요. (비우면 금액 인쇄)`
    )
  }
  const isActive = matchChoice(values.isActive, PARTNER_STATUS_CHOICES)
  if (isActive === undefined) {
    issues.error(
      "isActive",
      `사용여부는 ${choiceLabels(PARTNER_STATUS_CHOICES)} 중 하나로 입력해 주세요. (비우면 사용)`
    )
  }
  const categoryPath = readCategoryPath(
    values,
    {
      major: "categoryMajor",
      middle: "categoryMiddle",
      minor: "categoryMinor",
    },
    partnerCategoryNameSchema,
    issues
  )

  const hasContact = anyFilled(values, CONTACT_KEYS)
  const hasAddress = anyFilled(values, ADDRESS_KEYS)
  const parsed = partnerFormSchema.safeParse({
    partnerType: partnerType ?? "",
    code: cellText(values.code),
    name: cellText(values.name),
    phone: phoneText(values.phone),
    industry: industry ?? "",
    // 영업담당 / 배송담당 and 거래처분류 are checked by code / name below.
    salesRepId: "",
    deliveryRepId: "",
    categoryId: "",
    isActive: isActive ?? true,
    paymentTerm: payment?.term ?? "unspecified",
    paymentDay: payment?.day ?? "",
    creditLimitType: credit?.type ?? "unlimited",
    creditLimit: credit?.amount ?? "",
    invoiceType: invoiceType ?? "monthly",
    slipPrint: slipPrint ?? "with_amount",
    businessNumber: cellText(values.businessNumber),
    companyName: cellText(values.companyName),
    representative: cellText(values.representative),
    businessCategory: cellText(values.businessCategory),
    businessItem: cellText(values.businessItem),
    postalCode: postalCodeText(values.postalCode),
    address: cellText(values.address),
    addressDetail: cellText(values.addressDetail),
    taxEmail: cellText(values.taxEmail),
    contacts: hasContact
      ? [
          {
            id: "",
            name: cellText(values.contactName),
            jobTitle: cellText(values.contactJobTitle),
            mobile: phoneText(values.contactMobile),
            phone: "",
            email: cellText(values.contactEmail),
            memo: "",
            isPrimary: true,
          },
        ]
      : [],
    addresses: hasAddress
      ? [
          {
            id: "",
            label: cellText(values.deliveryLabel) || "기본",
            postalCode: postalCodeText(values.deliveryPostalCode),
            address: cellText(values.deliveryAddress),
            addressDetail: cellText(values.deliveryAddressDetail),
            recipient: cellText(values.recipient),
            phone: phoneText(values.deliveryPhone),
            memo: cellText(values.deliveryMemo),
            isDefault: true,
          },
        ]
      : [],
    note: cellText(values.note),
  })
  if (!parsed.success) addZodIssues(issues, parsed.error, PARTNER_FIELDS)

  const salesRepCode = cellText(values.salesRep)
  const deliveryRepCode = cellText(values.deliveryRep)
  const row: PartnerImportRow | null = parsed.success
    ? {
        excel_row: raw.excelRow,
        partner_type: parsed.data.partnerType,
        code: parsed.data.code,
        name: parsed.data.name,
        phone: parsed.data.phone,
        industry: parsed.data.industry,
        sales_rep_code: salesRepCode === "" ? null : salesRepCode,
        delivery_rep_code: deliveryRepCode === "" ? null : deliveryRepCode,
        category_path: categoryPath,
        is_active: parsed.data.isActive,
        payment_term: parsed.data.paymentTerm,
        payment_day: parsed.data.paymentDay,
        credit_limit_type: parsed.data.creditLimitType,
        credit_limit: parsed.data.creditLimit,
        invoice_type: parsed.data.invoiceType,
        slip_print: parsed.data.slipPrint,
        business_number: parsed.data.businessNumber,
        company_name: parsed.data.companyName,
        representative: parsed.data.representative,
        business_category: parsed.data.businessCategory,
        business_item: parsed.data.businessItem,
        postal_code: parsed.data.postalCode,
        address: parsed.data.address,
        address_detail: parsed.data.addressDetail,
        tax_email: parsed.data.taxEmail,
        note: parsed.data.note,
        contacts: parsed.data.contacts.map((contact) => ({
          name: contact.name,
          job_title: contact.jobTitle,
          mobile: contact.mobile,
          phone: contact.phone,
          email: contact.email,
          memo: contact.memo,
          is_primary: true,
        })),
        addresses: parsed.data.addresses.map((address) => ({
          label: address.label,
          postal_code: address.postalCode,
          address: address.address,
          address_detail: address.addressDetail,
          recipient: address.recipient,
          phone: address.phone,
          memo: address.memo,
          is_default: true,
        })),
      }
    : null

  const businessDigits = toBusinessNumberDigits(cellText(values.businessNumber))
  return {
    raw,
    issues,
    code: cellText(values.code),
    businessNumber: isValidBusinessNumber(businessDigits)
      ? businessDigits
      : null,
    categoryPath,
    createdCategories: [],
    row,
  }
}

/**
 * Checks the 영업담당 / 배송담당 직원코드 of a row: the employee exists
 * (직원코드 ignoring case), is 재직 and has the 담당업무. A 직원명 instead
 * of the code gets a hint with the code.
 */
function checkRep(
  state: PartnerRowState,
  column: "salesRep" | "deliveryRep",
  employees: readonly ExistingEmployee[]
): void {
  const code = cellText(state.raw.values[column])
  if (code === "") return
  const duty = column === "salesRep" ? "영업담당" : "배송담당"
  const employee = employees.find(
    (item) => codeKey(item.code) === codeKey(code)
  )
  if (!employee) {
    const byName = employees.filter((item) => item.name === code)
    const zeroPadded = /^\d{1,3}$/.test(code)
      ? employees.find((item) => item.code === code.padStart(4, "0"))
      : undefined
    state.issues.error(
      column,
      byName.length > 0
        ? `${duty}은(는) 직원코드로 적어 주세요. ‘${code}’의 직원코드: ${byName.map((item) => item.code).join(", ")}`
        : zeroPadded
          ? `${duty} 직원코드 ‘${code}’인 직원이 없습니다. ${zeroPadded.code} ${zeroPadded.name}을(를) 적으려던 것이면 엑셀이 앞의 0을 지운 것입니다: 칸 서식을 ‘텍스트’로 바꾸고 ${zeroPadded.code}(으)로 다시 입력해 주세요.`
          : `${duty} 직원코드 ‘${code}’인 직원이 없습니다. 직원관리에서 직원코드를 확인해 주세요.`
    )
    return
  }
  if (!employee.isActive) {
    state.issues.error(
      column,
      `${employee.code} ${employee.name}은(는) 퇴사한 직원이라 ${duty}으로 지정할 수 없습니다.`
    )
    return
  }
  const hasDuty =
    column === "salesRep" ? employee.isSalesRep : employee.isDeliveryDriver
  if (!hasDuty) {
    state.issues.error(
      column,
      `${employee.code} ${employee.name}은(는) 담당업무에 ‘${duty}’이 체크되어 있지 않습니다. 직원관리에서 담당업무를 확인해 주세요.`
    )
  }
}

/**
 * Checks every row of a 거래처 file and returns the 미리보기 and the 정상
 * rows for import_partners:
 * 1. each row on its own: the 거래처 등록 form's rules (거래처코드, 거래처명,
 *    phones, 사업자번호 검증번호, 이메일, 우편번호, 결제일 1–28, 외상 한도
 *    금액, 배송지주소 when any 배송지 cell is filled, 담당자명 when any
 *    담당자 cell is filled …) and the lists (구분, 업종, 계산서발행, 전표인쇄,
 *    사용여부);
 * 2. 거래처코드 used twice in the file (ignoring case) → error; the same
 *    사업자번호 twice → warning only;
 * 3. against the database: 거래처코드 already registered (error),
 *    사업자번호 of another partner (warning), 영업담당 / 배송담당 (exists,
 *    재직, 담당업무), 거래처분류 (사용 중지 → error; missing → created, or
 *    an error without "없는 분류는 자동으로 만들기").
 */
export function checkPartnerImport(
  input: ImportInput,
  lookups: PartnerImportLookups
): { preview: ImportPreview; payload: PartnerImportPayload } {
  const createMissing = input.createMissingCategories ?? true
  const rows = (input.sheets[MAIN_SHEET] ?? []).map(readPartnerRow)
  const placeOf = (state: PartnerRowState) => ({
    sheetLabel: null,
    excelRow: state.raw.excelRow,
  })

  for (const [state, others] of findDuplicates(
    rows,
    (state) => state.code,
    placeOf,
    codeKey
  )) {
    state.issues.error(
      "code",
      `파일 안에서 같은 거래처코드가 또 있습니다 (${placesText(others)}). 거래처코드는 대소문자를 구분하지 않습니다.`
    )
  }
  for (const [state, others] of findDuplicates(
    rows,
    (state) => state.businessNumber,
    placeOf
  )) {
    state.issues.warn(
      "businessNumber",
      `파일 안 ${placesText(others)}과(와) 사업자번호가 같습니다. (그래도 등록됩니다)`
    )
  }

  const savedByCode = new Map(
    lookups.partners.map((partner) => [codeKey(partner.code), partner])
  )
  const planner = new CategoryPlanner(lookups.categories, {
    createMissing,
    allowInactive: false,
    settingsName: "거래처분류설정",
    entityLabel: "거래처",
  })

  const results: ImportRowResult[] = []
  const payload: PartnerImportPayload = {
    rows: [],
    create_missing_categories: createMissing,
  }
  for (const state of rows) {
    const saved =
      state.code === "" ? undefined : savedByCode.get(codeKey(state.code))
    if (saved) {
      state.issues.error(
        "code",
        `이미 등록된 거래처코드입니다 (${saved.code} ${saved.name}). 일괄등록은 새 거래처만 등록합니다. 이미 있는 거래처는 거래처관리에서 수정해 주세요.`
      )
    }
    const businessNumber = state.businessNumber
    if (businessNumber) {
      const same = lookups.partners.filter(
        (partner) => partner.businessNumber === businessNumber
      )
      if (same.length > 0) {
        state.issues.warn(
          "businessNumber",
          `사업자번호가 같은 거래처가 이미 있습니다: ${same
            .slice(0, 3)
            .map((partner) => `${partner.code} ${partner.name}`)
            .join(
              ", "
            )}${same.length > 3 ? ` 외 ${same.length - 3}곳` : ""}. (그래도 등록됩니다)`
        )
      }
    }
    checkRep(state, "salesRep", lookups.employees)
    checkRep(state, "deliveryRep", lookups.employees)
    if (state.categoryPath !== null) {
      const result = planner.check(state.categoryPath)
      if (!result.ok) state.issues.error("categoryMajor", result.message)
      else state.createdCategories = result.created
    }

    const ok = !state.issues.hasErrors
    if (ok && state.categoryPath !== null) {
      planner.accept(state.categoryPath, state.raw.excelRow)
    }
    results.push({
      sheet: MAIN_SHEET,
      excelRow: state.raw.excelRow,
      status: ok ? "ok" : "error",
      errors: state.issues.errors,
      warnings: state.issues.warnings,
      note:
        ok && state.createdCategories.length > 0
          ? `새 분류 ${state.createdCategories.length}개`
          : null,
    })
    if (ok && state.row) payload.rows.push(state.row)
  }

  return { preview: buildPreview(results, planner.created), payload }
}
