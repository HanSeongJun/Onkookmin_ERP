/**
 * 재고관리 (inventory): fixed choices, input rules, the database's rule
 * keys and small calculations that the screens and the server share.
 *
 * The database is the source of truth (supabase/migrations/*_inventory.sql):
 * every rule here is checked again there. Rules that exist in both places
 * say so ("change both together").
 *
 * No server imports: Client Components use this file too.
 */

import { daysUntil, formatQuantity, type DateInput } from "@/lib/format"
import type { StorageType } from "@/lib/products/constants"
import type { Enums } from "@/types/database"

// ---------------------------------------------------------------------------
// 기한 종류 (소비기한 / 유통기한 / 없음)
// ---------------------------------------------------------------------------

/** Database value of 기한 종류: "use_by" | "sell_by" | "none". */
export type ExpiryKind = Enums<"expiry_kind">

/**
 * 기한 종류 choices, in display order. Most foods carry a 소비기한 since
 * 2023; some still a 유통기한; salt, rice, raw vegetables often none.
 */
export const EXPIRY_KINDS = [
  { value: "use_by", label: "소비기한" },
  { value: "sell_by", label: "유통기한" },
  { value: "none", label: "없음" },
] as const satisfies readonly { value: ExpiryKind; label: string }[]

/**
 * Korean label of a 기한 종류.
 * @example expiryKindLabel("sell_by") // "유통기한"
 */
export function expiryKindLabel(kind: ExpiryKind): string {
  return EXPIRY_KINDS.find((item) => item.value === kind)?.label ?? kind
}

// ---------------------------------------------------------------------------
// 기한 상태 (기한 경과 / 기한 임박)
// ---------------------------------------------------------------------------

/**
 * 기한 상태 of a lot, as the view lot_stock_items computes it
 * (`expiry_status`):
 * - "expired" 기한 경과: the 기한일 is before today (Korea);
 * - "imminent" 기한 임박: 0 to N days left (N = 기한 임박 기준일 setting);
 * - "ok": more days left; "none": the lot has no 기한.
 */
export type ExpiryStatus = "expired" | "imminent" | "ok" | "none"

/** Korean label of each 기한 상태. */
export const EXPIRY_STATUS_LABELS: Record<ExpiryStatus, string> = {
  expired: "기한 경과",
  imminent: "기한 임박",
  ok: "정상",
  none: "기한 없음",
}

/** Default of the 기한 임박 기준일 setting (app_settings.expiry_warning_days). */
export const DEFAULT_EXPIRY_WARNING_DAYS = 7

/** Largest 기한 임박 기준일 the setting accepts (the database checks 0–365). */
export const EXPIRY_WARNING_DAYS_MAX = 365

/**
 * The 기한 상태 of a 기한일 (same rule as the view lot_stock_items).
 * @param warningDays the 기한 임박 기준일 setting
 * @param today defaults to now (Korea)
 * @example expiryStatus("2026-10-25", 7, "2026-10-23") // "imminent"
 * @example expiryStatus("2026-10-22", 7, "2026-10-23") // "expired"
 */
export function expiryStatus(
  expiryDate: DateInput | null | undefined,
  warningDays: number,
  today?: DateInput
): ExpiryStatus {
  const days = daysUntil(expiryDate, today)
  if (days === null) return "none"
  if (days < 0) return "expired"
  if (days <= warningDays) return "imminent"
  return "ok"
}

/**
 * The D-day badge of a 기한일: "D-3", "D-Day", "D+2" (2 days past), or
 * "-" without a 기한. The badge color follows expiryStatus.
 * @example formatDaysLeft(3) // "D-3"
 * @example formatDaysLeft(-2) // "D+2"
 */
export function formatDaysLeft(daysLeft: number | null | undefined): string {
  if (daysLeft === null || daysLeft === undefined) return "-"
  if (daysLeft === 0) return "D-Day"
  return daysLeft > 0 ? `D-${daysLeft}` : `D+${-daysLeft}`
}

// ---------------------------------------------------------------------------
// 전표 일자: up to today + N days (예정 전표, 새벽배송)
// ---------------------------------------------------------------------------

/**
 * Default of the setting app_settings.future_doc_days: a 전표 may be dated
 * up to 7 days after today (새벽배송: tomorrow's 출고 is entered today).
 */
export const DEFAULT_FUTURE_DOC_DAYS = 7

/** Largest value of that setting (the database checks 0–30). */
export const FUTURE_DOC_DAYS_MAX = 30

/**
 * The calendar date `days` days after (or before, when negative) a
 * "YYYY-MM-DD" date.
 * @example shiftDate("2026-10-23", 7) // "2026-10-30"
 */
export function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/**
 * The latest date a new 전표 may have: today + the setting (same rule as
 * the database's stock_max_doc_date: change both together).
 * @example maxDocDate(7, "2026-10-23") // "2026-10-30"
 */
export function maxDocDate(futureDays: number, today: string): string {
  return shiftDate(today, futureDays)
}

/**
 * The hint under every 전표 date box.
 * @example docDateLimitHint(7, "2026-10-23") // "오늘 이후 7일(10-30)까지"
 * @example docDateLimitHint(0, "2026-10-23") // "오늘 이후는 안 됩니다"
 */
export function docDateLimitHint(futureDays: number, today: string): string {
  if (futureDays <= 0) return "오늘 이후는 안 됩니다"
  return `오늘 이후 ${futureDays}일(${maxDocDate(futureDays, today).slice(5)})까지`
}

/**
 * The error of a date after maxDocDate — the same text as the database's
 * stock_doc_date_limit_message (change both together). `subject` is the
 * field with its particle ("전표 일자는", "입고일은", "실사 일자는").
 * @example docDateLimitMessage(7, "2026-10-23") // "전표 일자는 오늘 이후 7일(2026-10-30)까지 정할 수 있습니다."
 */
export function docDateLimitMessage(
  futureDays: number,
  today: string,
  subject = "전표 일자는"
): string {
  if (futureDays <= 0) {
    return `${subject} 오늘(${today}) 이후로 정할 수 없습니다.`
  }
  return `${subject} 오늘 이후 ${futureDays}일(${maxDocDate(futureDays, today)})까지 정할 수 있습니다.`
}

/**
 * A 전표 dated after today is "예정" (scheduled; e.g. tomorrow's 새벽배송
 * 출고). Its stock is already counted in 재고처별 재고현황.
 * @example isScheduledDate("2026-10-24", "2026-10-23") // true
 */
export function isScheduledDate(
  date: string | null | undefined,
  today: string
): boolean {
  return !!date && date > today
}

/**
 * The dates a 취소 of a 전표 dated `originalDate` may have (same rule as
 * the database's reverse_stock_document): from that date to today + the
 * setting — or to the original date itself when that is later, so a 예정
 * 전표 can always be undone on its own date. The default is today, or the
 * original date of a 예정 전표.
 * @example reversalDateRange("2026-10-24", 7, "2026-10-23") // { min: "2026-10-24", max: "2026-10-30", defaultDate: "2026-10-24" }
 */
export function reversalDateRange(
  originalDate: string,
  futureDays: number,
  today: string
): { min: string; max: string; defaultDate: string } {
  const limit = maxDocDate(futureDays, today)
  return {
    min: originalDate,
    max: originalDate > limit ? originalDate : limit,
    defaultDate: originalDate > today ? originalDate : today,
  }
}

/**
 * "내일 이후" for today's 전표, else "10-25 이후" (the day after `date`):
 * the words of a 재고 부족 note about later 전표 (same as the database's
 * stock_shortage_notes).
 */
export function afterDateText(date: string, today: string): string {
  return date === today ? "내일 이후" : `${shiftDate(date, 1).slice(5)} 이후`
}

/**
 * The 기한일 worked out from 제조일자 and the product's 유통기한 기준일수
 * ("제조일로부터 N일"): the 제조일자 counts as day 1, so it is 제조일자 +
 * (N − 1) days. Null when either is missing. Same rule as the database's
 * stock_expiry_from_manufactured (the 입고 and 기초재고 functions use it
 * when the 기한일 is left empty): change both together.
 * @example suggestExpiryDate("2026-10-01", 10) // "2026-10-10"
 */
export function suggestExpiryDate(
  manufacturedDate: string | null | undefined,
  shelfLifeDays: number | null | undefined
): string | null {
  if (!manufacturedDate || !shelfLifeDays || shelfLifeDays < 1) return null
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(manufacturedDate)
  if (!match) return null
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  )
  if (Number.isNaN(date.getTime())) return null
  date.setUTCDate(date.getUTCDate() + shelfLifeDays - 1)
  return date.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// 전표 종류
// ---------------------------------------------------------------------------

/** Database value of 전표 종류, e.g. "receipt". */
export type StockDocumentType = Enums<"stock_document_type">

/**
 * 전표 종류 in display order, with the prefix of the 전표번호
 * (e.g. "입고-20261023-001", made by the database).
 */
export const STOCK_DOCUMENT_TYPES = [
  { value: "opening", label: "기초재고", prefix: "기초" },
  { value: "receipt", label: "입고", prefix: "입고" },
  { value: "issue", label: "출고", prefix: "출고" },
  { value: "disposal", label: "폐기", prefix: "폐기" },
  { value: "transfer", label: "이동", prefix: "이동" },
  { value: "count", label: "실사조정", prefix: "실사" },
  { value: "reversal", label: "취소", prefix: "취소" },
] as const satisfies readonly {
  value: StockDocumentType
  label: string
  prefix: string
}[]

/**
 * Korean label of a 전표 종류.
 * @example stockDocumentTypeLabel("count") // "실사조정"
 */
export function stockDocumentTypeLabel(type: StockDocumentType): string {
  return STOCK_DOCUMENT_TYPES.find((item) => item.value === type)?.label ?? type
}

/**
 * The 구분 of a ledger line (수불): its kind, and "…취소" for the line of
 * a 취소 전표 (movement_type is then the kind it undoes).
 * @example movementLabel("issue", true) // "출고취소"
 */
export function movementLabel(
  movementType: StockDocumentType,
  isReversal: boolean
): string {
  const label = stockDocumentTypeLabel(movementType)
  return isReversal ? `${label}취소` : label
}

// ---------------------------------------------------------------------------
// 폐기 사유
// ---------------------------------------------------------------------------

/** Database value of 폐기 사유. */
export type DisposalReason = Enums<"disposal_reason">

/** 폐기 사유 choices; "other" (기타) needs a memo. */
export const DISPOSAL_REASONS = [
  { value: "expired", label: "기한 경과" },
  { value: "damaged", label: "파손" },
  { value: "quality", label: "품질 불량" },
  { value: "other", label: "기타" },
] as const satisfies readonly { value: DisposalReason; label: string }[]

/** Korean label of a 폐기 사유, e.g. "파손". */
export function disposalReasonLabel(reason: DisposalReason): string {
  return DISPOSAL_REASONS.find((item) => item.value === reason)?.label ?? reason
}

// ---------------------------------------------------------------------------
// 창고 · 구역 · 위치
// ---------------------------------------------------------------------------

/**
 * Codes of 창고 / 구역 / 위치: letters, digits, Hangul, ".", "_", "-" (no
 * spaces), e.g. "W01", "B-02-R02", "기본". Same rule as the database's
 * is_stock_place_code: change both together.
 */
export const STOCK_PLACE_CODE_PATTERN = /^[0-9A-Za-z가-힣._-]+$/

/** Lengths of the 창고·구역·위치 fields (the database checks the same). */
export const STOCK_PLACE_LIMITS = {
  warehouseCodeMaxLength: 20,
  zoneCodeMaxLength: 20,
  locationCodeMaxLength: 30,
  nameMaxLength: 50,
  noteMaxLength: 500,
  addressMaxLength: 200,
  addressDetailMaxLength: 200,
} as const

/**
 * Code of the 위치 every 구역 gets automatically ("기본 위치"). It cannot
 * be deleted; 기초재고 rows without 선반코드 go there.
 */
export const DEFAULT_LOCATION_CODE = "기본"

/**
 * Where a lot is, as people read it: "본사 물류센터 > 냉장 B구역 > C-01-01".
 */
export function formatPlacePath(
  warehouseName: string,
  zoneName: string,
  locationCode?: string | null
): string {
  return [warehouseName, zoneName, locationCode]
    .filter((part): part is string => !!part)
    .join(" > ")
}

/**
 * Whether a lot's 보관온도 fits its 구역 (same rule as lot_stock_items):
 * `mismatch` when they differ; `tooWarm` when the 구역 is warmer than the
 * product needs (상온 < 냉장 < 냉동), the dangerous case (e.g. a 냉장
 * product in a 상온 구역).
 */
export function storageFit(
  productStorage: StorageType,
  zoneStorage: StorageType
): { mismatch: boolean; tooWarm: boolean } {
  const order: StorageType[] = ["room", "chilled", "frozen"]
  return {
    mismatch: productStorage !== zoneStorage,
    tooWarm: order.indexOf(zoneStorage) < order.indexOf(productStorage),
  }
}

// ---------------------------------------------------------------------------
// Quantities, costs, lines
// ---------------------------------------------------------------------------

/** Limits of the stock functions (the database checks the same). */
export const STOCK_LIMITS = {
  /** 로트번호 (unique per 상품). */
  lotNoMaxLength: 40,
  supplierLotNoMaxLength: 40,
  originMaxLength: 100,
  memoMaxLength: 500,
  /** Largest quantity of one line. */
  quantityMax: 100_000_000,
  /** Digits after the decimal point (kg, g, L, mL only). */
  quantityDecimals: 3,
  /** Largest 입고 단가 (부가세 포함, 원). */
  unitCostMax: 10_000_000_000,
  /** Lines of one 전표 (실사: lines + new lots together). */
  linesMax: 3000,
} as const

/**
 * Units whose quantities may have decimals: weight and volume. Every other
 * unit (개, 박스, 봉, 캔 …) counts whole pieces only. Same list as the
 * database's unit_allows_fraction: change both together.
 * @example unitAllowsFraction("KG") // true
 * @example unitAllowsFraction("박스") // false
 */
export function unitAllowsFraction(unit: string): boolean {
  return ["kg", "g", "l", "ml"].includes(unit.trim().toLowerCase())
}

/**
 * Checks a typed quantity ("1,234.5" or "12") for a product unit, as the
 * database does: a number with at most 3 decimals, at most 100,000,000,
 * above 0 (or 0 too with allowZero), whole for units other than kg/g/L/mL.
 * Returns the number, or a Korean message.
 * @example parseStockQuantity("2.5", "kg") // { ok: true, value: 2.5 }
 * @example parseStockQuantity("2.5", "박스") // { ok: false, message: "…정수로…" }
 */
export function parseStockQuantity(
  text: string,
  unit: string,
  options: { allowZero?: boolean; label?: string } = {}
): { ok: true; value: number } | { ok: false; message: string } {
  const label = options.label ?? "수량"
  const cleaned = text.replace(/,/g, "").trim()
  if (cleaned === "") return { ok: false, message: `${label}을 입력해 주세요.` }
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return { ok: false, message: `${label}은 0 이상의 숫자로 입력해 주세요.` }
  }
  const [, fraction = ""] = cleaned.split(".")
  if (fraction.replace(/0+$/, "").length > STOCK_LIMITS.quantityDecimals) {
    return {
      ok: false,
      message: `${label}은 소수점 아래 ${STOCK_LIMITS.quantityDecimals}자리까지 입력할 수 있습니다.`,
    }
  }
  const value = Number(cleaned)
  if (value === 0 && !options.allowZero) {
    return { ok: false, message: `${label}은 0보다 커야 합니다.` }
  }
  if (value > STOCK_LIMITS.quantityMax) {
    return {
      ok: false,
      message: `${label}은 100,000,000 이하로 입력해 주세요.`,
    }
  }
  if (!unitAllowsFraction(unit) && !Number.isInteger(value)) {
    return {
      ok: false,
      message: `${label}은 정수로 입력해 주세요. (kg·g·L·mL 단위 상품만 소수점을 쓸 수 있습니다.)`,
    }
  }
  return { ok: true, value }
}

/**
 * A quantity with its unit for the screens ("12.5 kg", "1,200 개"): up to
 * 3 decimals, as stored.
 */
export function formatStockQuantity(
  value: number | null | undefined,
  unit: string
): string {
  return formatQuantity(value, unit, STOCK_LIMITS.quantityDecimals)
}

/** One 기준상품 of a 묶음상품 for splitBundleUnitCost. */
export type BundleCostPart = {
  /** 구성 수량 per 1 unit of the 묶음상품. */
  quantityPerUnit: number
  /** The 기준상품's 기본 매입가 (부가세 포함), or null. */
  purchasePriceInclVat: number | null
}

/** round(amount × weight ÷ total), 0.5 up, with whole numbers only. */
function roundShare(amount: number, weight: number, total: number): number {
  const two = BigInt(2)
  const result =
    (two * BigInt(amount) * BigInt(weight) + BigInt(total)) /
    (two * BigInt(total))
  return Number(result)
}

/**
 * How a 묶음상품's 입고 단가 (부가세 포함, per 묶음상품) is shared by its
 * 기준상품, per unit of each 기준상품 (same rule as the database's
 * stock_bundle_components: change both together):
 * - "price_weight" when every 기준상품 has a 기본 매입가 and their sum is
 *   above 0: round(단가 × 기본 매입가 ÷ Σ(기본 매입가 × 구성 수량));
 * - "quantity" otherwise: every unit the same, round(단가 ÷ Σ 구성 수량).
 * 0.5 is rounded up. The shares are whole won, so Σ(share × 구성 수량) may
 * differ from the 단가 by a few won.
 * @example splitBundleUnitCost(552000, [{ quantityPerUnit: 24, purchasePriceInclVat: 23700 }])
 * // { rule: "price_weight", unitCosts: [23000] }
 */
export function splitBundleUnitCost(
  unitCostInclVat: number | null,
  parts: readonly BundleCostPart[]
): { rule: "price_weight" | "quantity"; unitCosts: (number | null)[] } {
  const priced = parts.every((part) => part.purchasePriceInclVat !== null)
  const totalWeight = parts.reduce(
    (sum, part) =>
      sum + (part.purchasePriceInclVat ?? 0) * part.quantityPerUnit,
    0
  )
  const rule = priced && totalWeight > 0 ? "price_weight" : "quantity"
  const quantityTotal = parts.reduce(
    (sum, part) => sum + part.quantityPerUnit,
    0
  )
  return {
    rule,
    unitCosts: parts.map((part) => {
      if (unitCostInclVat === null || quantityTotal <= 0) return null
      return rule === "price_weight"
        ? roundShare(
            unitCostInclVat,
            part.purchasePriceInclVat ?? 0,
            totalWeight
          )
        : roundShare(unitCostInclVat, 1, quantityTotal)
    }),
  }
}

// ---------------------------------------------------------------------------
// The database's rule keys
// ---------------------------------------------------------------------------

/**
 * HINT keys of the errors raised by the stock functions and triggers
 * (supabase/migrations/*_inventory.sql). Errors about one line also carry
 * DETAIL = JSON {"line" (1-based), "field" (the JSON key), "list" ("lines"
 * | "new_lots")}. Change both places together.
 */
export const INVENTORY_DB_RULES = {
  headerInvalid: "stock_header_invalid",
  linesInvalid: "stock_lines_invalid",
  linesEmpty: "stock_lines_empty",
  tooManyLines: "stock_too_many_lines",
  valueRequired: "stock_value_required",
  idInvalid: "stock_id_invalid",
  textInvalid: "stock_text_invalid",
  textTooLong: "stock_text_too_long",
  dateInvalid: "stock_date_invalid",
  docDateFuture: "stock_doc_date_future",
  amountInvalid: "stock_amount_invalid",
  quantityRequired: "stock_quantity_required",
  quantityInvalid: "stock_quantity_invalid",
  quantityNotPositive: "stock_quantity_not_positive",
  quantityTooPrecise: "stock_quantity_too_precise",
  quantityTooLarge: "stock_quantity_too_large",
  quantityNotWhole: "stock_quantity_not_whole",
  productNotFound: "stock_product_not_found",
  productInactive: "stock_product_inactive",
  productNotBase: "stock_product_not_base",
  partnerNotFound: "stock_partner_not_found",
  partnerInactive: "stock_partner_inactive",
  partnerNotSupplier: "stock_partner_not_supplier",
  locationNotFound: "stock_location_not_found",
  locationInactive: "stock_location_inactive",
  locationSame: "stock_location_same",
  locationDefaultFixed: "stock_location_default_fixed",
  placeMoveRefused: "stock_place_move_refused",
  expiryKindInvalid: "stock_expiry_kind_invalid",
  expiryDateRequired: "stock_expiry_date_required",
  expiryDateUnexpected: "stock_expiry_date_unexpected",
  expiryBeforeManufactured: "stock_expiry_before_manufactured",
  manufacturedAfterReceipt: "stock_manufactured_after_receipt",
  receivedAfterOpening: "stock_received_after_opening",
  lotNotFound: "stock_lot_not_found",
  lotNoDuplicate: "stock_lot_no_duplicate",
  insufficient: "stock_insufficient",
  historyNegative: "stock_history_negative",
  dateBeforeReceipt: "stock_date_before_receipt",
  reasonRequired: "stock_reason_required",
  reasonInvalid: "stock_reason_invalid",
  reasonMemoRequired: "stock_reason_memo_required",
  countChanged: "stock_count_changed",
  countNoDifference: "stock_count_no_difference",
  countScopeRequired: "stock_count_scope_required",
  countScopeTooLarge: "stock_count_scope_too_large",
  lineDuplicate: "stock_line_duplicate",
  documentNotFound: "stock_document_not_found",
  documentAlreadyReversed: "stock_document_already_reversed",
  reversalOfReversal: "stock_reversal_of_reversal",
  reversalDateInvalid: "stock_reversal_date_invalid",
  reversalInsufficient: "stock_reversal_insufficient",
  periodInvalid: "stock_period_invalid",
  ledgerAppendOnly: "stock_ledger_append_only",
} as const

/**
 * Constraint names a Server Action turns into a field error (unique and
 * foreign-key violations carry no HINT; the name is in the message).
 */
export const INVENTORY_DB_CONSTRAINTS = {
  warehouseCodeUnique: "warehouses_code_lower_key",
  zoneCodeUnique: "warehouse_zones_code_lower_key",
  locationCodeUnique: "storage_locations_code_lower_key",
  /** 로트번호 used twice for one 상품 at the same moment. */
  lotNoUnique: "stock_lots_product_lot_no_key",
  /** The same save (request_id) arrived twice at the same moment. */
  requestUnique: "stock_documents_request_id_key",
  /** Last guard against negative stock. */
  balanceNotNegative: "stock_balances_quantity_check",
  /** A 위치 with stock history cannot be deleted. */
  balanceLocation: "stock_balances_location_id_fkey",
  movementLocation: "stock_movements_location_id_fkey",
} as const
