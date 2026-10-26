/**
 * 재고관리 (inventory): the forms' zod schemas and the screens' URL
 * parameters, shared by the browser and the server.
 *
 * Forms (inputs are what the form holds — text boxes are strings — and the
 * outputs are ready for the Server Actions in `@/lib/inventory/actions`):
 * - 창고·로케이션 설정: warehouseFormSchema, zoneFormSchema,
 *   locationFormSchema, inventorySettingsSchema;
 * - 전표: receiptFormSchema (입고), issueFormSchema (출고),
 *   disposalFormSchema (폐기), transferFormSchema (이동), countFormSchema
 *   (실사조정), reversalFormSchema (취소).
 * Every 전표 form carries a `requestId` (crypto.randomUUID(), made once when
 * the modal opens): the database saves the same request only once, so a
 * retry after a network error never makes a second 전표.
 *
 * Errors of the Server Actions are keyed by react-hook-form paths:
 * "docDate", "partnerId", "memo", "lines.0.quantity", "newLots.1.expiryDate".
 *
 * URL parameters: 상품별 재고현황 (/inventory), 재고처별 재고현황
 * (/inventory/locations), 상품별 거래수불 (/inventory/ledger), the 전표
 * lists (/inventory/receipts …) and their modal (?modal=new,
 * ?modal=view&id=<uuid>).
 *
 * No server imports here.
 */

import { z } from "zod"

import { formatDate } from "@/lib/format"
import {
  DISPOSAL_REASONS,
  EXPIRY_KINDS,
  EXPIRY_WARNING_DAYS_MAX,
  FUTURE_DOC_DAYS_MAX,
  STOCK_LIMITS,
  STOCK_PLACE_CODE_PATTERN,
  STOCK_PLACE_LIMITS,
  docDateLimitMessage,
  maxDocDate,
  parseStockQuantity,
  shiftDate,
  type DisposalReason,
  type ExpiryKind,
  type ExpiryStatus,
  type StockDocumentType,
} from "@/lib/inventory/constants"
import { STORAGE_TYPES, TAX_TYPES } from "@/lib/products/constants"
import type { StorageType, TaxType } from "@/lib/products/constants"
import { isUuid } from "@/lib/products/schema"

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Today in Korea as "YYYY-MM-DD". */
export function todayInKorea(): string {
  return formatDate(new Date())
}

/** The first day of this month in Korea as "YYYY-MM-DD". */
export function firstDayOfMonthInKorea(): string {
  return `${todayInKorea().slice(0, 8)}01`
}

/** "YYYY-MM-DD" that exists in the calendar (2000–2099). */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  if (year < 2000 || year > 2099) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const text = (message: string) => z.string({ error: message })

/** Optional text: trimmed (NFC), empty → null, at most `max` characters. */
function optionalText(max: number, label: string) {
  return text(`${label}을(를) 확인해 주세요.`)
    .transform((value) => value.normalize("NFC").trim())
    .refine((value) => value.length <= max, {
      error: `${label}은(는) ${max.toLocaleString("ko-KR")}자 이하로 입력해 주세요.`,
    })
    .transform((value) => (value === "" ? null : value))
}

/** Required text: trimmed (NFC), 1 to `max` characters. */
function requiredText(max: number, label: string) {
  return text(`${label}을(를) 입력해 주세요.`)
    .transform((value) => value.normalize("NFC").trim())
    .refine((value) => value !== "", { error: `${label}을(를) 입력해 주세요.` })
    .refine((value) => value.length <= max, {
      error: `${label}은(는) ${max}자 이하로 입력해 주세요.`,
    })
}

/** A required id of a picked row (lowercased UUID). */
function requiredId(message: string) {
  return text(message)
    .refine((value) => isUuid(value), { error: message })
    .transform((value) => value.toLowerCase())
}

/** An optional id of a picked row: "" → null. */
function optionalId(message: string) {
  return text(message)
    .refine((value) => value === "" || isUuid(value), { error: message })
    .transform((value) => (value === "" ? null : value.toLowerCase()))
}

/** An optional date "YYYY-MM-DD": "" → null. */
function optionalDate(label: string) {
  return text(`${label}을(를) 확인해 주세요.`)
    .transform((value) => value.trim())
    .refine((value) => value === "" || isCalendarDate(value), {
      error: `${label}을(를) 날짜(예: 2026-10-23)로 입력해 주세요.`,
    })
    .transform((value) => (value === "" ? null : value))
}

/**
 * The 전표 일자: "" → null (= today, set by the database); at most today +
 * `futureDays` (the 재고 설정 "오늘 이후 N일까지"; 예정 전표 such as
 * tomorrow's 새벽배송 출고). The screens pass the setting; the Server
 * Actions use FUTURE_DOC_DAYS_MAX and the database checks the setting.
 */
function docDateField(futureDays: number) {
  return optionalDate("전표 일자").superRefine((value, ctx) => {
    if (value === null) return
    const today = todayInKorea()
    if (value > maxDocDate(futureDays, today)) {
      ctx.addIssue({
        code: "custom",
        message: docDateLimitMessage(futureDays, today),
      })
    }
  })
}

/** The save request id (a UUID made when the modal opens), or null. */
const requestIdField = text("저장 요청 번호가 올바르지 않습니다.")
  .refine((value) => value === "" || isUuid(value), {
    error: "저장 요청 번호가 올바르지 않습니다. 창을 닫고 다시 열어 주세요.",
  })
  .transform((value) => (value === "" ? null : value.toLowerCase()))

/**
 * A typed quantity ("1,234.5") → its digits ("1234.5"), sent as text so no
 * decimal is ever changed on the way. `unit` (optional, from the picked
 * product) adds the whole-number rule for 개, 박스 … (the database checks
 * it again with the product's real unit).
 */
function quantityField(label: string, options: { allowZero?: boolean } = {}) {
  return text(`${label}을(를) 입력해 주세요.`).transform((value, ctx) => {
    const parsed = parseStockQuantity(value, "kg", {
      allowZero: options.allowZero,
      label,
    })
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message: parsed.message })
      return z.NEVER
    }
    return value.replace(/,/g, "").trim()
  })
}

/** Optional 입고 단가 (부가세 포함, 원): "12,000" → 12000; "" → null. */
const unitCostField = text("입고단가를 확인해 주세요.").transform(
  (value, ctx) => {
    const digits = value.replace(/[,\s원₩]/g, "")
    if (digits === "") return null
    if (
      !/^\d{1,11}$/.test(digits) ||
      Number(digits) > STOCK_LIMITS.unitCostMax
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "입고단가는 0원 이상 100억 원 이하의 정수(원 단위)로 입력해 주세요.",
      })
      return z.NEVER
    }
    return Number(digits)
  }
)

const EXPIRY_KIND_VALUES = EXPIRY_KINDS.map((kind) => kind.value)
const DISPOSAL_REASON_VALUES = DISPOSAL_REASONS.map((reason) => reason.value)

/** The whole-number rule needs the product's unit: checked per line. */
function checkLineUnit(
  ctx: z.RefinementCtx,
  quantity: string,
  unit: string | undefined,
  path: (string | number)[],
  label: string,
  allowZero = false
) {
  if (!unit) return
  const parsed = parseStockQuantity(quantity, unit, { allowZero, label })
  if (!parsed.ok)
    ctx.addIssue({ code: "custom", message: parsed.message, path })
}

// ---------------------------------------------------------------------------
// 창고 · 구역 · 위치 · 설정
// ---------------------------------------------------------------------------

function placeCode(max: number, label: string) {
  return requiredText(max, label).refine(
    (value) => STOCK_PLACE_CODE_PATTERN.test(value),
    {
      error: `${label}는 영문, 숫자, 한글, 하이픈(-), 밑줄(_), 마침표(.)만 쓸 수 있습니다. (띄어쓰기 불가)`,
    }
  )
}

/** 창고 등록/수정. */
export const warehouseFormSchema = z
  .object({
    code: placeCode(STOCK_PLACE_LIMITS.warehouseCodeMaxLength, "창고코드"),
    name: requiredText(STOCK_PLACE_LIMITS.nameMaxLength, "창고명"),
    postalCode: text("우편번호를 확인해 주세요.")
      .transform((value) => value.trim())
      .refine((value) => value === "" || /^\d{5}$/.test(value), {
        error: "우편번호는 숫자 5자리로 입력해 주세요.",
      })
      .transform((value) => (value === "" ? null : value)),
    address: optionalText(STOCK_PLACE_LIMITS.addressMaxLength, "주소"),
    addressDetail: optionalText(
      STOCK_PLACE_LIMITS.addressDetailMaxLength,
      "상세주소"
    ),
    note: optionalText(STOCK_PLACE_LIMITS.noteMaxLength, "메모"),
    isActive: z.boolean({ error: "사용 여부를 선택해 주세요." }),
  })
  .superRefine((values, ctx) => {
    if (!values.address && (values.postalCode || values.addressDetail)) {
      ctx.addIssue({
        code: "custom",
        path: ["address"],
        message:
          "주소를 입력해 주세요. (우편번호나 상세주소만 따로 등록할 수 없습니다.)",
      })
    }
  })

export type WarehouseFormInput = z.input<typeof warehouseFormSchema>
export type WarehouseFormValues = z.output<typeof warehouseFormSchema>

export const emptyWarehouseFormInput: WarehouseFormInput = {
  code: "",
  name: "",
  postalCode: "",
  address: "",
  addressDetail: "",
  note: "",
  isActive: true,
}

const STORAGE_TYPE_VALUES = STORAGE_TYPES.map((type) => type.value)

/** 구역 등록/수정 (a new 구역 gets its "기본" 위치 automatically). */
export const zoneFormSchema = z.object({
  /** 창고 (fixed after 등록: a 구역 never moves to another 창고). */
  warehouseId: requiredId("창고를 선택해 주세요."),
  code: placeCode(STOCK_PLACE_LIMITS.zoneCodeMaxLength, "구역코드"),
  name: requiredText(STOCK_PLACE_LIMITS.nameMaxLength, "구역명"),
  storageType: z.enum(STORAGE_TYPE_VALUES as [StorageType, ...StorageType[]], {
    error: "보관온도(상온/냉장/냉동)를 선택해 주세요.",
  }),
  note: optionalText(STOCK_PLACE_LIMITS.noteMaxLength, "메모"),
  isActive: z.boolean({ error: "사용 여부를 선택해 주세요." }),
})

export type ZoneFormInput = z.input<typeof zoneFormSchema>
export type ZoneFormValues = z.output<typeof zoneFormSchema>

/** 위치(선반) 등록/수정. */
export const locationFormSchema = z.object({
  /** 구역 (fixed after 등록). */
  zoneId: requiredId("구역을 선택해 주세요."),
  code: placeCode(STOCK_PLACE_LIMITS.locationCodeMaxLength, "위치코드"),
  name: optionalText(STOCK_PLACE_LIMITS.nameMaxLength, "위치 이름"),
  isActive: z.boolean({ error: "사용 여부를 선택해 주세요." }),
})

export type LocationFormInput = z.input<typeof locationFormSchema>
export type LocationFormValues = z.output<typeof locationFormSchema>

/** A whole number of days 0–max typed as "7" or "7일". */
function daysField(label: string, max: number) {
  return text(`${label}을(를) 입력해 주세요.`).transform((value, ctx) => {
    const digits = value.replace(/일$/, "").trim()
    if (!/^\d{1,3}$/.test(digits) || Number(digits) > max) {
      ctx.addIssue({
        code: "custom",
        message: `${label}은(는) 0~${max}일로 입력해 주세요.`,
      })
      return z.NEVER
    }
    return Number(digits)
  })
}

/**
 * 재고 설정 (each field optional: only the ones sent are saved):
 * - expiryWarningDays: 기한 임박 기준일 (0–365일);
 * - futureDocDays: 전표 일자를 오늘 이후 며칠까지 (0–30일).
 */
export const inventorySettingsSchema = z
  .object({
    expiryWarningDays: daysField(
      "기한 임박 기준일",
      EXPIRY_WARNING_DAYS_MAX
    ).optional(),
    futureDocDays: daysField(
      "전표 일자 허용 일수",
      FUTURE_DOC_DAYS_MAX
    ).optional(),
  })
  .refine(
    (values) =>
      values.expiryWarningDays !== undefined ||
      values.futureDocDays !== undefined,
    { error: "저장할 설정이 없습니다." }
  )

export type InventorySettingsInput = z.input<typeof inventorySettingsSchema>

// ---------------------------------------------------------------------------
// 입고 등록
// ---------------------------------------------------------------------------

/** One 입고 line: a new lot of a 기준상품 (a 묶음상품 is split by its 구성표). */
const receiptLineSchema = z
  .object({
    productId: requiredId("상품을 선택해 주세요."),
    /** The picked product's 단위 (for the whole-number rule), optional. */
    unit: z.string().optional(),
    quantity: quantityField("수량"),
    locationId: requiredId("위치를 선택해 주세요."),
    expiryKind: text("기한 종류를 선택해 주세요.").refine(
      (value) => (EXPIRY_KIND_VALUES as string[]).includes(value),
      { error: "기한 종류(소비기한/유통기한/없음)를 선택해 주세요." }
    ),
    /** Empty: the database works it out from 제조일자 + 유통기한 기준일수. */
    expiryDate: optionalDate("기한일"),
    manufacturedDate: optionalDate("제조일자"),
    /** Empty: automatic (L + 전표 일자 + 일련번호). */
    lotNo: optionalText(STOCK_LIMITS.lotNoMaxLength, "로트번호"),
    supplierLotNo: optionalText(
      STOCK_LIMITS.supplierLotNoMaxLength,
      "공급처 로트번호"
    ),
    /** 부가세 포함, per unit of the line's product (per 묶음상품 for a 묶음상품). */
    unitCostInclVat: unitCostField,
    origin: optionalText(STOCK_LIMITS.originMaxLength, "원산지"),
    memo: optionalText(STOCK_LIMITS.memoMaxLength, "메모"),
  })
  .superRefine((line, ctx) => {
    checkLineUnit(ctx, line.quantity, line.unit, ["quantity"], "수량")
    if (line.expiryKind === "none" && line.expiryDate) {
      ctx.addIssue({
        code: "custom",
        path: ["expiryDate"],
        message: "기한 종류가 ‘없음’이면 기한일을 비워 주세요.",
      })
    }
    if (
      line.manufacturedDate &&
      line.expiryDate &&
      line.expiryDate < line.manufacturedDate
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["expiryDate"],
        message: "기한일은 제조일자보다 빠를 수 없습니다.",
      })
    }
  })

function linesField<T extends z.ZodType>(line: T, label: string, min = 1) {
  return z
    .array(line, { error: `${label}을(를) 다시 확인해 주세요.` })
    .min(min, { error: `${label}을(를) 1줄 이상 넣어 주세요.` })
    .max(STOCK_LIMITS.linesMax, {
      error: `전표 하나에 ${STOCK_LIMITS.linesMax.toLocaleString("ko-KR")}줄까지 넣을 수 있습니다.`,
    })
}

/** 입고 등록 (`futureDays`: the 재고 설정, see docDateField). */
export function makeReceiptFormSchema(
  futureDays: number = FUTURE_DOC_DAYS_MAX
) {
  return z
    .object({
      requestId: requestIdField,
      docDate: docDateField(futureDays),
      /** 매입처 (매입처 or 매출·매입 거래처), optional. */
      partnerId: optionalId("매입처를 다시 선택해 주세요."),
      memo: optionalText(STOCK_LIMITS.memoMaxLength, "메모"),
      lines: linesField(receiptLineSchema, "입고할 상품"),
    })
    .superRefine((values, ctx) => {
      const date = values.docDate ?? todayInKorea()
      values.lines.forEach((line, index) => {
        if (line.manufacturedDate && line.manufacturedDate > date) {
          ctx.addIssue({
            code: "custom",
            path: ["lines", index, "manufacturedDate"],
            message: `제조일자는 입고일(${date})보다 늦을 수 없습니다.`,
          })
        }
      })
    })
}

export const receiptFormSchema = makeReceiptFormSchema()

export type ReceiptFormInput = z.input<typeof receiptFormSchema>
export type ReceiptFormValues = z.output<typeof receiptFormSchema>
export type ReceiptLineInput = ReceiptFormInput["lines"][number]

/** An empty 입고 line (기한 종류 소비기한, the most common). */
export function emptyReceiptLineInput(): ReceiptLineInput {
  return {
    productId: "",
    unit: "",
    quantity: "",
    locationId: "",
    expiryKind: "use_by",
    expiryDate: "",
    manufacturedDate: "",
    lotNo: "",
    supplierLotNo: "",
    unitCostInclVat: "",
    origin: "",
    memo: "",
  }
}

// ---------------------------------------------------------------------------
// 출고 등록
// ---------------------------------------------------------------------------

/**
 * One 출고 line: a 기준상품 or 묶음상품 and how many; the lots are chosen by
 * FEFO. Optionally only stock in one 창고 / 구역 / 위치.
 */
const issueLineSchema = z
  .object({
    productId: requiredId("상품을 선택해 주세요."),
    unit: z.string().optional(),
    quantity: quantityField("수량"),
    warehouseId: optionalId("창고를 다시 선택해 주세요."),
    zoneId: optionalId("구역을 다시 선택해 주세요."),
    locationId: optionalId("위치를 다시 선택해 주세요."),
    memo: optionalText(STOCK_LIMITS.memoMaxLength, "메모"),
  })
  .superRefine((line, ctx) => {
    checkLineUnit(ctx, line.quantity, line.unit, ["quantity"], "수량")
  })

/** 출고 등록 (`futureDays`: the 재고 설정, see docDateField). */
export function makeIssueFormSchema(futureDays: number = FUTURE_DOC_DAYS_MAX) {
  return z.object({
    requestId: requestIdField,
    docDate: docDateField(futureDays),
    /** 거래처 (any 사용 거래처: 매출처, or a 매입처 for 반품), optional. */
    partnerId: optionalId("거래처를 다시 선택해 주세요."),
    memo: optionalText(STOCK_LIMITS.memoMaxLength, "메모"),
    lines: linesField(issueLineSchema, "출고할 상품"),
  })
}

export const issueFormSchema = makeIssueFormSchema()

export type IssueFormInput = z.input<typeof issueFormSchema>
export type IssueFormValues = z.output<typeof issueFormSchema>
export type IssueLineInput = IssueFormInput["lines"][number]

export function emptyIssueLineInput(): IssueLineInput {
  return {
    productId: "",
    unit: "",
    quantity: "",
    warehouseId: "",
    zoneId: "",
    locationId: "",
    memo: "",
  }
}

// ---------------------------------------------------------------------------
// 폐기 등록
// ---------------------------------------------------------------------------

const disposalLineSchema = z
  .object({
    lotId: requiredId("로트를 선택해 주세요."),
    locationId: requiredId("위치를 선택해 주세요."),
    unit: z.string().optional(),
    quantity: quantityField("폐기 수량"),
    reason: text("폐기 사유를 골라 주세요.").refine(
      (value) => (DISPOSAL_REASON_VALUES as string[]).includes(value),
      { error: "폐기 사유를 골라 주세요." }
    ),
    memo: optionalText(STOCK_LIMITS.memoMaxLength, "메모"),
  })
  .superRefine((line, ctx) => {
    checkLineUnit(ctx, line.quantity, line.unit, ["quantity"], "폐기 수량")
    if (line.reason === "other" && !line.memo) {
      ctx.addIssue({
        code: "custom",
        path: ["memo"],
        message: "폐기 사유가 ‘기타’이면 메모에 사유를 적어 주세요.",
      })
    }
  })

/** 폐기 등록 (`futureDays`: the 재고 설정, see docDateField). */
export function makeDisposalFormSchema(
  futureDays: number = FUTURE_DOC_DAYS_MAX
) {
  return z.object({
    requestId: requestIdField,
    docDate: docDateField(futureDays),
    memo: optionalText(STOCK_LIMITS.memoMaxLength, "메모"),
    lines: linesField(disposalLineSchema, "폐기할 재고"),
  })
}

export const disposalFormSchema = makeDisposalFormSchema()

export type DisposalFormInput = z.input<typeof disposalFormSchema>
export type DisposalFormValues = z.output<typeof disposalFormSchema>
export type DisposalLineInput = DisposalFormInput["lines"][number]

// ---------------------------------------------------------------------------
// 재고처간 이동 등록
// ---------------------------------------------------------------------------

const transferLineSchema = z
  .object({
    lotId: requiredId("로트를 선택해 주세요."),
    fromLocationId: requiredId("보내는 위치를 선택해 주세요."),
    toLocationId: requiredId("받는 위치를 선택해 주세요."),
    unit: z.string().optional(),
    quantity: quantityField("이동 수량"),
    memo: optionalText(STOCK_LIMITS.memoMaxLength, "메모"),
  })
  .superRefine((line, ctx) => {
    checkLineUnit(ctx, line.quantity, line.unit, ["quantity"], "이동 수량")
    if (line.fromLocationId === line.toLocationId) {
      ctx.addIssue({
        code: "custom",
        path: ["toLocationId"],
        message:
          "보내는 위치와 받는 위치가 같습니다. 받는 위치를 다시 골라 주세요.",
      })
    }
  })

/** 재고처간 이동 등록 (`futureDays`: the 재고 설정, see docDateField). */
export function makeTransferFormSchema(
  futureDays: number = FUTURE_DOC_DAYS_MAX
) {
  return z.object({
    requestId: requestIdField,
    docDate: docDateField(futureDays),
    memo: optionalText(STOCK_LIMITS.memoMaxLength, "메모"),
    lines: linesField(transferLineSchema, "이동할 재고"),
  })
}

export const transferFormSchema = makeTransferFormSchema()

export type TransferFormInput = z.input<typeof transferFormSchema>
export type TransferFormValues = z.output<typeof transferFormSchema>
export type TransferLineInput = TransferFormInput["lines"][number]

// ---------------------------------------------------------------------------
// 실사재고조정
// ---------------------------------------------------------------------------

/**
 * One counted line of the 실사 목록. countedQuantity "" = not counted
 * (left unchanged, not sent). systemQuantity is the quantity the 실사 목록
 * showed: when the stock changed since, the database refuses the count.
 */
const countLineSchema = z
  .object({
    lotId: requiredId("로트를 다시 불러와 주세요."),
    locationId: requiredId("위치를 다시 불러와 주세요."),
    unit: z.string().optional(),
    systemQuantity: quantityField("전산 수량", { allowZero: true }),
    countedQuantity: text("실사 수량을 확인해 주세요."),
    memo: optionalText(STOCK_LIMITS.memoMaxLength, "메모"),
  })
  .superRefine((line, ctx) => {
    if (line.countedQuantity.trim() === "") return
    const parsed = parseStockQuantity(line.countedQuantity, line.unit ?? "kg", {
      allowZero: true,
      label: "실사 수량",
    })
    if (!parsed.ok) {
      ctx.addIssue({
        code: "custom",
        path: ["countedQuantity"],
        message: parsed.message,
      })
    }
  })
  .transform((line) => ({
    ...line,
    countedQuantity:
      line.countedQuantity.trim() === ""
        ? null
        : line.countedQuantity.replace(/,/g, "").trim(),
  }))

/** Stock found that has no lot yet (a new lot, 입고일 = the 실사 date). */
const countNewLotSchema = z
  .object({
    productId: requiredId("상품을 선택해 주세요."),
    unit: z.string().optional(),
    locationId: requiredId("위치를 선택해 주세요."),
    quantity: quantityField("수량"),
    expiryKind: text("기한 종류를 선택해 주세요.").refine(
      (value) => (EXPIRY_KIND_VALUES as string[]).includes(value),
      { error: "기한 종류(소비기한/유통기한/없음)를 선택해 주세요." }
    ),
    expiryDate: optionalDate("기한일"),
    manufacturedDate: optionalDate("제조일자"),
    lotNo: optionalText(STOCK_LIMITS.lotNoMaxLength, "로트번호"),
    unitCostInclVat: unitCostField,
    memo: optionalText(STOCK_LIMITS.memoMaxLength, "메모"),
  })
  .superRefine((line, ctx) => {
    checkLineUnit(ctx, line.quantity, line.unit, ["quantity"], "수량")
    if (line.expiryKind === "none" && line.expiryDate) {
      ctx.addIssue({
        code: "custom",
        path: ["expiryDate"],
        message: "기한 종류가 ‘없음’이면 기한일을 비워 주세요.",
      })
    }
  })

/** 실사재고조정 (`futureDays`: the 재고 설정, see docDateField). */
export function makeCountFormSchema(futureDays: number = FUTURE_DOC_DAYS_MAX) {
  return z
    .object({
      requestId: requestIdField,
      /** The 실사 date (empty = today); the 실사 목록 was read for it. */
      docDate: docDateField(futureDays),
      /** 사유. */
      memo: optionalText(STOCK_LIMITS.memoMaxLength, "사유"),
      lines: z.array(countLineSchema).max(STOCK_LIMITS.linesMax),
      newLots: z.array(countNewLotSchema).max(STOCK_LIMITS.linesMax),
    })
    .superRefine((values, ctx) => {
      const counted = values.lines.filter(
        (line) => line.countedQuantity !== null
      )
      if (counted.length + values.newLots.length === 0) {
        ctx.addIssue({
          code: "custom",
          path: ["lines"],
          message:
            "실사 수량을 1줄 이상 입력하거나 발견한 재고를 추가해 주세요.",
        })
      }
      if (counted.length + values.newLots.length > STOCK_LIMITS.linesMax) {
        ctx.addIssue({
          code: "custom",
          path: ["lines"],
          message: `실사 전표 하나에 ${STOCK_LIMITS.linesMax.toLocaleString("ko-KR")}줄까지 넣을 수 있습니다.`,
        })
      }
    })
}

export const countFormSchema = makeCountFormSchema()

export type CountFormInput = z.input<typeof countFormSchema>
export type CountFormValues = z.output<typeof countFormSchema>
export type CountLineInput = CountFormInput["lines"][number]
export type CountNewLotInput = CountFormInput["newLots"][number]

// ---------------------------------------------------------------------------
// 취소
// ---------------------------------------------------------------------------

/**
 * 취소. The 취소 date may also be the original 전표's own date when that is
 * later than today + the setting (a 예정 전표 can always be undone); the
 * dialog checks that, the database checks it again.
 */
export const reversalFormSchema = z.object({
  requestId: requestIdField,
  /** Empty = today (or the original date of a 예정 전표); not before it. */
  docDate: optionalDate("취소 일자"),
  /** Empty = "<전표번호> 취소". */
  memo: optionalText(STOCK_LIMITS.memoMaxLength, "메모"),
})

export type ReversalFormInput = z.input<typeof reversalFormSchema>

// ---------------------------------------------------------------------------
// URL parameters: shared pieces
// ---------------------------------------------------------------------------

type SearchParamsRecord = Record<string, string | string[] | undefined>

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? ""
}

function pickValue<T extends string>(
  value: string,
  allowed: readonly T[]
): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null
}

function idParam(value: string | string[] | undefined): string | null {
  const text = firstParam(value)
  return isUuid(text) ? text.toLowerCase() : null
}

function dateParam(value: string | string[] | undefined, fallback: string) {
  const text = firstParam(value)
  return isCalendarDate(text) ? text : fallback
}

export type SortDirection = "asc" | "desc"

/** Rows per page of the inventory lists (URL param "size"). Default 100. */
export const INVENTORY_PAGE_SIZES = [50, 100, 300] as const
export type InventoryPageSize = (typeof INVENTORY_PAGE_SIZES)[number]

/** Longest search text used (longer is cut). */
export const INVENTORY_SEARCH_MAX_LENGTH = 100

/** Most rows of an 엑셀 (CSV) download. */
export const INVENTORY_EXPORT_MAX_ROWS = 10_000

const MAX_PAGE = 10_000

function pageParam(value: string | string[] | undefined): number {
  const text = firstParam(value)
  const number = /^\d{1,6}$/.test(text) ? Number(text) : 1
  return Math.min(Math.max(number, 1), MAX_PAGE)
}

function sizeParam(value: string | string[] | undefined): InventoryPageSize {
  const size = Number(firstParam(value))
  return INVENTORY_PAGE_SIZES.includes(size as InventoryPageSize)
    ? (size as InventoryPageSize)
    : 100
}

/** The column and direction of a sort value ("code" / "code_desc"). */
export function sortState<Column extends string>(
  sort: Column | `${Column}_desc`
): { column: Column; direction: SortDirection } {
  if (sort.endsWith("_desc")) {
    return {
      column: sort.slice(0, -"_desc".length) as Column,
      direction: "desc",
    }
  }
  return { column: sort as Column, direction: "asc" }
}

/**
 * The sort after a click on a column title: 오름차순 ▲ → 내림차순 ▼ →
 * back to `defaultSort`.
 */
export function nextColumnSort<Column extends string>(
  current: Column | `${Column}_desc`,
  column: Column,
  defaultSort: Column | `${Column}_desc`
): Column | `${Column}_desc` {
  const state = sortState<Column>(current)
  if (state.column !== column) return column
  if (state.direction === "asc") return `${column}_desc`
  return defaultSort
}

function sortValues<Column extends string>(
  columns: readonly { id: Column; sortable: boolean }[]
): readonly (Column | `${Column}_desc`)[] {
  return columns
    .filter((column) => column.sortable)
    .flatMap((column) => [column.id, `${column.id}_desc` as const])
}

// ---------------------------------------------------------------------------
// 상품별 재고현황: /inventory?from=2026-10-01&to=2026-10-23&q=…
// ---------------------------------------------------------------------------

/**
 * 상품 사용여부 filter of 상품별 재고현황. Default "all": a 사용중지
 * 기준상품's remaining stock is still stock (the dashboard counts it too).
 */
export const PRODUCT_STATUS_FILTERS = [
  { value: "all", label: "전체" },
  { value: "active", label: "사용" },
  { value: "inactive", label: "사용중지" },
] as const
export type ProductStatusFilter =
  (typeof PRODUCT_STATUS_FILTERS)[number]["value"]

/**
 * Sortable columns of 상품별 재고현황 (id = the URL sort key). The grid's
 * own column list and remembered order are in
 * `src/app/(app)/inventory/_components/stock-report-grid.tsx`.
 */
export const STOCK_REPORT_COLUMNS = [
  { id: "code", title: "상품코드", sortable: true },
  { id: "name", title: "상품명", sortable: true },
  { id: "spec", title: "규격", sortable: true },
  { id: "unit", title: "단위", sortable: true },
  { id: "opening", title: "이월재고", sortable: true },
  { id: "receipt", title: "입고", sortable: true },
  { id: "issue", title: "출고", sortable: true },
  { id: "adjust", title: "조정", sortable: true },
  { id: "disposal", title: "폐기", sortable: true },
  { id: "transfer", title: "이동", sortable: true },
  { id: "closing", title: "기말재고", sortable: true },
  { id: "unit_cost", title: "재고단가(부가세포함)", sortable: true },
  { id: "value_incl", title: "재고금액(부가세포함)", sortable: true },
  { id: "value_excl", title: "재고금액(부가세별도)", sortable: true },
  { id: "expiry", title: "가장 빠른 기한", sortable: true },
  { id: "storage", title: "보관온도", sortable: true },
] as const

export type StockReportColumnId = (typeof STOCK_REPORT_COLUMNS)[number]["id"]
export type StockReportSort =
  StockReportColumnId | `${StockReportColumnId}_desc`

const STOCK_REPORT_SORTS = sortValues<StockReportColumnId>(STOCK_REPORT_COLUMNS)

export type StockReportParams = {
  /** 조회기간 시작 (URL "from", default: the 1st of this month). */
  from: string
  /** 조회기간 끝 (URL "to", default: today). */
  to: string
  /** 상품코드·상품명·바코드 search (URL "q"). */
  q: string
  /** 상품분류 (any level, includes the levels below; URL "category"). */
  categoryId: string | null
  /** 미분류 상품만 (URL "uncategorized=1"; overrides categoryId). */
  uncategorized: boolean
  /** 과세구분 (URL "tax"). */
  taxType: TaxType | null
  /** 보관온도 of the product (URL "storage"). */
  storageType: StorageType | null
  /** 상품 사용여부 (URL "status", default "all"). */
  productStatus: ProductStatusFilter
  /** Only stock in this 창고 (URL "warehouse") … */
  warehouseId: string | null
  /** … or this 구역 (URL "zone"). */
  zoneId: string | null
  /** 재고 있는 상품만: 기말재고 ≠ 0 (URL "stock=1"). */
  withStock: boolean
  sort: StockReportSort
  page: number
  pageSize: InventoryPageSize
}

export function defaultStockReportParams(): StockReportParams {
  return {
    from: firstDayOfMonthInKorea(),
    to: todayInKorea(),
    q: "",
    categoryId: null,
    uncategorized: false,
    taxType: null,
    storageType: null,
    // 전체: a 사용중지 기준상품's remaining stock is stock too (the
    // dashboard's 전체 재고 counts it); 사용/사용중지 narrow it down.
    productStatus: "all",
    warehouseId: null,
    zoneId: null,
    withStock: false,
    sort: "code",
    page: 1,
    pageSize: 100,
  }
}

/** Reads 상품별 재고현황's params from the URL (invalid → default). */
export function parseStockReportParams(
  searchParams: SearchParamsRecord
): StockReportParams {
  const defaults = defaultStockReportParams()
  let from = dateParam(searchParams.from, defaults.from)
  let to = dateParam(searchParams.to, defaults.to)
  if (from > to) [from, to] = [to, from]
  return {
    from,
    to,
    q: firstParam(searchParams.q).trim().slice(0, INVENTORY_SEARCH_MAX_LENGTH),
    categoryId: idParam(searchParams.category),
    uncategorized: firstParam(searchParams.uncategorized) === "1",
    taxType: pickValue(
      firstParam(searchParams.tax),
      TAX_TYPES.map((type) => type.value)
    ),
    storageType: pickValue(
      firstParam(searchParams.storage),
      STORAGE_TYPE_VALUES
    ),
    productStatus:
      pickValue(
        firstParam(searchParams.status),
        PRODUCT_STATUS_FILTERS.map((filter) => filter.value)
      ) ?? defaults.productStatus,
    warehouseId: idParam(searchParams.warehouse),
    zoneId: idParam(searchParams.zone),
    withStock: firstParam(searchParams.stock) === "1",
    sort:
      pickValue(firstParam(searchParams.sort), STOCK_REPORT_SORTS) ?? "code",
    page: pageParam(searchParams.page),
    pageSize: sizeParam(searchParams.size),
  }
}

function stockReportQuery(params: StockReportParams): URLSearchParams {
  const defaults = defaultStockReportParams()
  const query = new URLSearchParams()
  if (params.from !== defaults.from) query.set("from", params.from)
  if (params.to !== defaults.to) query.set("to", params.to)
  if (params.q) query.set("q", params.q)
  if (params.uncategorized) query.set("uncategorized", "1")
  else if (params.categoryId) query.set("category", params.categoryId)
  if (params.taxType) query.set("tax", params.taxType)
  if (params.storageType) query.set("storage", params.storageType)
  if (params.productStatus !== defaults.productStatus) {
    query.set("status", params.productStatus)
  }
  if (params.warehouseId) query.set("warehouse", params.warehouseId)
  if (params.zoneId) query.set("zone", params.zoneId)
  if (params.withStock) query.set("stock", "1")
  if (params.sort !== "code") query.set("sort", params.sort)
  return query
}

/** The 상품별 재고현황 URL ("/inventory" for the default view). */
export function buildStockReportHref(params: StockReportParams): string {
  const query = stockReportQuery(params)
  if (params.page > 1) query.set("page", String(params.page))
  if (params.pageSize !== 100) query.set("size", String(params.pageSize))
  const search = query.toString()
  return search ? `/inventory?${search}` : "/inventory"
}

/** The 엑셀 (CSV) URL of 상품별 재고현황 (same filters, all rows). */
export function buildStockReportExportHref(params: StockReportParams): string {
  const search = stockReportQuery(params).toString()
  return search ? `/inventory/export?${search}` : "/inventory/export"
}

// ---------------------------------------------------------------------------
// 재고처별 재고현황: /inventory/locations?warehouse=…&expiry=attention
// ---------------------------------------------------------------------------

/**
 * 기한 filter of 재고처별 재고현황 (URL "expiry"): "attention" = 기한 경과
 * + 기한 임박 (the 폐기 등록 picker's default).
 */
export const LOT_EXPIRY_FILTERS = [
  { value: "all", label: "전체" },
  { value: "attention", label: "경과·임박" },
  { value: "expired", label: "기한 경과" },
  { value: "imminent", label: "기한 임박" },
  { value: "ok", label: "정상" },
  { value: "none", label: "기한 없음" },
] as const satisfies readonly {
  value: "all" | "attention" | ExpiryStatus
  label: string
}[]
export type LotExpiryFilter = (typeof LOT_EXPIRY_FILTERS)[number]["value"]

/**
 * Sortable columns of 재고처별 재고현황 (id = the URL sort key). The grid's
 * own column list and remembered order are in
 * `src/app/(app)/inventory/locations/_components/lot-stock-grid.tsx`.
 */
export const LOT_STOCK_COLUMNS = [
  { id: "location", title: "위치", sortable: true },
  { id: "product_code", title: "상품코드", sortable: true },
  { id: "product_name", title: "상품명", sortable: true },
  { id: "lot_no", title: "로트번호", sortable: true },
  { id: "expiry_kind", title: "기한 종류", sortable: true },
  { id: "expiry_date", title: "기한일", sortable: true },
  { id: "days_left", title: "D-day", sortable: true },
  { id: "quantity", title: "수량", sortable: true },
  { id: "unit_cost", title: "단가(부가세포함)", sortable: true },
  { id: "value_incl", title: "금액(부가세포함)", sortable: true },
  { id: "value_excl", title: "금액(부가세별도)", sortable: true },
  { id: "storage", title: "보관온도", sortable: true },
  { id: "received_date", title: "입고일", sortable: true },
  { id: "supplier", title: "매입처", sortable: true },
] as const

export type LotStockColumnId = (typeof LOT_STOCK_COLUMNS)[number]["id"]
export type LotStockSort = LotStockColumnId | `${LotStockColumnId}_desc`
const LOT_STOCK_SORTS = sortValues<LotStockColumnId>(LOT_STOCK_COLUMNS)

export type LotStockParams = {
  /** 창고 > 구역 > 위치 (URL "warehouse", "zone", "location"). */
  warehouseId: string | null
  zoneId: string | null
  locationId: string | null
  /** Only this 상품 (URL "product"). */
  productId: string | null
  /** 상품코드·상품명·바코드·로트번호 search (URL "q"). */
  q: string
  /** 기한 filter (URL "expiry", default "all"). */
  expiry: LotExpiryFilter
  /** Only lots in a 구역 with another 보관온도 (URL "mismatch=1"). */
  mismatch: boolean
  /** 보관온도 of the product (URL "storage"). */
  storageType: StorageType | null
  /** Default: 위치, then 상품코드, then 기한. */
  sort: LotStockSort
  page: number
  pageSize: InventoryPageSize
}

export const defaultLotStockParams: LotStockParams = {
  warehouseId: null,
  zoneId: null,
  locationId: null,
  productId: null,
  q: "",
  expiry: "all",
  mismatch: false,
  storageType: null,
  sort: "location",
  page: 1,
  pageSize: 100,
}

export function parseLotStockParams(
  searchParams: SearchParamsRecord
): LotStockParams {
  return {
    warehouseId: idParam(searchParams.warehouse),
    zoneId: idParam(searchParams.zone),
    locationId: idParam(searchParams.location),
    productId: idParam(searchParams.product),
    q: firstParam(searchParams.q).trim().slice(0, INVENTORY_SEARCH_MAX_LENGTH),
    expiry:
      pickValue(
        firstParam(searchParams.expiry),
        LOT_EXPIRY_FILTERS.map((filter) => filter.value)
      ) ?? "all",
    mismatch: firstParam(searchParams.mismatch) === "1",
    storageType: pickValue(
      firstParam(searchParams.storage),
      STORAGE_TYPE_VALUES
    ),
    sort:
      pickValue(firstParam(searchParams.sort), LOT_STOCK_SORTS) ?? "location",
    page: pageParam(searchParams.page),
    pageSize: sizeParam(searchParams.size),
  }
}

function lotStockQuery(params: LotStockParams): URLSearchParams {
  const query = new URLSearchParams()
  if (params.warehouseId) query.set("warehouse", params.warehouseId)
  if (params.zoneId) query.set("zone", params.zoneId)
  if (params.locationId) query.set("location", params.locationId)
  if (params.productId) query.set("product", params.productId)
  if (params.q) query.set("q", params.q)
  if (params.expiry !== "all") query.set("expiry", params.expiry)
  if (params.mismatch) query.set("mismatch", "1")
  if (params.storageType) query.set("storage", params.storageType)
  if (params.sort !== "location") query.set("sort", params.sort)
  return query
}

export function buildLotStockHref(params: LotStockParams): string {
  const query = lotStockQuery(params)
  if (params.page > 1) query.set("page", String(params.page))
  if (params.pageSize !== 100) query.set("size", String(params.pageSize))
  const search = query.toString()
  return search ? `/inventory/locations?${search}` : "/inventory/locations"
}

export function buildLotStockExportHref(params: LotStockParams): string {
  const search = lotStockQuery(params).toString()
  return search
    ? `/inventory/locations/export?${search}`
    : "/inventory/locations/export"
}

// ---------------------------------------------------------------------------
// 상품별 거래수불: /inventory/ledger?product=<uuid>&from=…&to=…
// ---------------------------------------------------------------------------

export type StockLedgerParams = {
  /** The 기준상품 (URL "product"); null = none chosen yet. */
  productId: string | null
  from: string
  to: string
  warehouseId: string | null
  zoneId: string | null
  locationId: string | null
}

export function defaultStockLedgerParams(): StockLedgerParams {
  return {
    productId: null,
    from: firstDayOfMonthInKorea(),
    to: todayInKorea(),
    warehouseId: null,
    zoneId: null,
    locationId: null,
  }
}

export function parseStockLedgerParams(
  searchParams: SearchParamsRecord
): StockLedgerParams {
  const defaults = defaultStockLedgerParams()
  let from = dateParam(searchParams.from, defaults.from)
  let to = dateParam(searchParams.to, defaults.to)
  if (from > to) [from, to] = [to, from]
  return {
    productId: idParam(searchParams.product),
    from,
    to,
    warehouseId: idParam(searchParams.warehouse),
    zoneId: idParam(searchParams.zone),
    locationId: idParam(searchParams.location),
  }
}

function stockLedgerQuery(params: StockLedgerParams): URLSearchParams {
  const defaults = defaultStockLedgerParams()
  const query = new URLSearchParams()
  if (params.productId) query.set("product", params.productId)
  if (params.from !== defaults.from) query.set("from", params.from)
  if (params.to !== defaults.to) query.set("to", params.to)
  if (params.warehouseId) query.set("warehouse", params.warehouseId)
  if (params.zoneId) query.set("zone", params.zoneId)
  if (params.locationId) query.set("location", params.locationId)
  return query
}

/** The 거래수불 URL (from 상품별 재고현황: a click on a product). */
export function buildStockLedgerHref(
  params: Partial<StockLedgerParams>
): string {
  const search = stockLedgerQuery({
    ...defaultStockLedgerParams(),
    ...params,
  }).toString()
  return search ? `/inventory/ledger?${search}` : "/inventory/ledger"
}

export function buildStockLedgerExportHref(params: StockLedgerParams): string {
  const search = stockLedgerQuery(params).toString()
  return search
    ? `/inventory/ledger/export?${search}`
    : "/inventory/ledger/export"
}

// ---------------------------------------------------------------------------
// 전표 lists: /inventory/receipts, /issues, /disposals, /transfers, /counts
// ---------------------------------------------------------------------------

/** The 전표 screens (sidebar 재고관리) and the 전표 종류 each lists. */
export const STOCK_DOCUMENT_SCREENS = {
  receipt: {
    path: "/inventory/receipts",
    title: "입고 등록",
    /** 기초재고 (자료일괄등록) is listed with the 입고. */
    types: ["receipt", "opening"],
  },
  issue: { path: "/inventory/issues", title: "출고 등록", types: ["issue"] },
  disposal: {
    path: "/inventory/disposals",
    title: "폐기 등록",
    types: ["disposal"],
  },
  transfer: {
    path: "/inventory/transfers",
    title: "재고처간 이동등록",
    types: ["transfer"],
  },
  count: { path: "/inventory/counts", title: "실사재고조정", types: ["count"] },
} as const satisfies Record<
  string,
  { path: string; title: string; types: readonly StockDocumentType[] }
>

export type StockDocumentScreen = keyof typeof STOCK_DOCUMENT_SCREENS

/** 상태 filter of a 전표 list (URL "status"). */
export const STOCK_DOCUMENT_STATUS_FILTERS = [
  { value: "all", label: "전체" },
  { value: "active", label: "정상" },
  { value: "reversed", label: "취소됨" },
] as const
export type StockDocumentStatusFilter =
  (typeof STOCK_DOCUMENT_STATUS_FILTERS)[number]["value"]

export type StockDocumentListParams = {
  /**
   * 전표 일자 range (URL "from"/"to"; default: the last 30 days and every
   * 예정 전표 — "to" is today + FUTURE_DOC_DAYS_MAX, the latest date the
   * 재고 설정 can ever allow, so a 전표 saved for tomorrow is in the list).
   */
  from: string
  to: string
  /** 전표번호·상품코드·상품명·로트번호 (URL "q"). */
  q: string
  /** 거래처 (URL "partner"). */
  partnerId: string | null
  /** Only 전표 with this 기준상품 (URL "product"). */
  productId: string | null
  /** URL "status": all (default) / active (not undone) / reversed (undone). */
  status: StockDocumentStatusFilter
  /** Show the 취소 전표 rows too (URL "reversals=0" hides them). */
  includeReversals: boolean
  page: number
  pageSize: InventoryPageSize
}

export function defaultStockDocumentListParams(): StockDocumentListParams {
  const today = todayInKorea()
  return {
    from: shiftDate(today, -30),
    to: shiftDate(today, FUTURE_DOC_DAYS_MAX),
    q: "",
    partnerId: null,
    productId: null,
    status: "all",
    includeReversals: true,
    page: 1,
    pageSize: 100,
  }
}

export function parseStockDocumentListParams(
  searchParams: SearchParamsRecord
): StockDocumentListParams {
  const defaults = defaultStockDocumentListParams()
  let from = dateParam(searchParams.from, defaults.from)
  let to = dateParam(searchParams.to, defaults.to)
  if (from > to) [from, to] = [to, from]
  return {
    from,
    to,
    q: firstParam(searchParams.q).trim().slice(0, INVENTORY_SEARCH_MAX_LENGTH),
    partnerId: idParam(searchParams.partner),
    productId: idParam(searchParams.product),
    status:
      pickValue(
        firstParam(searchParams.status),
        STOCK_DOCUMENT_STATUS_FILTERS.map((filter) => filter.value)
      ) ?? "all",
    includeReversals: firstParam(searchParams.reversals) !== "0",
    page: pageParam(searchParams.page),
    pageSize: sizeParam(searchParams.size),
  }
}

function stockDocumentListQuery(params: StockDocumentListParams) {
  const defaults = defaultStockDocumentListParams()
  const query = new URLSearchParams()
  if (params.from !== defaults.from) query.set("from", params.from)
  if (params.to !== defaults.to) query.set("to", params.to)
  if (params.q) query.set("q", params.q)
  if (params.partnerId) query.set("partner", params.partnerId)
  if (params.productId) query.set("product", params.productId)
  if (params.status !== "all") query.set("status", params.status)
  if (!params.includeReversals) query.set("reversals", "0")
  return query
}

/** A 전표 list URL, e.g. "/inventory/receipts?from=…". */
export function buildStockDocumentListHref(
  screen: StockDocumentScreen,
  params: StockDocumentListParams
): string {
  const query = stockDocumentListQuery(params)
  if (params.page > 1) query.set("page", String(params.page))
  if (params.pageSize !== 100) query.set("size", String(params.pageSize))
  const search = query.toString()
  const path = STOCK_DOCUMENT_SCREENS[screen].path
  return search ? `${path}?${search}` : path
}

/** The 엑셀 (CSV) URL of a 전표 list: "<path>/export?…". */
export function buildStockDocumentExportHref(
  screen: StockDocumentScreen,
  params: StockDocumentListParams
): string {
  const search = stockDocumentListQuery(params).toString()
  const path = `${STOCK_DOCUMENT_SCREENS[screen].path}/export`
  return search ? `${path}?${search}` : path
}

/**
 * The modal of a 전표 screen, in the URL (전표 are never edited, only
 * viewed and undone with [취소]):
 *   ?modal=new             등록
 *   ?modal=view&id=<uuid>  전표 보기 (with [취소])
 */
export type StockDocumentModalState =
  { mode: "new" } | { mode: "view"; id: string }

export function parseStockDocumentModal(
  searchParams: Pick<URLSearchParams, "get">
): StockDocumentModalState | null {
  const modal = searchParams.get("modal")
  if (modal === "new") return { mode: "new" }
  if (modal === "view")
    return { mode: "view", id: searchParams.get("id") ?? "" }
  return null
}

/** The list URL with the modal open (or closed for null), keeping the other params. */
export function buildStockDocumentModalHref(
  screen: StockDocumentScreen,
  currentSearch: string,
  modal: StockDocumentModalState | null
): string {
  const query = new URLSearchParams(currentSearch)
  query.delete("modal")
  query.delete("id")
  if (modal?.mode === "view") {
    query.set("modal", "view")
    query.set("id", modal.id)
  } else if (modal?.mode === "new") {
    query.set("modal", "new")
  }
  const search = query.toString()
  const path = STOCK_DOCUMENT_SCREENS[screen].path
  return search ? `${path}?${search}` : path
}

/** Re-exported so screens import the labels from one place. */
export type { DisposalReason, ExpiryKind }
