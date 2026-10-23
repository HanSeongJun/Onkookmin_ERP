"use server"

import type { PostgrestError } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireUser } from "@/lib/auth/user"
import {
  INVENTORY_DB_CONSTRAINTS,
  INVENTORY_DB_RULES,
  type ExpiryKind,
  type StockDocumentType,
} from "@/lib/inventory/constants"
import {
  getCountSheet,
  getInventorySettings,
  getStockDocument,
  getStockPlaceTree,
  getLotStockRows,
  getStockProductOptions,
  INVENTORY_NOT_READY_MESSAGE,
  isInventoryNotReady,
  listLotStock,
  searchStockPartners,
  searchStockProducts,
  type CountSheetLine,
  type InventoryList,
  type InventorySettings,
  type LotStockRow,
  type StockDocumentDetail,
  type StockPartnerOption,
  type StockProductOption,
  type StockWarehouseNode,
} from "@/lib/inventory/queries"
import {
  countFormSchema,
  defaultLotStockParams,
  disposalFormSchema,
  inventorySettingsSchema,
  isCalendarDate,
  issueFormSchema,
  locationFormSchema,
  receiptFormSchema,
  reversalFormSchema,
  transferFormSchema,
  warehouseFormSchema,
  zoneFormSchema,
  type LotStockParams,
} from "@/lib/inventory/schema"
import { isUuid } from "@/lib/products/schema"
import type { StorageType, TaxType } from "@/lib/products/constants"
import { createClient } from "@/lib/supabase/server"
import { Constants, type Json } from "@/types/database"

// Server Actions of the 재고관리 screens. Every one checks the login and
// its input again (never trust the browser), then calls the database: the
// 전표 functions (receive_stock, issue_stock, …) check every rule once more
// and save all or nothing. Call them inside startTransition and pass caught
// errors through unstable_rethrow (see CLAUDE.md), like the other screens.

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** A 보관온도 warning: the product needs another temperature than its 구역. */
export type StockWarning = {
  type: "storage_mismatch"
  /** 1-based line of the form's list (see `list`). */
  line: number
  /** "lines", or "newLots" (실사: 발견 재고). */
  list: "lines" | "newLots"
  productId: string
  productCode: string
  productName: string
  productStorageType: StorageType
  zoneStorageType: StorageType
  locationId: string
  locationLabel: string
  /** The 구역 is warmer than the product needs (dangerous). */
  tooWarm: boolean
  lotId?: string
  lotNo?: string
}

/** A lot made by 입고 / 실사 (발견 재고): one per 기준상품. */
export type CreatedLot = {
  /** 1-based line of the form. */
  line: number
  lotId: string
  lotNo: string
  productId: string
  productCode: string
  productName: string
  unit: string
  quantity: number
  expiryKind: ExpiryKind
  expiryDate: string | null
  /** Per unit of the 기준상품 (a 묶음상품's 단가 is shared, see splitBundleUnitCost). */
  unitCostInclVat: number | null
  costRule: "direct" | "price_weight" | "quantity"
}

/** What a 전표 save returns. */
export type StockSaveResult =
  | {
      ok: true
      documentId: string
      docNo: string
      docDate: string
      docType: StockDocumentType
      /** The same request had been saved before (a retry): nothing new. */
      alreadySaved: boolean
      /** Korean summary for a toast. */
      message: string
      /** 보관온도 warnings (saved anyway). */
      warnings: StockWarning[]
      /** 입고 / 실사: the lots made. */
      lots: CreatedLot[]
      /** 실사조정: lines raised, lowered, unchanged (incl. 발견 재고 in increased). */
      countSummary?: { increased: number; decreased: number; unchanged: number }
    }
  | {
      ok: false
      /** Korean message for the whole form (toast). */
      message: string
      /**
       * Korean messages by react-hook-form path ("docDate",
       * "lines.2.quantity", "newLots.0.expiryDate", "lines").
       */
      fieldErrors: Record<string, string>
    }

const CHECK_INPUT_MESSAGE = "입력한 내용을 확인해 주세요."
const SAVE_FAILED_MESSAGE =
  "전표를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요."
const BUSY_MESSAGE =
  "다른 직원이 같은 재고를 동시에 저장하고 있어 저장하지 못했습니다. 잠시 후 다시 저장해 주세요. (아무것도 저장하지 않았습니다.)"

// ---------------------------------------------------------------------------
// Turning errors into Korean messages
// ---------------------------------------------------------------------------

/** "lines" / "new_lots" line number → the form's path prefix ("lines.3"). */
type LineMapper = (list: string | null, line: number) => string | null

const defaultLineMapper: LineMapper = (list, line) =>
  list === "new_lots" ? `newLots.${line - 1}` : `lines.${line - 1}`

/** snake_case JSON key → camelCase form field ("unit_cost_incl_vat" → "unitCostInclVat"). */
function formField(key: string): string {
  if (key === "new_lots") return "newLots"
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}

const errorDetailSchema = z.object({
  line: z.number().nullable().optional(),
  field: z.string().nullable().optional(),
  list: z.string().nullable().optional(),
})

function readDetail(error: PostgrestError) {
  try {
    const parsed = errorDetailSchema.safeParse(JSON.parse(error.details ?? ""))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** The 실사 form's "발견 재고" list is called newLots in the form. */
function lineLabel(list: string | null | undefined, path: string | null) {
  const index = path ? Number(path.split(".")[1]) : NaN
  if (!Number.isFinite(index)) return ""
  return list === "new_lots"
    ? `발견 재고 ${index + 1}번째 줄: `
    : `${index + 1}번째 줄: `
}

/**
 * A database error of a 전표 function as Korean messages: our own errors
 * (HINT key) go under the field their DETAIL names; lock waits, timeouts,
 * a missing migration and constraint names get their own messages.
 */
function stockSaveFailed(
  error: PostgrestError,
  mapLine: LineMapper = defaultLineMapper
): Extract<StockSaveResult, { ok: false }> {
  if (isInventoryNotReady(error)) {
    return { ok: false, message: INVENTORY_NOT_READY_MESSAGE, fieldErrors: {} }
  }
  const knownRule = (Object.values(INVENTORY_DB_RULES) as string[]).includes(
    error.hint ?? ""
  )
  if (knownRule || error.hint === "import_row_invalid") {
    const detail = readDetail(error)
    const fieldErrors: Record<string, string> = {}
    let prefix = ""
    if (detail?.line && detail.line > 0) {
      const path = mapLine(detail.list ?? null, detail.line)
      prefix = lineLabel(detail.list, path)
      if (path) {
        fieldErrors[
          detail.field ? `${path}.${formField(detail.field)}` : path
        ] = error.message
      }
    } else if (detail?.field) {
      fieldErrors[formField(detail.field)] = error.message
    }
    return { ok: false, message: `${prefix}${error.message}`, fieldErrors }
  }

  const text = `${error.message} ${error.details ?? ""}`
  if (
    error.code === "23505" &&
    text.includes(INVENTORY_DB_CONSTRAINTS.lotNoUnique)
  ) {
    return {
      ok: false,
      message:
        "같은 상품에 같은 로트번호가 방금 다른 전표로 등록되었습니다. 로트번호를 바꾸거나 비워 두고(자동) 다시 저장해 주세요.",
      fieldErrors: {},
    }
  }
  if (
    error.code === "23505" &&
    text.includes(INVENTORY_DB_CONSTRAINTS.requestUnique)
  ) {
    return {
      ok: false,
      message: "이미 저장된 전표입니다. 목록을 새로 고쳐 확인해 주세요.",
      fieldErrors: {},
    }
  }
  if (
    error.code === "23514" &&
    text.includes(INVENTORY_DB_CONSTRAINTS.balanceNotNegative)
  ) {
    return {
      ok: false,
      message:
        "다른 직원이 같은 재고를 먼저 꺼내 재고가 모자랍니다. 화면을 새로 고친 뒤 다시 시도해 주세요. (아무것도 저장하지 않았습니다.)",
      fieldErrors: {},
    }
  }
  if (["40001", "40P01", "55P03"].includes(error.code)) {
    return { ok: false, message: BUSY_MESSAGE, fieldErrors: {} }
  }
  if (error.code === "57014") {
    return {
      ok: false,
      message:
        "저장하는 데 시간이 너무 오래 걸려 멈췄습니다. 줄 수를 줄여 나눠서 저장해 주세요. (아무것도 저장하지 않았습니다.)",
      fieldErrors: {},
    }
  }
  if (error.code === "42501") {
    return {
      ok: false,
      message: "저장할 권한이 없습니다. 다시 로그인해 주세요.",
      fieldErrors: {},
    }
  }
  console.error("Could not save a stock document:", error)
  return { ok: false, message: SAVE_FAILED_MESSAGE, fieldErrors: {} }
}

/** The first message of each path of a zod error. */
function validationFailed(
  error: z.ZodError
): Extract<StockSaveResult, { ok: false }> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".")
    if (path && !fieldErrors[path]) fieldErrors[path] = issue.message
  }
  const first = error.issues[0]
  if (Object.keys(fieldErrors).length === 0 && first) {
    return { ok: false, message: first.message, fieldErrors }
  }
  const line = /^(lines|newLots)\.(\d+)\./.exec(
    Object.keys(fieldErrors)[0] ?? ""
  )
  const prefix = line
    ? `${line[1] === "newLots" ? "발견 재고 " : ""}${Number(line[2]) + 1}번째 줄: `
    : ""
  return {
    ok: false,
    message: first ? `${prefix}${first.message}` : CHECK_INPUT_MESSAGE,
    fieldErrors,
  }
}

// ---------------------------------------------------------------------------
// Reading what the 전표 functions return
// ---------------------------------------------------------------------------

const warningSchema = z.object({
  line: z.number(),
  list: z.string().optional(),
  product_id: z.string(),
  product_code: z.string(),
  product_name: z.string(),
  product_storage_type: z.enum(Constants.public.Enums.storage_type),
  zone_storage_type: z.enum(Constants.public.Enums.storage_type),
  location_id: z.string(),
  location_label: z.string().nullable(),
  too_warm: z.boolean(),
  lot_id: z.string().optional(),
  lot_no: z.string().optional(),
})

const lotSchema = z.object({
  line: z.number(),
  lot_id: z.string(),
  lot_no: z.string(),
  product_id: z.string(),
  product_code: z.string(),
  product_name: z.string(),
  unit: z.string(),
  quantity: z.number(),
  expiry_kind: z.enum(Constants.public.Enums.expiry_kind),
  expiry_date: z.string().nullable(),
  unit_cost_incl_vat: z.number().nullable(),
  cost_rule: z.enum(["direct", "price_weight", "quantity"]),
})

const saveResultSchema = z.object({
  document_id: z.string(),
  doc_no: z.string(),
  doc_date: z.string(),
  doc_type: z.enum(Constants.public.Enums.stock_document_type),
  already_saved: z.boolean().optional(),
  warnings: z.array(warningSchema).optional(),
  lots: z.array(lotSchema).optional(),
  increased: z.number().optional(),
  decreased: z.number().optional(),
  unchanged: z.number().optional(),
})

function savedResult(
  data: Json | null,
  message: (docNo: string) => string,
  mapWarningLine: (list: string | undefined, line: number) => number = (
    _,
    line
  ) => line
): StockSaveResult {
  const parsed = saveResultSchema.parse(data)
  const alreadySaved = parsed.already_saved ?? false
  return {
    ok: true,
    documentId: parsed.document_id,
    docNo: parsed.doc_no,
    docDate: parsed.doc_date,
    docType: parsed.doc_type,
    alreadySaved,
    message: alreadySaved
      ? `이미 저장된 전표입니다 (${parsed.doc_no}).`
      : message(parsed.doc_no),
    warnings: (parsed.warnings ?? []).map((warning) => ({
      type: "storage_mismatch",
      line: mapWarningLine(warning.list, warning.line),
      list: warning.list === "new_lots" ? "newLots" : "lines",
      productId: warning.product_id,
      productCode: warning.product_code,
      productName: warning.product_name,
      productStorageType: warning.product_storage_type,
      zoneStorageType: warning.zone_storage_type,
      locationId: warning.location_id,
      locationLabel: warning.location_label ?? "",
      tooWarm: warning.too_warm,
      lotId: warning.lot_id,
      lotNo: warning.lot_no,
    })),
    lots: (parsed.lots ?? []).map((lot) => ({
      line: lot.line,
      lotId: lot.lot_id,
      lotNo: lot.lot_no,
      productId: lot.product_id,
      productCode: lot.product_code,
      productName: lot.product_name,
      unit: lot.unit,
      quantity: lot.quantity,
      expiryKind: lot.expiry_kind,
      expiryDate: lot.expiry_date,
      unitCostInclVat: lot.unit_cost_incl_vat,
      costRule: lot.cost_rule,
    })),
    countSummary:
      parsed.increased === undefined
        ? undefined
        : {
            increased: parsed.increased,
            decreased: parsed.decreased ?? 0,
            unchanged: parsed.unchanged ?? 0,
          },
  }
}

/** Refreshes every 재고 screen and the dashboard after a save. */
function revalidateInventory() {
  revalidatePath("/(app)/inventory", "layout")
  revalidatePath("/")
}

function header(values: {
  requestId: string | null
  docDate: string | null
  partnerId?: string | null
  memo: string | null
}): Json {
  return {
    request_id: values.requestId,
    doc_date: values.docDate,
    partner_id: values.partnerId ?? null,
    memo: values.memo,
  }
}

const quantityText = (value: string) => value

// ---------------------------------------------------------------------------
// 입고 등록
// ---------------------------------------------------------------------------

/**
 * 입고 등록 (input: ReceiptFormInput). Every line makes a new lot (a
 * 묶음상품 one per 기준상품). 보관온도 mismatches are saved and returned as
 * `warnings`.
 */
export async function createReceipt(input: unknown): Promise<StockSaveResult> {
  await requireUser()
  const parsed = receiptFormSchema.safeParse(input)
  if (!parsed.success) return validationFailed(parsed.error)
  const values = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("receive_stock", {
    header: header(values),
    lines: values.lines.map((line) => ({
      product_id: line.productId,
      quantity: quantityText(line.quantity),
      location_id: line.locationId,
      expiry_kind: line.expiryKind,
      expiry_date: line.expiryDate,
      manufactured_date: line.manufacturedDate,
      lot_no: line.lotNo,
      supplier_lot_no: line.supplierLotNo,
      unit_cost_incl_vat: line.unitCostInclVat,
      origin: line.origin,
      memo: line.memo,
    })),
  })
  if (error) return stockSaveFailed(error)
  revalidateInventory()
  return savedResult(data, (docNo) => `입고 전표 ${docNo}를 저장했습니다.`)
}

/**
 * The 입고 conversion preview of one line: the 기준상품 a product stands
 * for (a 기준상품 itself; a 묶음상품 its 구성표) with their quantity and
 * share of the 입고 단가 — computed by the database exactly as the save
 * will (stock_bundle_components). splitBundleUnitCost in
 * `@/lib/inventory/constants` gives the same numbers in the browser.
 */
export async function previewReceiptLine(
  productId: unknown,
  quantity: unknown,
  unitCostInclVat: unknown
): Promise<
  {
    productId: string
    code: string
    name: string
    unit: string
    storageType: StorageType
    shelfLifeDays: number | null
    quantityPerUnit: number
    quantity: number
    unitCostInclVat: number | null
    costRule: "direct" | "price_weight" | "quantity"
  }[]
> {
  await requireUser()
  if (!isUuid(productId)) return []
  const amount =
    typeof quantity === "number" && quantity > 0 && quantity <= 100_000_000
      ? quantity
      : 1
  const cost =
    typeof unitCostInclVat === "number" &&
    Number.isSafeInteger(unitCostInclVat) &&
    unitCostInclVat >= 0
      ? unitCostInclVat
      : undefined
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("stock_bundle_components", {
    target_product_id: productId,
    target_quantity: amount,
    target_unit_cost: cost,
  })
  if (error) {
    console.error("Could not preview a receipt line:", error)
    return []
  }
  return z
    .array(
      z.object({
        product_id: z.string(),
        code: z.string(),
        name: z.string(),
        unit: z.string(),
        storage_type: z.enum(Constants.public.Enums.storage_type),
        shelf_life_days: z.number().nullable(),
        quantity_per_unit: z.number(),
        quantity: z.number(),
        unit_cost_incl_vat: z.number().nullable(),
        cost_rule: z.enum(["direct", "price_weight", "quantity"]),
      })
    )
    .parse(data)
    .map((item) => ({
      productId: item.product_id,
      code: item.code,
      name: item.name,
      unit: item.unit,
      storageType: item.storage_type,
      shelfLifeDays: item.shelf_life_days,
      quantityPerUnit: item.quantity_per_unit,
      quantity: item.quantity,
      unitCostInclVat: item.unit_cost_incl_vat,
      costRule: item.cost_rule,
    }))
}

// ---------------------------------------------------------------------------
// 출고 등록 (FEFO)
// ---------------------------------------------------------------------------

const allocationSchema = z.object({
  lot_id: z.string(),
  lot_no: z.string(),
  expiry_kind: z.enum(Constants.public.Enums.expiry_kind),
  expiry_date: z.string().nullable(),
  days_left: z.number().nullable(),
  received_date: z.string(),
  unit_cost_incl_vat: z.number().nullable(),
  location_id: z.string(),
  location_code: z.string(),
  location_name: z.string().nullable(),
  zone_id: z.string(),
  zone_code: z.string(),
  zone_name: z.string(),
  zone_storage_type: z.enum(Constants.public.Enums.storage_type),
  warehouse_id: z.string(),
  warehouse_code: z.string(),
  warehouse_name: z.string(),
  available: z.number(),
  quantity: z.number(),
})

const planSchema = z.object({
  doc_date: z.string(),
  ok: z.boolean(),
  lines: z.array(
    z.object({
      line: z.number(),
      product_id: z.string(),
      product_code: z.string(),
      product_name: z.string(),
      product_type: z.enum(Constants.public.Enums.product_type),
      unit: z.string(),
      quantity: z.number(),
      shortage: z.boolean(),
      demands: z.array(
        z.object({
          product_id: z.string(),
          code: z.string(),
          name: z.string(),
          unit: z.string(),
          storage_type: z.enum(Constants.public.Enums.storage_type),
          quantity: z.number(),
          allocated: z.number(),
          shortage: z.number(),
          available: z.number(),
          expired_excluded: z.number(),
          taken_by_other_lines: z.number().optional(),
          allocations: z.array(allocationSchema),
        })
      ),
    })
  ),
})

/** One lot × 위치 the FEFO plan takes stock from. */
export type IssueAllocation = {
  lotId: string
  lotNo: string
  expiryKind: ExpiryKind
  expiryDate: string | null
  /** 기한일 − today (D-day badge). */
  daysLeft: number | null
  receivedDate: string
  unitCostInclVat: number | null
  locationId: string
  locationCode: string
  locationName: string | null
  zoneId: string
  zoneCode: string
  zoneName: string
  zoneStorageType: StorageType
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  /** What this lot × 위치 could give (after earlier lines). */
  available: number
  /** What the plan takes. */
  quantity: number
}

/** One 기준상품 of a line (a 묶음상품 line has one per 구성상품). */
export type IssueDemand = {
  productId: string
  code: string
  name: string
  unit: string
  storageType: StorageType
  /** Needed (line quantity × 구성 수량 for a 묶음상품). */
  quantity: number
  allocated: number
  /** Not covered (0 when the line can go out). */
  shortage: number
  /**
   * Total that can go out now, after the lines planned before it (lines
   * limited to a 위치 / 구역 / 창고 are planned first, see stock_issue_plan).
   */
  available: number
  /** Stock left out because its 기한 passed. */
  expiredExcluded: number
  /** Stock at this line's places that lines planned before it took. */
  takenByOtherLines: number
  allocations: IssueAllocation[]
}

export type IssuePlanLine = {
  /** 1-based line of the form. */
  line: number
  productId: string
  productCode: string
  productName: string
  productType: "base" | "bundle"
  unit: string
  quantity: number
  /** Some 기준상품 of the line lacks stock. */
  shortage: boolean
  demands: IssueDemand[]
}

/** The FEFO plan of a 출고 전표 ([배정 미리보기]). */
export type IssuePlan = {
  docDate: string
  /** Every line can go out. */
  ok: boolean
  lines: IssuePlanLine[]
}

function toIssuePlan(data: Json | null): IssuePlan {
  const plan = planSchema.parse(data)
  return {
    docDate: plan.doc_date,
    ok: plan.ok,
    lines: plan.lines.map((line) => ({
      line: line.line,
      productId: line.product_id,
      productCode: line.product_code,
      productName: line.product_name,
      productType: line.product_type,
      unit: line.unit,
      quantity: line.quantity,
      shortage: line.shortage,
      demands: line.demands.map((demand) => ({
        productId: demand.product_id,
        code: demand.code,
        name: demand.name,
        unit: demand.unit,
        storageType: demand.storage_type,
        quantity: demand.quantity,
        allocated: demand.allocated,
        shortage: demand.shortage,
        available: demand.available,
        expiredExcluded: demand.expired_excluded,
        takenByOtherLines: demand.taken_by_other_lines ?? 0,
        allocations: demand.allocations.map((allocation) => ({
          lotId: allocation.lot_id,
          lotNo: allocation.lot_no,
          expiryKind: allocation.expiry_kind,
          expiryDate: allocation.expiry_date,
          daysLeft: allocation.days_left,
          receivedDate: allocation.received_date,
          unitCostInclVat: allocation.unit_cost_incl_vat,
          locationId: allocation.location_id,
          locationCode: allocation.location_code,
          locationName: allocation.location_name,
          zoneId: allocation.zone_id,
          zoneCode: allocation.zone_code,
          zoneName: allocation.zone_name,
          zoneStorageType: allocation.zone_storage_type,
          warehouseId: allocation.warehouse_id,
          warehouseCode: allocation.warehouse_code,
          warehouseName: allocation.warehouse_name,
          available: allocation.available,
          quantity: allocation.quantity,
        })),
      })),
    })),
  }
}

function issueLines(values: z.output<typeof issueFormSchema>): Json {
  return values.lines.map((line) => ({
    product_id: line.productId,
    quantity: quantityText(line.quantity),
    warehouse_id: line.warehouseId,
    zone_id: line.zoneId,
    location_id: line.locationId,
    memo: line.memo,
  }))
}

/**
 * [배정 미리보기] of the 출고 form (input: IssueFormInput): which lots and
 * 위치 FEFO would take now (nothing saved or locked). `plan.ok` false =
 * some line lacks stock (see each demand's shortage / available /
 * expiredExcluded).
 */
export async function previewIssue(
  input: unknown
): Promise<
  { ok: true; plan: IssuePlan } | Extract<StockSaveResult, { ok: false }>
> {
  await requireUser()
  const parsed = issueFormSchema.safeParse(input)
  if (!parsed.success) return validationFailed(parsed.error)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("plan_stock_issue", {
    lines: issueLines(parsed.data),
    plan_date: parsed.data.docDate ?? undefined,
  })
  if (error) return stockSaveFailed(error)
  return { ok: true, plan: toIssuePlan(data) }
}

/**
 * 출고 등록 (input: IssueFormInput): FEFO again at the moment of saving
 * (the stock may have changed since the preview). Not enough stock → the
 * line's message names the product and the quantity that can go out;
 * nothing is saved.
 */
export async function createIssue(input: unknown): Promise<StockSaveResult> {
  await requireUser()
  const parsed = issueFormSchema.safeParse(input)
  if (!parsed.success) return validationFailed(parsed.error)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("issue_stock", {
    header: header(parsed.data),
    lines: issueLines(parsed.data),
  })
  if (error) return stockSaveFailed(error)
  revalidateInventory()
  return savedResult(data, (docNo) => `출고 전표 ${docNo}를 저장했습니다.`)
}

// ---------------------------------------------------------------------------
// 폐기 / 이동
// ---------------------------------------------------------------------------

/** 폐기 등록 (input: DisposalFormInput). */
export async function createDisposal(input: unknown): Promise<StockSaveResult> {
  await requireUser()
  const parsed = disposalFormSchema.safeParse(input)
  if (!parsed.success) return validationFailed(parsed.error)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("dispose_stock", {
    header: header(parsed.data),
    lines: parsed.data.lines.map((line) => ({
      lot_id: line.lotId,
      location_id: line.locationId,
      quantity: quantityText(line.quantity),
      reason: line.reason,
      memo: line.memo,
    })),
  })
  if (error) return stockSaveFailed(error)
  revalidateInventory()
  return savedResult(data, (docNo) => `폐기 전표 ${docNo}를 저장했습니다.`)
}

/**
 * 보관온도 warnings of 이동 lines before saving (lines: [{ lotId,
 * toLocationId }]): the lots whose product needs another 보관온도 than the
 * 구역 they go to. Unknown ids are skipped.
 */
export async function previewTransferWarnings(
  lines: unknown
): Promise<StockWarning[]> {
  await requireUser()
  const parsed = z
    .array(z.object({ lotId: z.string(), toLocationId: z.string() }))
    .max(3000)
    .safeParse(lines)
  if (!parsed.success) return []
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("stock_transfer_warnings", {
    lines: parsed.data.map((line) => ({
      lot_id: line.lotId,
      to_location_id: line.toLocationId,
    })),
  })
  if (error) {
    console.error("Could not check transfer warnings:", error)
    return []
  }
  return z
    .array(warningSchema)
    .parse(data)
    .map((warning) => ({
      type: "storage_mismatch",
      line: warning.line,
      list: "lines",
      productId: warning.product_id,
      productCode: warning.product_code,
      productName: warning.product_name,
      productStorageType: warning.product_storage_type,
      zoneStorageType: warning.zone_storage_type,
      locationId: warning.location_id,
      locationLabel: warning.location_label ?? "",
      tooWarm: warning.too_warm,
      lotId: warning.lot_id,
      lotNo: warning.lot_no,
    }))
}

/** 재고처간 이동 등록 (input: TransferFormInput). */
export async function createTransfer(input: unknown): Promise<StockSaveResult> {
  await requireUser()
  const parsed = transferFormSchema.safeParse(input)
  if (!parsed.success) return validationFailed(parsed.error)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("transfer_stock", {
    header: header(parsed.data),
    lines: parsed.data.lines.map((line) => ({
      lot_id: line.lotId,
      from_location_id: line.fromLocationId,
      to_location_id: line.toLocationId,
      quantity: quantityText(line.quantity),
      memo: line.memo,
    })),
  })
  if (error) return stockSaveFailed(error)
  revalidateInventory()
  return savedResult(data, (docNo) => `이동 전표 ${docNo}를 저장했습니다.`)
}

// ---------------------------------------------------------------------------
// 실사재고조정
// ---------------------------------------------------------------------------

const countScopeSchema = z.object({
  warehouseId: z.string().nullable(),
  zoneId: z.string().nullable(),
  locationId: z.string().nullable(),
})

/**
 * The 실사 목록 of a 창고 / 구역 / 위치 at the end of `asOf` ("" = today):
 * every (lot, 위치) with stock and its 전산 수량.
 */
export async function loadCountSheet(
  scope: unknown,
  asOf: unknown
): Promise<
  | { ok: true; asOf: string; lines: CountSheetLine[] }
  | { ok: false; message: string }
> {
  await requireUser()
  const parsed = countScopeSchema.safeParse(scope)
  if (
    !parsed.success ||
    ![parsed.data.warehouseId, parsed.data.zoneId, parsed.data.locationId].some(
      (id) => id !== null
    ) ||
    [parsed.data.warehouseId, parsed.data.zoneId, parsed.data.locationId].some(
      (id) => id !== null && !isUuid(id)
    )
  ) {
    return {
      ok: false,
      message: "실사할 창고(또는 구역·위치)를 선택해 주세요.",
    }
  }
  const date = typeof asOf === "string" && isCalendarDate(asOf) ? asOf : null
  try {
    const sheet = await getCountSheet(parsed.data, date)
    return { ok: true, ...sheet }
  } catch (error) {
    const failure = error as PostgrestError
    if (failure?.hint && failure.message) {
      return { ok: false, message: failure.message }
    }
    if (isInventoryNotReady(failure)) {
      return { ok: false, message: INVENTORY_NOT_READY_MESSAGE }
    }
    console.error("Could not read the count sheet:", error)
    return {
      ok: false,
      message: "실사 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.",
    }
  }
}

/**
 * 실사재고조정 (input: CountFormInput): only the counted lines
 * (countedQuantity not empty) and the 발견 재고 are sent; the database
 * saves only differences, and refuses when the stock changed since the
 * 실사 목록 was read (message: read the list again).
 */
export async function applyStockCount(
  input: unknown
): Promise<StockSaveResult> {
  await requireUser()
  const parsed = countFormSchema.safeParse(input)
  if (!parsed.success) return validationFailed(parsed.error)
  const values = parsed.data
  // The form index of each line sent (lines left uncounted are not sent).
  const sentIndexes = values.lines.flatMap((line, index) =>
    line.countedQuantity === null ? [] : [index]
  )
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("apply_stock_count", {
    header: header(values),
    lines: sentIndexes.map((index) => {
      const line = values.lines[index]
      return {
        lot_id: line.lotId,
        location_id: line.locationId,
        system_quantity: quantityText(line.systemQuantity),
        counted_quantity: line.countedQuantity,
        memo: line.memo,
      }
    }),
    new_lots: values.newLots.map((line) => ({
      product_id: line.productId,
      location_id: line.locationId,
      quantity: quantityText(line.quantity),
      expiry_kind: line.expiryKind,
      expiry_date: line.expiryDate,
      manufactured_date: line.manufacturedDate,
      lot_no: line.lotNo,
      unit_cost_incl_vat: line.unitCostInclVat,
      memo: line.memo,
    })),
  })
  if (error) {
    return stockSaveFailed(error, (list, line) =>
      list === "new_lots"
        ? `newLots.${line - 1}`
        : sentIndexes[line - 1] === undefined
          ? null
          : `lines.${sentIndexes[line - 1]}`
    )
  }
  revalidateInventory()
  return savedResult(
    data,
    (docNo) => `실사조정 전표 ${docNo}를 저장했습니다.`,
    (list, line) =>
      list === "new_lots" ? line : (sentIndexes[line - 1] ?? line - 1) + 1
  )
}

// ---------------------------------------------------------------------------
// 취소
// ---------------------------------------------------------------------------

/**
 * Undoes a 전표 (input: ReversalFormInput: docDate "" = today, memo, the
 * requestId of the confirm dialog). Refused while the stock it takes back
 * is gone (e.g. a 입고 partly issued: undo the 출고 first).
 */
export async function reverseStockDocument(
  documentId: unknown,
  input: unknown
): Promise<StockSaveResult> {
  await requireUser()
  if (!isUuid(documentId)) {
    return {
      ok: false,
      message: "전표를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.",
      fieldErrors: {},
    }
  }
  const parsed = reversalFormSchema.safeParse(input)
  if (!parsed.success) return validationFailed(parsed.error)
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("reverse_stock_document", {
    target_document_id: documentId.toLowerCase(),
    header: header(parsed.data),
  })
  if (error) return stockSaveFailed(error)
  revalidateInventory()
  return savedResult(data, (docNo) => `취소 전표 ${docNo}를 저장했습니다.`)
}

// ---------------------------------------------------------------------------
// Reads for the modals and pickers (fresh each time they open)
// ---------------------------------------------------------------------------

/** One 전표 with its lines, or null (unknown id). */
export async function loadStockDocument(
  documentId: unknown
): Promise<StockDocumentDetail | null> {
  await requireUser()
  if (!isUuid(documentId)) return null
  return getStockDocument(documentId.toLowerCase())
}

/** Every 창고 > 구역 > 위치 (사용 and 사용중지) for pickers and the settings screen. */
export async function loadStockPlaces(): Promise<StockWarehouseNode[]> {
  await requireUser()
  return getStockPlaceTree()
}

/** The 재고 설정 (기한 임박 기준일). */
export async function loadInventorySettings(): Promise<InventorySettings> {
  await requireUser()
  return getInventorySettings()
}

/**
 * Products for a 전표 line picker (사용 products; 묶음상품 too when
 * `includeBundles`; 사용중지 기준상품 that still have stock too when
 * `includeInactiveWithStock` — 출고, 거래수불, filters, never 입고), 100 per
 * page ("더 보기" = offset).
 */
export async function searchProductsForStock(
  search: unknown,
  includeBundles: unknown,
  offset: unknown = 0,
  includeInactiveWithStock: unknown = false
): Promise<{ rows: StockProductOption[]; hasMore: boolean }> {
  await requireUser()
  return searchStockProducts(typeof search === "string" ? search : "", {
    includeBundles: includeBundles === true,
    offset: typeof offset === "number" ? offset : 0,
    includeInactiveWithStock: includeInactiveWithStock === true,
  })
}

/** Picker options of these products (e.g. to show saved lines). */
export async function loadStockProductOptions(
  ids: unknown
): Promise<StockProductOption[]> {
  await requireUser()
  const parsed = z.array(z.string()).max(500).safeParse(ids)
  if (!parsed.success) return []
  return getStockProductOptions(parsed.data.filter((id) => isUuid(id)))
}

/**
 * 과세구분 of these 기준상품 (id → "taxable" | "exempt"), for the 부가세
 * 별도 previews of 입고 단가 (a 묶음상품's share of each 기준상품 is shown
 * with that 기준상품's 과세구분, as the reports compute it). Unknown ids
 * and 묶음상품 are left out. At most 500 ids.
 */
export async function loadProductTaxTypes(
  ids: unknown
): Promise<Record<string, TaxType>> {
  await requireUser()
  const parsed = z.array(z.string()).max(500).safeParse(ids)
  if (!parsed.success) return {}
  const valid = [
    ...new Set(
      parsed.data.filter((id) => isUuid(id)).map((id) => id.toLowerCase())
    ),
  ]
  if (valid.length === 0) return {}
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("products")
    .select("id, tax_type")
    .in("id", valid)
    .eq("product_type", "base")
  if (error) {
    console.error("Could not read product tax types:", error)
    return {}
  }
  const result: Record<string, TaxType> = {}
  for (const row of data) {
    if (row.tax_type) result[row.id] = row.tax_type
  }
  return result
}

/**
 * Lots with stock for the 폐기 / 이동 pickers: the same rows and filters as
 * 재고처별 재고현황 (e.g. { expiry: "attention" } for 폐기, { locationId }
 * for the 이동 source).
 */
export async function loadLotStockOptions(
  params: unknown
): Promise<InventoryList<LotStockRow>> {
  await requireUser()
  const input = (params && typeof params === "object" ? params : {}) as Partial<
    Record<keyof LotStockParams, unknown>
  >
  const id = (value: unknown) =>
    isUuid(value) ? (value as string).toLowerCase() : null
  const options: LotStockParams = {
    ...defaultLotStockParams,
    warehouseId: id(input.warehouseId),
    zoneId: id(input.zoneId),
    locationId: id(input.locationId),
    productId: id(input.productId),
    q: typeof input.q === "string" ? input.q.trim().slice(0, 100) : "",
    expiry: (
      ["all", "attention", "expired", "imminent", "ok", "none"] as const
    ).includes(input.expiry as never)
      ? (input.expiry as LotStockParams["expiry"])
      : "all",
    mismatch: input.mismatch === true,
    page: typeof input.page === "number" ? input.page : 1,
    pageSize:
      input.pageSize === 300 || input.pageSize === 50 ? input.pageSize : 100,
    sort: input.sort === "expiry_date" ? "expiry_date" : "location",
  }
  return listLotStock(options)
}

/**
 * The checked rows of 재고처별 재고현황 (balanceId list) for the [이동] /
 * [폐기] buttons: fresh quantities; rows whose stock is gone are left out.
 */
export async function loadLotStockRows(
  balanceIds: unknown
): Promise<LotStockRow[]> {
  await requireUser()
  const parsed = z.array(z.string()).max(500).safeParse(balanceIds)
  if (!parsed.success) return []
  return getLotStockRows(
    parsed.data.filter((id) => isUuid(id)).map((id) => id.toLowerCase())
  )
}

/**
 * 거래처 for the 전표 header picker: `kind` "supplier" (입고: 매입처 /
 * 매출·매입) or "any" (출고). 사용 거래처 only, at most 100.
 */
export async function searchPartnersForStock(
  search: unknown,
  kind: unknown
): Promise<StockPartnerOption[]> {
  await requireUser()
  return searchStockPartners(
    typeof search === "string" ? search : "",
    kind === "supplier" ? "supplier" : "any"
  )
}

// ---------------------------------------------------------------------------
// 창고 · 구역 · 위치 · 설정
// ---------------------------------------------------------------------------

/** What the 창고·로케이션 설정 forms get back. */
export type StockPlaceResult =
  | { ok: true; id: string }
  | { ok: false; message: string; fieldErrors: Record<string, string> }

/** What a delete returns. */
export type StockPlaceDeleteResult =
  { ok: true } | { ok: false; message: string }

function placeSaveFailed(
  error: PostgrestError,
  what: "창고" | "구역" | "위치"
): StockPlaceResult {
  if (isInventoryNotReady(error)) {
    return { ok: false, message: INVENTORY_NOT_READY_MESSAGE, fieldErrors: {} }
  }
  const text = `${error.message} ${error.details ?? ""}`
  if (
    error.code === "23505" &&
    [
      INVENTORY_DB_CONSTRAINTS.warehouseCodeUnique,
      INVENTORY_DB_CONSTRAINTS.zoneCodeUnique,
      INVENTORY_DB_CONSTRAINTS.locationCodeUnique,
    ].some((name) => text.includes(name))
  ) {
    const message =
      what === "창고"
        ? "이미 사용 중인 창고코드입니다."
        : what === "구역"
          ? "이 창고에 같은 구역코드가 이미 있습니다."
          : "이 구역에 같은 위치코드가 이미 있습니다."
    return { ok: false, message, fieldErrors: { code: message } }
  }
  if (
    error.hint &&
    (Object.values(INVENTORY_DB_RULES) as string[]).includes(error.hint)
  ) {
    return { ok: false, message: error.message, fieldErrors: {} }
  }
  if (error.code === "23514") {
    return { ok: false, message: CHECK_INPUT_MESSAGE, fieldErrors: {} }
  }
  if (error.code === "42501") {
    return {
      ok: false,
      message: "저장할 권한이 없습니다. 다시 로그인해 주세요.",
      fieldErrors: {},
    }
  }
  console.error(`Could not save a ${what}:`, error)
  return {
    ok: false,
    message: `${what}를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.`,
    fieldErrors: {},
  }
}

function placeValidationFailed(error: z.ZodError): StockPlaceResult {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".")
    if (path && !fieldErrors[path]) fieldErrors[path] = issue.message
  }
  return {
    ok: false,
    message: error.issues[0]?.message ?? CHECK_INPUT_MESSAGE,
    fieldErrors,
  }
}

function placeDeleteFailed(
  error: PostgrestError,
  what: "창고" | "구역" | "위치"
): StockPlaceDeleteResult {
  if (error.code === "23503") {
    return {
      ok: false,
      message: `재고를 넣은 적이 있는 ${what}는 삭제할 수 없습니다. 쓰지 않으려면 사용중지로 바꿔 주세요.`,
    }
  }
  if (error.hint === INVENTORY_DB_RULES.locationDefaultFixed) {
    return { ok: false, message: error.message }
  }
  if (error.code === "42501") {
    return {
      ok: false,
      message: "삭제할 권한이 없습니다. 다시 로그인해 주세요.",
    }
  }
  console.error(`Could not delete a ${what}:`, error)
  return {
    ok: false,
    message: `${what}를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.`,
  }
}

function revalidatePlaces() {
  revalidatePath("/(app)/inventory", "layout")
  revalidatePath("/")
}

type StockPlaceTable = "warehouses" | "warehouse_zones" | "storage_locations"

/**
 * After an update that matched no row: the 창고 / 구역 / 위치 is gone, or
 * someone saved it after the form was opened (its updated_at changed).
 */
async function placeNotSaved(
  table: StockPlaceTable,
  id: string,
  what: "창고" | "구역" | "위치"
): Promise<StockPlaceResult> {
  const supabase = await createClient()
  const { data } = await supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .maybeSingle()
  return {
    ok: false,
    message: data
      ? `다른 직원이 이 ${what}를 먼저 바꿨습니다. 창을 닫고 목록을 새로 고친 뒤 다시 수정해 주세요. (저장하지 않았습니다.)`
      : `${what}를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.`,
    fieldErrors: {},
  }
}

/** The loadedUpdatedAt a 수정 form sends: a non-empty string. */
function isLoadedUpdatedAt(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value.length <= 64
}

/** 창고 등록 (input: WarehouseFormInput). New 창고 go to the end of the list. */
export async function createWarehouse(
  input: unknown
): Promise<StockPlaceResult> {
  await requireUser()
  const parsed = warehouseFormSchema.safeParse(input)
  if (!parsed.success) return placeValidationFailed(parsed.error)
  const values = parsed.data
  const supabase = await createClient()
  const { data: last } = await supabase
    .from("warehouses")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
  const { data, error } = await supabase
    .from("warehouses")
    .insert({
      code: values.code,
      name: values.name,
      postal_code: values.postalCode,
      address: values.address,
      address_detail: values.addressDetail,
      note: values.note,
      is_active: values.isActive,
      sort_order: (last?.[0]?.sort_order ?? 0) + 1,
    })
    .select("id")
    .single()
  if (error) return placeSaveFailed(error, "창고")
  revalidatePlaces()
  return { ok: true, id: data.id }
}

/**
 * 창고 수정. `loadedUpdatedAt` is the 창고's updatedAt when the form was
 * opened: if someone saved it after that, nothing is saved (the older form
 * would silently undo the other person's changes).
 */
export async function updateWarehouse(
  warehouseId: unknown,
  loadedUpdatedAt: unknown,
  input: unknown
): Promise<StockPlaceResult> {
  await requireUser()
  if (!isUuid(warehouseId)) {
    return { ok: false, message: "창고를 찾을 수 없습니다.", fieldErrors: {} }
  }
  if (!isLoadedUpdatedAt(loadedUpdatedAt)) {
    return placeNotSaved("warehouses", warehouseId.toLowerCase(), "창고")
  }
  const parsed = warehouseFormSchema.safeParse(input)
  if (!parsed.success) return placeValidationFailed(parsed.error)
  const values = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("warehouses")
    .update({
      code: values.code,
      name: values.name,
      postal_code: values.postalCode,
      address: values.address,
      address_detail: values.addressDetail,
      note: values.note,
      is_active: values.isActive,
    })
    .eq("id", warehouseId.toLowerCase())
    .eq("updated_at", loadedUpdatedAt)
    .select("id")
    .maybeSingle()
  if (error) return placeSaveFailed(error, "창고")
  if (!data)
    return placeNotSaved("warehouses", warehouseId.toLowerCase(), "창고")
  revalidatePlaces()
  return { ok: true, id: data.id }
}

/**
 * 창고 삭제 (with its 구역 and 위치) — only while nothing was ever stored
 * there; otherwise switch it off (사용중지).
 */
export async function deleteWarehouse(
  warehouseId: unknown
): Promise<StockPlaceDeleteResult> {
  await requireUser()
  if (!isUuid(warehouseId))
    return { ok: false, message: "창고를 찾을 수 없습니다." }
  const supabase = await createClient()
  const { error } = await supabase
    .from("warehouses")
    .delete()
    .eq("id", warehouseId.toLowerCase())
  if (error) return placeDeleteFailed(error, "창고")
  revalidatePlaces()
  return { ok: true }
}

/** 구역 등록 (input: ZoneFormInput); its "기본" 위치 is created with it. */
export async function createZone(input: unknown): Promise<StockPlaceResult> {
  await requireUser()
  const parsed = zoneFormSchema.safeParse(input)
  if (!parsed.success) return placeValidationFailed(parsed.error)
  const values = parsed.data
  const supabase = await createClient()
  const { data: last } = await supabase
    .from("warehouse_zones")
    .select("sort_order")
    .eq("warehouse_id", values.warehouseId)
    .order("sort_order", { ascending: false })
    .limit(1)
  const { data, error } = await supabase
    .from("warehouse_zones")
    .insert({
      warehouse_id: values.warehouseId,
      code: values.code,
      name: values.name,
      storage_type: values.storageType,
      note: values.note,
      is_active: values.isActive,
      sort_order: (last?.[0]?.sort_order ?? 0) + 1,
    })
    .select("id")
    .single()
  if (error) {
    if (error.code === "23503") {
      return { ok: false, message: "창고를 찾을 수 없습니다.", fieldErrors: {} }
    }
    return placeSaveFailed(error, "구역")
  }
  revalidatePlaces()
  return { ok: true, id: data.id }
}

/**
 * 구역 수정 (the 창고 never changes; warehouseId of the input is ignored).
 * Refused when someone saved the 구역 after the form was opened (see
 * updateWarehouse).
 */
export async function updateZone(
  zoneId: unknown,
  loadedUpdatedAt: unknown,
  input: unknown
): Promise<StockPlaceResult> {
  await requireUser()
  if (!isUuid(zoneId)) {
    return { ok: false, message: "구역을 찾을 수 없습니다.", fieldErrors: {} }
  }
  if (!isLoadedUpdatedAt(loadedUpdatedAt)) {
    return placeNotSaved("warehouse_zones", zoneId.toLowerCase(), "구역")
  }
  const parsed = zoneFormSchema.safeParse(input)
  if (!parsed.success) return placeValidationFailed(parsed.error)
  const values = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("warehouse_zones")
    .update({
      code: values.code,
      name: values.name,
      storage_type: values.storageType,
      note: values.note,
      is_active: values.isActive,
    })
    .eq("id", zoneId.toLowerCase())
    .eq("updated_at", loadedUpdatedAt)
    .select("id")
    .maybeSingle()
  if (error) return placeSaveFailed(error, "구역")
  if (!data)
    return placeNotSaved("warehouse_zones", zoneId.toLowerCase(), "구역")
  revalidatePlaces()
  return { ok: true, id: data.id }
}

/** 구역 삭제 (with its 위치) — only while nothing was ever stored there. */
export async function deleteZone(
  zoneId: unknown
): Promise<StockPlaceDeleteResult> {
  await requireUser()
  if (!isUuid(zoneId)) return { ok: false, message: "구역을 찾을 수 없습니다." }
  const supabase = await createClient()
  const { error } = await supabase
    .from("warehouse_zones")
    .delete()
    .eq("id", zoneId.toLowerCase())
  if (error) return placeDeleteFailed(error, "구역")
  revalidatePlaces()
  return { ok: true }
}

/** 위치 등록 (input: LocationFormInput). */
export async function createLocation(
  input: unknown
): Promise<StockPlaceResult> {
  await requireUser()
  const parsed = locationFormSchema.safeParse(input)
  if (!parsed.success) return placeValidationFailed(parsed.error)
  const values = parsed.data
  const supabase = await createClient()
  const { data: last } = await supabase
    .from("storage_locations")
    .select("sort_order")
    .eq("zone_id", values.zoneId)
    .order("sort_order", { ascending: false })
    .limit(1)
  const { data, error } = await supabase
    .from("storage_locations")
    .insert({
      zone_id: values.zoneId,
      code: values.code,
      name: values.name,
      is_active: values.isActive,
      sort_order: (last?.[0]?.sort_order ?? 0) + 1,
    })
    .select("id")
    .single()
  if (error) {
    if (error.code === "23503") {
      return { ok: false, message: "구역을 찾을 수 없습니다.", fieldErrors: {} }
    }
    return placeSaveFailed(error, "위치")
  }
  revalidatePlaces()
  return { ok: true, id: data.id }
}

/**
 * 위치 수정 (the 구역 and the 기본 mark never change). Refused when someone
 * saved the 위치 after the form was opened (see updateWarehouse).
 */
export async function updateLocation(
  locationId: unknown,
  loadedUpdatedAt: unknown,
  input: unknown
): Promise<StockPlaceResult> {
  await requireUser()
  if (!isUuid(locationId)) {
    return { ok: false, message: "위치를 찾을 수 없습니다.", fieldErrors: {} }
  }
  if (!isLoadedUpdatedAt(loadedUpdatedAt)) {
    return placeNotSaved("storage_locations", locationId.toLowerCase(), "위치")
  }
  const parsed = locationFormSchema.safeParse(input)
  if (!parsed.success) return placeValidationFailed(parsed.error)
  const values = parsed.data
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("storage_locations")
    .update({
      code: values.code,
      name: values.name,
      is_active: values.isActive,
    })
    .eq("id", locationId.toLowerCase())
    .eq("updated_at", loadedUpdatedAt)
    .select("id")
    .maybeSingle()
  if (error) return placeSaveFailed(error, "위치")
  if (!data)
    return placeNotSaved("storage_locations", locationId.toLowerCase(), "위치")
  revalidatePlaces()
  return { ok: true, id: data.id }
}

/**
 * The 사용 / 사용중지 switch of 창고·로케이션 설정: changes ONLY is_active of
 * one 창고, 구역 or 위치 (never the other columns, so a screen opened
 * earlier cannot undo another employee's changes of code, name or
 * 보관온도).
 */
export async function setStockPlaceActive(
  kind: unknown,
  placeId: unknown,
  isActive: unknown
): Promise<StockPlaceResult> {
  await requireUser()
  const target =
    kind === "warehouse"
      ? { table: "warehouses" as const, what: "창고" as const }
      : kind === "zone"
        ? { table: "warehouse_zones" as const, what: "구역" as const }
        : kind === "location"
          ? { table: "storage_locations" as const, what: "위치" as const }
          : null
  if (!target || !isUuid(placeId) || typeof isActive !== "boolean") {
    return {
      ok: false,
      message: "바꿀 항목을 다시 선택해 주세요.",
      fieldErrors: {},
    }
  }
  const supabase = await createClient()
  const { data, error } = await supabase
    .from(target.table)
    .update({ is_active: isActive })
    .eq("id", placeId.toLowerCase())
    .select("id")
    .maybeSingle()
  if (error) return placeSaveFailed(error, target.what)
  if (!data) {
    return {
      ok: false,
      message: `${target.what}를 찾을 수 없습니다. 목록을 새로 고쳐 주세요.`,
      fieldErrors: {},
    }
  }
  revalidatePlaces()
  return { ok: true, id: data.id }
}

/**
 * 위치 삭제 — only while nothing was ever stored there; the 구역's "기본"
 * 위치 can never be deleted.
 */
export async function deleteLocation(
  locationId: unknown
): Promise<StockPlaceDeleteResult> {
  await requireUser()
  if (!isUuid(locationId))
    return { ok: false, message: "위치를 찾을 수 없습니다." }
  const supabase = await createClient()
  const { error } = await supabase
    .from("storage_locations")
    .delete()
    .eq("id", locationId.toLowerCase())
  if (error) return placeDeleteFailed(error, "위치")
  revalidatePlaces()
  return { ok: true }
}

/**
 * Changes the display order of 창고, 구역 (of one 창고) or 위치 (of one
 * 구역): `ids` in their new order get sort_order 1, 2, 3 …
 */
export async function reorderStockPlaces(
  kind: unknown,
  ids: unknown
): Promise<StockPlaceDeleteResult> {
  await requireUser()
  const table =
    kind === "warehouse"
      ? "warehouses"
      : kind === "zone"
        ? "warehouse_zones"
        : kind === "location"
          ? "storage_locations"
          : null
  const parsed = z.array(z.string()).max(500).safeParse(ids)
  if (!table || !parsed.success || !parsed.data.every((id) => isUuid(id))) {
    return { ok: false, message: "순서를 바꿀 항목을 다시 선택해 주세요." }
  }
  const supabase = await createClient()
  for (const [index, id] of parsed.data.entries()) {
    const { error } = await supabase
      .from(table)
      .update({ sort_order: index + 1 })
      .eq("id", id.toLowerCase())
    if (error) {
      console.error("Could not reorder stock places:", error)
      return {
        ok: false,
        message: "순서를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      }
    }
  }
  revalidatePlaces()
  return { ok: true }
}

/** 재고 설정 저장 (input: InventorySettingsInput, 기한 임박 기준일 0–365). */
export async function updateInventorySettings(
  input: unknown
): Promise<
  | { ok: true }
  | { ok: false; message: string; fieldErrors: Record<string, string> }
> {
  await requireUser()
  const parsed = inventorySettingsSchema.safeParse(input)
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? CHECK_INPUT_MESSAGE
    return { ok: false, message, fieldErrors: { expiryWarningDays: message } }
  }
  const supabase = await createClient()
  const { error } = await supabase
    .from("app_settings")
    .update({ expiry_warning_days: parsed.data.expiryWarningDays })
    .eq("id", 1)
  if (error) {
    if (isInventoryNotReady(error)) {
      return {
        ok: false,
        message: INVENTORY_NOT_READY_MESSAGE,
        fieldErrors: {},
      }
    }
    console.error("Could not save the inventory settings:", error)
    return {
      ok: false,
      message: "설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      fieldErrors: {},
    }
  }
  revalidatePlaces()
  return { ok: true }
}
