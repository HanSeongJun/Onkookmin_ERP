import "server-only"

import type { PostgrestError } from "@supabase/supabase-js"
import { z } from "zod"

import {
  findCategory,
  findCategoryPath,
  formatCategoryPath,
} from "@/lib/categories/tree"
import type {
  DisposalReason,
  ExpiryKind,
  ExpiryStatus,
  StockDocumentType,
} from "@/lib/inventory/constants"
import {
  INVENTORY_EXPORT_MAX_ROWS,
  INVENTORY_PAGE_SIZES,
  sortState,
  type InventoryPageSize,
  type LotStockColumnId,
  type LotStockParams,
  type StockDocumentListParams,
  type StockLedgerParams,
  type StockReportColumnId,
  type StockReportParams,
} from "@/lib/inventory/schema"
import type { StorageType, TaxType } from "@/lib/products/constants"
import { getAllCategories, UNCATEGORIZED_LABEL } from "@/lib/products/queries"
import { createClient } from "@/lib/supabase/server"
import { Constants } from "@/types/database"

// The database reads of the 재고관리 screens. Every function reads request
// cookies (Supabase login): call them inside <Suspense>, a Route Handler or
// a Server Action, never inside "use cache". They throw on a database
// error; InventoryNotReadyError when the database has no 재고 tables or
// functions yet (the migration *_inventory.sql is not applied, e.g. the
// hosted DB before `npm run db:push`) — pages can show a friendly notice.

/** The database has no 재고관리 objects yet (migration not applied). */
export class InventoryNotReadyError extends Error {}

/** Korean notice for InventoryNotReadyError (for pages and actions). */
export const INVENTORY_NOT_READY_MESSAGE =
  "재고관리에 필요한 데이터베이스 변경이 아직 반영되지 않았습니다. 관리자가 DB 변경(npm run db:push)을 반영한 뒤 다시 열어 주세요."

/**
 * Error codes meaning "not there": PGRST202 = unknown function, PGRST205 =
 * unknown table or view, 42P01 / 42883 = the same from Postgres itself.
 */
const NOT_READY_CODES = ["PGRST202", "PGRST205", "42P01", "42883"]

/** Whether a database error means the 재고 migration is missing. */
export function isInventoryNotReady(error: { code?: string } | null): boolean {
  return !!error?.code && NOT_READY_CODES.includes(error.code)
}

function readFailed(what: string, error: PostgrestError): Error {
  const message = `${what}: ${error.message}`
  return isInventoryNotReady(error)
    ? new InventoryNotReadyError(message)
    : new Error(message)
}

/** Rows per request when reading everything (the API's limit). */
const PAGE_SIZE = 1000

/** Every row of a query, page by page (stable order needed). */
async function readAllRows<Row>(
  what: string,
  read: (
    from: number,
    to: number
  ) => PromiseLike<{ data: Row[] | null; error: PostgrestError | null }>,
  maxRows = Number.POSITIVE_INFINITY
): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; from < maxRows; from += PAGE_SIZE) {
    const { data, error } = await read(
      from,
      Math.min(from + PAGE_SIZE, maxRows) - 1
    )
    if (error) throw readFailed(what, error)
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE_SIZE) break
  }
  return rows
}

/**
 * The `or` filter "a.ilike.<pattern>,b.ilike.<pattern>" for a search text,
 * safe for any character (same technique as the 상품 list: LIKE wildcards
 * escaped, "*" → "_", the pattern quoted).
 */
function searchFilter(search: string, columns: readonly string[]): string {
  const likeText = search
    .replace(/[\\%_]/g, (character) => `\\${character}`)
    .replaceAll("*", "_")
  const quoted = `"%${likeText.replace(/["\\]/g, (character) => `\\${character}`)}%"`
  return columns.map((column) => `${column}.ilike.${quoted}`).join(",")
}

function pageCountOf(total: number, pageSize: number): number {
  return Math.max(Math.ceil(total / pageSize), 1)
}

function clampPageSize(pageSize: number): InventoryPageSize {
  return INVENTORY_PAGE_SIZES.includes(pageSize as InventoryPageSize)
    ? (pageSize as InventoryPageSize)
    : 100
}

/** A paged list. */
export type InventoryList<Row> = {
  rows: Row[]
  /** Rows matching the filters (all pages). */
  total: number
  /** The page shown (clamped to the last page). */
  page: number
  pageCount: number
}

// ---------------------------------------------------------------------------
// 재고 설정
// ---------------------------------------------------------------------------

export type InventorySettings = {
  /** 기한 임박 기준일: at most this many days left = 기한 임박. */
  expiryWarningDays: number
  updatedAt: string
}

export async function getInventorySettings(): Promise<InventorySettings> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("app_settings")
    .select("expiry_warning_days, updated_at")
    .eq("id", 1)
    .single()
  if (error) throw readFailed("재고 설정을 불러오지 못했습니다", error)
  return {
    expiryWarningDays: data.expiry_warning_days,
    updatedAt: data.updated_at,
  }
}

// ---------------------------------------------------------------------------
// 창고 > 구역 > 위치
// ---------------------------------------------------------------------------

export type StockLocationNode = {
  id: string
  zoneId: string
  code: string
  name: string | null
  /** The 구역's "기본" 위치 (cannot be deleted). */
  isDefault: boolean
  isActive: boolean
  sortOrder: number
  /** It, its 구역 and its 창고 are 사용: new stock may go in. */
  canReceive: boolean
  /** (lot × 위치) rows with stock now. */
  stockRowCount: number
  /** Stock was stored here at some time: it can no longer be deleted. */
  isUsed: boolean
  /** Last saved (the 수정 form sends it back: someone else saved meanwhile?). */
  updatedAt: string
}

export type StockZoneNode = {
  id: string
  warehouseId: string
  code: string
  name: string
  storageType: StorageType
  note: string | null
  isActive: boolean
  sortOrder: number
  stockRowCount: number
  /** One of its 위치 was used: the 구역 can no longer be deleted. */
  isUsed: boolean
  /** Last saved (see StockLocationNode.updatedAt). */
  updatedAt: string
  locations: StockLocationNode[]
}

export type StockWarehouseNode = {
  id: string
  code: string
  name: string
  postalCode: string | null
  address: string | null
  addressDetail: string | null
  note: string | null
  isActive: boolean
  sortOrder: number
  stockRowCount: number
  isUsed: boolean
  /** Last saved (see StockLocationNode.updatedAt). */
  updatedAt: string
  zones: StockZoneNode[]
}

/**
 * Every 창고 with its 구역 and 위치 (사용 and 사용중지), in screen order
 * (sort_order, then code), with their use (stock now / ever).
 */
export async function getStockPlaceTree(): Promise<StockWarehouseNode[]> {
  const supabase = await createClient()
  const [warehouses, zones, locations] = await Promise.all([
    readAllRows("창고를 불러오지 못했습니다", (from, to) =>
      supabase
        .from("warehouses")
        .select(
          "id, code, name, postal_code, address, address_detail, note, is_active, sort_order, updated_at"
        )
        .order("sort_order")
        .order("code")
        .order("id")
        .range(from, to)
    ),
    readAllRows("구역을 불러오지 못했습니다", (from, to) =>
      supabase
        .from("warehouse_zones")
        .select(
          "id, warehouse_id, code, name, storage_type, note, is_active, sort_order, updated_at"
        )
        .order("sort_order")
        .order("code")
        .order("id")
        .range(from, to)
    ),
    readAllRows("위치를 불러오지 못했습니다", (from, to) =>
      supabase
        .from("storage_location_items")
        .select(
          "location_id, zone_id, location_code, location_name, location_is_default, location_is_active, location_sort_order, location_updated_at, can_receive, stock_row_count, is_used"
        )
        .order("location_is_default", { ascending: false })
        .order("location_sort_order")
        .order("location_code")
        .order("location_id")
        .range(from, to)
    ),
  ])

  const locationsByZone = new Map<string, StockLocationNode[]>()
  for (const row of locations) {
    if (!row.location_id || !row.zone_id) continue
    const node: StockLocationNode = {
      id: row.location_id,
      zoneId: row.zone_id,
      code: row.location_code ?? "",
      name: row.location_name,
      isDefault: row.location_is_default ?? false,
      isActive: row.location_is_active ?? false,
      sortOrder: row.location_sort_order ?? 0,
      canReceive: row.can_receive ?? false,
      stockRowCount: row.stock_row_count ?? 0,
      isUsed: row.is_used ?? false,
      updatedAt: row.location_updated_at ?? "",
    }
    locationsByZone.set(row.zone_id, [
      ...(locationsByZone.get(row.zone_id) ?? []),
      node,
    ])
  }

  const zonesByWarehouse = new Map<string, StockZoneNode[]>()
  for (const zone of zones) {
    const zoneLocations = locationsByZone.get(zone.id) ?? []
    const node: StockZoneNode = {
      id: zone.id,
      warehouseId: zone.warehouse_id,
      code: zone.code,
      name: zone.name,
      storageType: zone.storage_type,
      note: zone.note,
      isActive: zone.is_active,
      sortOrder: zone.sort_order,
      stockRowCount: zoneLocations.reduce(
        (sum, location) => sum + location.stockRowCount,
        0
      ),
      isUsed: zoneLocations.some((location) => location.isUsed),
      updatedAt: zone.updated_at,
      locations: zoneLocations,
    }
    zonesByWarehouse.set(zone.warehouse_id, [
      ...(zonesByWarehouse.get(zone.warehouse_id) ?? []),
      node,
    ])
  }

  return warehouses.map((warehouse) => {
    const warehouseZones = zonesByWarehouse.get(warehouse.id) ?? []
    return {
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
      postalCode: warehouse.postal_code,
      address: warehouse.address,
      addressDetail: warehouse.address_detail,
      note: warehouse.note,
      isActive: warehouse.is_active,
      sortOrder: warehouse.sort_order,
      stockRowCount: warehouseZones.reduce(
        (sum, zone) => sum + zone.stockRowCount,
        0
      ),
      isUsed: warehouseZones.some((zone) => zone.isUsed),
      updatedAt: warehouse.updated_at,
      zones: warehouseZones,
    }
  })
}

// ---------------------------------------------------------------------------
// 재고처별 재고현황 (lot × 위치) — also the lot pickers of 폐기 / 이동
// ---------------------------------------------------------------------------

/** One (lot, 위치) with stock: a row of the view lot_stock_items. */
export type LotStockRow = {
  balanceId: string
  lotId: string
  locationId: string
  quantity: number
  productId: string
  productCode: string
  productName: string
  productSpec: string | null
  productUnit: string
  productStorageType: StorageType
  productTaxType: TaxType
  productIsActive: boolean
  lotNo: string
  supplierLotNo: string | null
  expiryKind: ExpiryKind
  expiryDate: string | null
  manufacturedDate: string | null
  receivedDate: string
  /** 기한일 − today (Korea); null without a 기한. */
  daysLeft: number | null
  expiryStatus: ExpiryStatus
  /** The lot's 입고 단가 (부가세 포함), or null. */
  unitCostInclVat: number | null
  /** 입고 단가, or the product's 기본 매입가 when the lot has none. */
  effectiveUnitCostInclVat: number | null
  /** The value uses the 기본 매입가 (no 입고 단가). */
  costEstimated: boolean
  /** round(quantity × cost), 부가세 포함; null when no cost is known. */
  valueInclVat: number | null
  valueExclVat: number | null
  supplierId: string | null
  supplierCode: string | null
  supplierName: string | null
  lotOrigin: string | null
  lotMemo: string | null
  warehouseId: string
  warehouseCode: string
  warehouseName: string
  warehouseIsActive: boolean
  zoneId: string
  zoneCode: string
  zoneName: string
  zoneStorageType: StorageType
  zoneIsActive: boolean
  locationCode: string
  locationName: string | null
  locationIsDefault: boolean
  locationIsActive: boolean
  /** The 구역's 보관온도 differs from the product's. */
  storageMismatch: boolean
  /** The 구역 is warmer than the product needs (dangerous). */
  storageTooWarm: boolean
}

type LotStockViewRow = {
  balance_id: string
  lot_id: string
  location_id: string
  quantity: number
  product_id: string
  product_code: string
  product_name: string
  product_spec: string | null
  product_unit: string
  product_storage_type: StorageType
  product_tax_type: TaxType
  product_is_active: boolean
  lot_no: string
  supplier_lot_no: string | null
  expiry_kind: ExpiryKind
  expiry_date: string | null
  manufactured_date: string | null
  received_date: string
  days_left: number | null
  expiry_status: ExpiryStatus
  unit_cost_incl_vat: number | null
  effective_unit_cost_incl_vat: number | null
  cost_estimated: boolean
  value_incl_vat: number | null
  value_excl_vat: number | null
  supplier_id: string | null
  supplier_code: string | null
  supplier_name: string | null
  lot_origin: string | null
  lot_memo: string | null
  warehouse_id: string
  warehouse_code: string
  warehouse_name: string
  warehouse_is_active: boolean
  zone_id: string
  zone_code: string
  zone_name: string
  zone_storage_type: StorageType
  zone_is_active: boolean
  location_code: string
  location_name: string | null
  location_is_default: boolean
  location_is_active: boolean
  storage_mismatch: boolean
  storage_too_warm: boolean
}

function toLotStockRow(row: LotStockViewRow): LotStockRow {
  return {
    balanceId: row.balance_id,
    lotId: row.lot_id,
    locationId: row.location_id,
    quantity: Number(row.quantity),
    productId: row.product_id,
    productCode: row.product_code,
    productName: row.product_name,
    productSpec: row.product_spec,
    productUnit: row.product_unit,
    productStorageType: row.product_storage_type,
    productTaxType: row.product_tax_type,
    productIsActive: row.product_is_active,
    lotNo: row.lot_no,
    supplierLotNo: row.supplier_lot_no,
    expiryKind: row.expiry_kind,
    expiryDate: row.expiry_date,
    manufacturedDate: row.manufactured_date,
    receivedDate: row.received_date,
    daysLeft: row.days_left,
    expiryStatus: row.expiry_status,
    unitCostInclVat: row.unit_cost_incl_vat,
    effectiveUnitCostInclVat: row.effective_unit_cost_incl_vat,
    costEstimated: row.cost_estimated,
    valueInclVat: row.value_incl_vat,
    valueExclVat: row.value_excl_vat,
    supplierId: row.supplier_id,
    supplierCode: row.supplier_code,
    supplierName: row.supplier_name,
    lotOrigin: row.lot_origin,
    lotMemo: row.lot_memo,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    warehouseIsActive: row.warehouse_is_active,
    zoneId: row.zone_id,
    zoneCode: row.zone_code,
    zoneName: row.zone_name,
    zoneStorageType: row.zone_storage_type,
    zoneIsActive: row.zone_is_active,
    locationCode: row.location_code,
    locationName: row.location_name,
    locationIsDefault: row.location_is_default,
    locationIsActive: row.location_is_active,
    storageMismatch: row.storage_mismatch,
    storageTooWarm: row.storage_too_warm,
  }
}

/** The view column(s) behind each sortable column. */
const LOT_STOCK_SORT_COLUMNS: Record<LotStockColumnId, string[]> = {
  location: [
    "warehouse_sort_order",
    "warehouse_code",
    "zone_sort_order",
    "zone_code",
    "location_sort_order",
    "location_code",
  ],
  product_code: ["product_code"],
  product_name: ["product_name"],
  lot_no: ["lot_no"],
  expiry_kind: ["expiry_kind"],
  expiry_date: ["expiry_date"],
  days_left: ["days_left"],
  quantity: ["quantity"],
  unit_cost: ["effective_unit_cost_incl_vat"],
  value_incl: ["value_incl_vat"],
  value_excl: ["value_excl_vat"],
  storage: ["product_storage_type"],
  received_date: ["received_date"],
  supplier: ["supplier_name"],
}

async function prepareLotStockQuery(params: LotStockParams) {
  const supabase = await createClient()
  function build({ countOnly = false, withCount = true } = {}) {
    let query = supabase.from("lot_stock_items").select("*", {
      count: withCount ? "exact" : undefined,
      head: countOnly,
    })
    if (params.locationId) query = query.eq("location_id", params.locationId)
    else if (params.zoneId) query = query.eq("zone_id", params.zoneId)
    else if (params.warehouseId) {
      query = query.eq("warehouse_id", params.warehouseId)
    }
    if (params.productId) query = query.eq("product_id", params.productId)
    if (params.q) {
      query = query.or(
        searchFilter(params.q, [
          "product_code",
          "product_name",
          "product_barcode",
          "lot_no",
          "supplier_lot_no",
        ])
      )
    }
    if (params.expiry === "attention") {
      query = query.in("expiry_status", ["expired", "imminent"])
    } else if (params.expiry !== "all") {
      query = query.eq("expiry_status", params.expiry)
    }
    if (params.mismatch) query = query.eq("storage_mismatch", true)
    if (params.storageType) {
      query = query.eq("product_storage_type", params.storageType)
    }
    const sort = sortState<LotStockColumnId>(params.sort)
    for (const column of LOT_STOCK_SORT_COLUMNS[sort.column]) {
      query = query.order(column, {
        ascending: sort.direction === "asc",
        nullsFirst: false,
      })
    }
    // Ties: product, 기한 (FEFO order), then the row itself.
    return query
      .order("product_code")
      .order("expiry_date", { nullsFirst: false })
      .order("lot_no")
      .order("balance_id")
  }
  return build
}

/**
 * One page of 재고처별 재고현황: the stock on hand per (lot, 위치), with
 * the filters of LotStockParams. A page past the end shows the last page.
 */
export async function listLotStock(
  params: LotStockParams
): Promise<InventoryList<LotStockRow>> {
  const build = await prepareLotStockQuery(params)
  const pageSize = clampPageSize(params.pageSize)
  const fetchPage = (page: number) =>
    build()
      .range((page - 1) * pageSize, page * pageSize - 1)
      .overrideTypes<LotStockViewRow[], { merge: false }>()

  let page = Math.max(Math.floor(params.page), 1)
  let result = await fetchPage(page)
  if (
    page > 1 &&
    (result.error?.code === "PGRST103" ||
      (!result.error && result.data.length === 0))
  ) {
    const { count, error } = await build({ countOnly: true })
    if (error) throw readFailed("재고를 불러오지 못했습니다", error)
    page = pageCountOf(count ?? 0, pageSize)
    result = await fetchPage(page)
  }
  if (result.error) throw readFailed("재고를 불러오지 못했습니다", result.error)
  const total = result.count ?? result.data.length
  return {
    rows: result.data.map(toLotStockRow),
    total,
    page,
    pageCount: pageCountOf(total, pageSize),
  }
}

/** Every row of 재고처별 재고현황 for the 엑셀 download (≤ 10,000). */
export async function listLotStockForExport(
  params: LotStockParams
): Promise<{ rows: LotStockRow[]; total: number }> {
  const build = await prepareLotStockQuery(params)
  const rows = await readAllRows(
    "재고를 불러오지 못했습니다",
    (from, to) =>
      build({ withCount: false })
        .range(from, to)
        .overrideTypes<LotStockViewRow[], { merge: false }>(),
    INVENTORY_EXPORT_MAX_ROWS
  )
  return { rows: rows.map(toLotStockRow), total: rows.length }
}

/**
 * These (lot, 위치) rows by their balanceId (e.g. the rows checked on
 * 재고처별 재고현황 for [이동] / [폐기]); rows whose stock is gone are left
 * out. At most 500.
 */
export async function getLotStockRows(
  balanceIds: readonly string[]
): Promise<LotStockRow[]> {
  if (balanceIds.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("lot_stock_items")
    .select("*")
    .in("balance_id", [...balanceIds].slice(0, 500))
    .order("product_code")
    .order("expiry_date", { nullsFirst: false })
    .overrideTypes<LotStockViewRow[], { merge: false }>()
  if (error) throw readFailed("재고를 불러오지 못했습니다", error)
  return data.map(toLotStockRow)
}

// ---------------------------------------------------------------------------
// 거래처 picker of the 전표 screens
// ---------------------------------------------------------------------------

/** A 거래처 a 전표 can pick. */
export type StockPartnerOption = {
  id: string
  code: string
  name: string
  partnerType: "sales" | "purchase" | "both"
}

/**
 * 사용 거래처 whose 거래처코드 or 거래처명 contains `search`, 거래처코드
 * order, at most 100: `kind` "supplier" (입고: 매입처 and 매출·매입) or
 * "any" (출고: every kind, e.g. a 매입처 for 반품).
 */
export async function searchStockPartners(
  search: string,
  kind: "supplier" | "any"
): Promise<StockPartnerOption[]> {
  const supabase = await createClient()
  let query = supabase
    .from("partners")
    .select("id, code, name, partner_type")
    .eq("is_active", true)
  if (kind === "supplier")
    query = query.in("partner_type", ["purchase", "both"])
  const text = search.trim().slice(0, 100)
  if (text) query = query.or(searchFilter(text, ["code", "name"]))
  const { data, error } = await query.order("code").order("id").limit(100)
  if (error) throw readFailed("거래처를 불러오지 못했습니다", error)
  return data.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    partnerType: row.partner_type,
  }))
}

// ---------------------------------------------------------------------------
// 상품별 재고현황 (period report)
// ---------------------------------------------------------------------------

const reportRowSchema = z.object({
  product_id: z.string(),
  code: z.string(),
  name: z.string(),
  spec: z.string().nullable(),
  unit: z.string(),
  barcode: z.string().nullable(),
  category_id: z.string().nullable(),
  storage_type: z.enum(Constants.public.Enums.storage_type),
  tax_type: z.enum(Constants.public.Enums.tax_type),
  is_active: z.boolean(),
  purchase_price_incl_vat: z.number().nullable(),
  opening_qty: z.number(),
  receipt_qty: z.number(),
  opening_stock_qty: z.number(),
  issue_qty: z.number(),
  adjust_in_qty: z.number(),
  adjust_out_qty: z.number(),
  disposal_qty: z.number(),
  transfer_in_qty: z.number(),
  transfer_out_qty: z.number(),
  closing_qty: z.number(),
  closing_value_incl_vat: z.number().nullable(),
  closing_value_excl_vat: z.number().nullable(),
  closing_unit_cost_incl_vat: z.number().nullable(),
  cost_estimated: z.boolean(),
  cost_missing: z.boolean(),
  lot_count: z.number(),
  nearest_expiry_date: z.string().nullable(),
  nearest_expiry_kind: z.enum(Constants.public.Enums.expiry_kind).nullable(),
})

const reportSchema = z.object({
  date_from: z.string(),
  date_to: z.string(),
  rows: z.array(reportRowSchema),
})

/** One 기준상품 of 상품별 재고현황 (quantities in the product's 단위). */
export type StockReportRow = {
  productId: string
  code: string
  name: string
  spec: string | null
  unit: string
  barcode: string | null
  categoryId: string | null
  /** "대분류 > 중분류 > 소분류" or "미분류". */
  categoryPath: string
  storageType: StorageType
  taxType: TaxType
  isActive: boolean
  purchasePriceInclVat: number | null
  /** 이월재고: stock at the end of the day before `from`. */
  openingQty: number
  /** 입고 in the period (취소 counted as minus). */
  receiptQty: number
  /** 기초재고 registered in the period. */
  openingStockQty: number
  /** 입고 column of the screen: receiptQty + openingStockQty. */
  inboundQty: number
  /** 출고 (quantity that went out; a 출고취소 lowers it). */
  issueQty: number
  /** 실사조정 + / −. */
  adjustInQty: number
  adjustOutQty: number
  /** 조정 column: adjustInQty − adjustOutQty. */
  adjustNetQty: number
  /** 폐기. */
  disposalQty: number
  /** 이동 into / out of the scope (equal for all 창고). */
  transferInQty: number
  transferOutQty: number
  /** 이동 column: transferInQty − transferOutQty (0 for all 창고). */
  transferNetQty: number
  /** 기말재고 = 이월 + 입고 − 출고 + 조정 − 폐기 + 이동. */
  closingQty: number
  /** 재고금액 at the end (부가세 포함); null = no cost known for any lot. */
  closingValueInclVat: number | null
  closingValueExclVat: number | null
  /** 재고단가 = weighted average over the lots with a cost; null when none. */
  closingUnitCostInclVat: number | null
  /** Part of the value uses the 기본 매입가 (lots without 입고 단가). */
  costEstimated: boolean
  /** Some stock has neither 입고 단가 nor 기본 매입가 (counted as 0). */
  costMissing: boolean
  lotCount: number
  /** The earliest 기한 of the stock left at the end (D-day badge). */
  nearestExpiryDate: string | null
  nearestExpiryKind: ExpiryKind | null
}

/** The 총계 row. Quantities of different 단위 are simply added up. */
export type StockReportTotals = {
  productCount: number
  openingQty: number
  inboundQty: number
  issueQty: number
  adjustNetQty: number
  disposalQty: number
  transferNetQty: number
  closingQty: number
  closingValueInclVat: number
  closingValueExclVat: number
  costEstimated: boolean
  costMissing: boolean
}

export type StockReport = InventoryList<StockReportRow> & {
  dateFrom: string
  dateTo: string
  totals: StockReportTotals
}

/** The number behind each sortable report column. */
function reportSortValue(
  row: StockReportRow,
  column: StockReportColumnId
): string | number | null {
  switch (column) {
    case "code":
      return row.code
    case "name":
      return row.name
    case "spec":
      return row.spec
    case "unit":
      return row.unit
    case "opening":
      return row.openingQty
    case "receipt":
      return row.inboundQty
    case "issue":
      return row.issueQty
    case "adjust":
      return row.adjustNetQty
    case "disposal":
      return row.disposalQty
    case "transfer":
      return row.transferNetQty
    case "closing":
      return row.closingQty
    case "unit_cost":
      return row.closingUnitCostInclVat
    case "value_incl":
      return row.closingValueInclVat
    case "value_excl":
      return row.closingValueExclVat
    case "expiry":
      return row.nearestExpiryDate
    case "storage":
      return ["room", "chilled", "frozen"].indexOf(row.storageType)
  }
}

function compareValues(
  a: string | number | null,
  b: string | number | null
): number {
  if (a === null && b === null) return 0
  if (a === null) return 1
  if (b === null) return -1
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b), "ko-KR")
}

/** Calls stock_period_report and turns its JSON into rows (all of them). */
async function readStockReport(params: StockReportParams): Promise<{
  dateFrom: string
  dateTo: string
  rows: StockReportRow[]
}> {
  const supabase = await createClient()
  const categories = await getAllCategories()
  const categoryId =
    params.categoryId && findCategory(categories, params.categoryId)
      ? params.categoryId
      : null
  const { data, error } = await supabase.rpc("stock_period_report", {
    date_from: params.from,
    date_to: params.to,
    filter_warehouse_id: params.zoneId
      ? undefined
      : (params.warehouseId ?? undefined),
    filter_zone_id: params.zoneId ?? undefined,
    search_text: params.q || undefined,
    filter_category_id: params.uncategorized
      ? undefined
      : (categoryId ?? undefined),
    only_uncategorized: params.uncategorized,
    filter_tax_type: params.taxType ?? undefined,
    filter_storage_type: params.storageType ?? undefined,
    product_status: params.productStatus,
    only_with_stock: params.withStock,
  })
  if (error) throw readFailed("재고현황을 불러오지 못했습니다", error)
  const report = reportSchema.parse(data)
  return {
    dateFrom: report.date_from,
    dateTo: report.date_to,
    rows: report.rows.map((row) => ({
      productId: row.product_id,
      code: row.code,
      name: row.name,
      spec: row.spec,
      unit: row.unit,
      barcode: row.barcode,
      categoryId: row.category_id,
      categoryPath:
        row.category_id === null
          ? UNCATEGORIZED_LABEL
          : formatCategoryPath(findCategoryPath(categories, row.category_id)) ||
            "-",
      storageType: row.storage_type,
      taxType: row.tax_type,
      isActive: row.is_active,
      purchasePriceInclVat: row.purchase_price_incl_vat,
      openingQty: row.opening_qty,
      receiptQty: row.receipt_qty,
      openingStockQty: row.opening_stock_qty,
      inboundQty: round3(row.receipt_qty + row.opening_stock_qty),
      issueQty: row.issue_qty,
      adjustInQty: row.adjust_in_qty,
      adjustOutQty: row.adjust_out_qty,
      adjustNetQty: round3(row.adjust_in_qty - row.adjust_out_qty),
      disposalQty: row.disposal_qty,
      transferInQty: row.transfer_in_qty,
      transferOutQty: row.transfer_out_qty,
      transferNetQty: round3(row.transfer_in_qty - row.transfer_out_qty),
      closingQty: row.closing_qty,
      closingValueInclVat: row.closing_value_incl_vat,
      closingValueExclVat: row.closing_value_excl_vat,
      closingUnitCostInclVat: row.closing_unit_cost_incl_vat,
      costEstimated: row.cost_estimated,
      costMissing: row.cost_missing,
      lotCount: row.lot_count,
      nearestExpiryDate: row.nearest_expiry_date,
      nearestExpiryKind: row.nearest_expiry_kind,
    })),
  }
}

/** Sums and differences of quantities with at most 3 decimals, without float dust. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function reportTotals(rows: StockReportRow[]): StockReportTotals {
  const sum = (pick: (row: StockReportRow) => number | null) =>
    round3(rows.reduce((total, row) => total + (pick(row) ?? 0), 0))
  return {
    productCount: rows.length,
    openingQty: sum((row) => row.openingQty),
    inboundQty: sum((row) => row.inboundQty),
    issueQty: sum((row) => row.issueQty),
    adjustNetQty: sum((row) => row.adjustNetQty),
    disposalQty: sum((row) => row.disposalQty),
    transferNetQty: sum((row) => row.transferNetQty),
    closingQty: sum((row) => row.closingQty),
    closingValueInclVat: sum((row) => row.closingValueInclVat),
    closingValueExclVat: sum((row) => row.closingValueExclVat),
    costEstimated: rows.some((row) => row.costEstimated),
    costMissing: rows.some((row) => row.costMissing),
  }
}

function sortReportRows(
  rows: StockReportRow[],
  params: StockReportParams
): StockReportRow[] {
  const sort = sortState<StockReportColumnId>(params.sort)
  const factor = sort.direction === "asc" ? 1 : -1
  return [...rows].sort((a, b) => {
    const first = reportSortValue(a, sort.column)
    const second = reportSortValue(b, sort.column)
    // Empty values last whatever the direction; ties by 상품코드.
    if (first === null || second === null) {
      const result = compareValues(first, second)
      if (result !== 0) return result
    } else {
      const result = compareValues(first, second) * factor
      if (result !== 0) return result
    }
    return a.code.localeCompare(b.code, "ko-KR")
  })
}

/**
 * 상품별 재고현황 for a period (all 기준상품 matching the filters, sorted,
 * one page of them) with the 총계 of ALL matching rows.
 */
export async function getStockPeriodReport(
  params: StockReportParams
): Promise<StockReport> {
  const report = await readStockReport(params)
  const sorted = sortReportRows(report.rows, params)
  const pageSize = clampPageSize(params.pageSize)
  const pageCount = pageCountOf(sorted.length, pageSize)
  const page = Math.min(Math.max(Math.floor(params.page), 1), pageCount)
  return {
    dateFrom: report.dateFrom,
    dateTo: report.dateTo,
    rows: sorted.slice((page - 1) * pageSize, page * pageSize),
    total: sorted.length,
    page,
    pageCount,
    totals: reportTotals(sorted),
  }
}

/** Every row of 상품별 재고현황 (sorted) and the 총계, for the 엑셀 download. */
export async function getStockPeriodReportForExport(
  params: StockReportParams
): Promise<{
  dateFrom: string
  dateTo: string
  rows: StockReportRow[]
  totals: StockReportTotals
}> {
  const report = await readStockReport(params)
  const sorted = sortReportRows(report.rows, params).slice(
    0,
    INVENTORY_EXPORT_MAX_ROWS
  )
  return {
    dateFrom: report.dateFrom,
    dateTo: report.dateTo,
    rows: sorted,
    totals: reportTotals(sorted),
  }
}

// ---------------------------------------------------------------------------
// 상품별 거래수불
// ---------------------------------------------------------------------------

const ledgerSchema = z.object({
  product: z.object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    spec: z.string().nullable(),
    unit: z.string(),
    product_type: z.enum(Constants.public.Enums.product_type),
    storage_type: z.enum(Constants.public.Enums.storage_type).nullable(),
    tax_type: z.enum(Constants.public.Enums.tax_type).nullable(),
    is_active: z.boolean(),
  }),
  date_from: z.string(),
  date_to: z.string(),
  opening_qty: z.number(),
  in_qty: z.number(),
  out_qty: z.number(),
  closing_qty: z.number(),
  summary: z.object({
    receipt_qty: z.number(),
    opening_stock_qty: z.number(),
    issue_qty: z.number(),
    disposal_qty: z.number(),
    adjust_in_qty: z.number(),
    adjust_out_qty: z.number(),
    transfer_in_qty: z.number(),
    transfer_out_qty: z.number(),
  }),
  lines: z.array(
    z.object({
      movement_id: z.string(),
      seq: z.number(),
      doc_date: z.string(),
      document_id: z.string(),
      doc_no: z.string(),
      doc_type: z.enum(Constants.public.Enums.stock_document_type),
      movement_type: z.enum(Constants.public.Enums.stock_document_type),
      is_reversal: z.boolean(),
      line_no: z.number(),
      partner_code: z.string().nullable(),
      partner_name: z.string().nullable(),
      lot_id: z.string(),
      lot_no: z.string(),
      expiry_kind: z.enum(Constants.public.Enums.expiry_kind),
      expiry_date: z.string().nullable(),
      location_id: z.string(),
      location_code: z.string(),
      location_name: z.string().nullable(),
      zone_code: z.string(),
      zone_name: z.string(),
      warehouse_code: z.string(),
      warehouse_name: z.string(),
      in_qty: z.number(),
      out_qty: z.number(),
      balance: z.number(),
      unit_cost_incl_vat: z.number().nullable(),
      reason: z.enum(Constants.public.Enums.disposal_reason).nullable(),
      memo: z.string().nullable(),
      bundle_code: z.string().nullable(),
      bundle_name: z.string().nullable(),
      created_at: z.string(),
    })
  ),
})

/** One line of 상품별 거래수불 (in date order, then saving order). */
export type StockLedgerLine = {
  movementId: string
  seq: number
  docDate: string
  documentId: string
  docNo: string
  /** The 전표's own kind ("reversal" for a 취소 전표). */
  docType: StockDocumentType
  /** The kind it counts as (a 취소 line: the kind it undoes). */
  movementType: StockDocumentType
  isReversal: boolean
  lineNo: number
  partnerCode: string | null
  partnerName: string | null
  lotId: string
  lotNo: string
  expiryKind: ExpiryKind
  expiryDate: string | null
  locationId: string
  locationCode: string
  locationName: string | null
  zoneCode: string
  zoneName: string
  warehouseCode: string
  warehouseName: string
  inQty: number
  outQty: number
  /** 잔량 after this line (from the 이월). */
  balance: number
  unitCostInclVat: number | null
  reason: DisposalReason | null
  /** The line's memo, else the 전표's. */
  memo: string | null
  bundleCode: string | null
  bundleName: string | null
  createdAt: string
}

export type StockLedger = {
  product: {
    id: string
    code: string
    name: string
    spec: string | null
    unit: string
    productType: "base" | "bundle"
    storageType: StorageType | null
    taxType: TaxType | null
    isActive: boolean
  }
  dateFrom: string
  dateTo: string
  /** 이월: stock at the end of the day before dateFrom. */
  openingQty: number
  /** Σ of the 입고 column: every + line (폐기·이동·조정 취소 included). */
  inQty: number
  /** Σ of the 출고 column: every − line (폐기, 이동 out, 조정 − included). */
  outQty: number
  closingQty: number
  /**
   * The period by kind, counted exactly like 상품별 재고현황
   * (stock_period_report): 입고 (+ 기초재고), 출고, 조정 (net), 폐기,
   * 이동 (net; 0 when no 창고·구역·위치 is chosen). A 취소 lowers the kind
   * it undoes. 이월 + inbound − issue + adjustNet − disposal + transferNet
   * = 기말.
   */
  summary: {
    inboundQty: number
    issueQty: number
    adjustNetQty: number
    disposalQty: number
    transferNetQty: number
  }
  lines: StockLedgerLine[]
}

/** 상품별 거래수불 of one 기준상품, or null when no product is chosen. */
export async function getProductStockLedger(
  params: StockLedgerParams
): Promise<StockLedger | null> {
  if (!params.productId) return null
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("product_stock_ledger", {
    target_product_id: params.productId,
    date_from: params.from,
    date_to: params.to,
    filter_warehouse_id:
      params.zoneId || params.locationId
        ? undefined
        : (params.warehouseId ?? undefined),
    filter_zone_id: params.locationId
      ? undefined
      : (params.zoneId ?? undefined),
    filter_location_id: params.locationId ?? undefined,
  })
  if (error) {
    if (error.hint === "stock_product_not_found") return null
    throw readFailed("거래수불을 불러오지 못했습니다", error)
  }
  const ledger = ledgerSchema.parse(data)
  return {
    product: {
      id: ledger.product.id,
      code: ledger.product.code,
      name: ledger.product.name,
      spec: ledger.product.spec,
      unit: ledger.product.unit,
      productType: ledger.product.product_type,
      storageType: ledger.product.storage_type,
      taxType: ledger.product.tax_type,
      isActive: ledger.product.is_active,
    },
    dateFrom: ledger.date_from,
    dateTo: ledger.date_to,
    openingQty: ledger.opening_qty,
    inQty: ledger.in_qty,
    outQty: ledger.out_qty,
    closingQty: ledger.closing_qty,
    summary: {
      inboundQty: round3(
        ledger.summary.receipt_qty + ledger.summary.opening_stock_qty
      ),
      issueQty: ledger.summary.issue_qty,
      adjustNetQty: round3(
        ledger.summary.adjust_in_qty - ledger.summary.adjust_out_qty
      ),
      disposalQty: ledger.summary.disposal_qty,
      transferNetQty: round3(
        ledger.summary.transfer_in_qty - ledger.summary.transfer_out_qty
      ),
    },
    lines: ledger.lines.map((line) => ({
      movementId: line.movement_id,
      seq: line.seq,
      docDate: line.doc_date,
      documentId: line.document_id,
      docNo: line.doc_no,
      docType: line.doc_type,
      movementType: line.movement_type,
      isReversal: line.is_reversal,
      lineNo: line.line_no,
      partnerCode: line.partner_code,
      partnerName: line.partner_name,
      lotId: line.lot_id,
      lotNo: line.lot_no,
      expiryKind: line.expiry_kind,
      expiryDate: line.expiry_date,
      locationId: line.location_id,
      locationCode: line.location_code,
      locationName: line.location_name,
      zoneCode: line.zone_code,
      zoneName: line.zone_name,
      warehouseCode: line.warehouse_code,
      warehouseName: line.warehouse_name,
      inQty: line.in_qty,
      outQty: line.out_qty,
      balance: line.balance,
      unitCostInclVat: line.unit_cost_incl_vat,
      reason: line.reason,
      memo: line.memo,
      bundleCode: line.bundle_code,
      bundleName: line.bundle_name,
      createdAt: line.created_at,
    })),
  }
}

// ---------------------------------------------------------------------------
// 전표 lists and one 전표
// ---------------------------------------------------------------------------

/** One 전표 of a list (view stock_document_list_items). */
export type StockDocumentRow = {
  id: string
  docType: StockDocumentType
  /** The kind, or for a 취소 전표 the kind it undoes. */
  effectiveType: StockDocumentType
  docNo: string
  docDate: string
  partnerId: string | null
  partnerCode: string | null
  partnerName: string | null
  memo: string | null
  /** 취소 전표: the 전표 it undoes. */
  reversesId: string | null
  reversesDocNo: string | null
  /** Undone by this 취소 전표 (then it cannot be undone again). */
  reversedById: string | null
  reversedByDocNo: string | null
  reversedAt: string | null
  /** Lines on the screen. */
  lineCount: number
  /** Ledger lines (묶음상품 and FEFO split lines). */
  movementCount: number
  productCount: number
  firstProductCode: string | null
  /** For "<상품명> 외 N건". */
  firstProductName: string | null
  /** Value in / out (수량 × 로트 입고 단가, 부가세 포함; lots without cost left out). */
  valueInInclVat: number
  valueOutInclVat: number
  costUnknown: boolean
  createdAt: string
  createdBy: string | null
}

type StockDocumentViewRow = {
  id: string
  doc_type: StockDocumentType
  effective_type: StockDocumentType
  doc_no: string
  doc_date: string
  partner_id: string | null
  partner_code: string | null
  partner_name: string | null
  memo: string | null
  reverses_id: string | null
  reverses_doc_no: string | null
  reversed_by_id: string | null
  reversed_by_doc_no: string | null
  reversed_at: string | null
  line_count: number
  movement_count: number
  product_count: number
  first_product_code: string | null
  first_product_name: string | null
  value_in_incl_vat: number
  value_out_incl_vat: number
  cost_unknown: boolean
  created_at: string
  created_by: string | null
}

const DOCUMENT_LIST_COLUMNS =
  "id, doc_type, effective_type, doc_no, doc_date, partner_id, partner_code, partner_name, memo, reverses_id, reverses_doc_no, reversed_by_id, reversed_by_doc_no, reversed_at, line_count, movement_count, product_count, first_product_code, first_product_name, value_in_incl_vat, value_out_incl_vat, cost_unknown, created_at, created_by"

function toStockDocumentRow(row: StockDocumentViewRow): StockDocumentRow {
  return {
    id: row.id,
    docType: row.doc_type,
    effectiveType: row.effective_type,
    docNo: row.doc_no,
    docDate: row.doc_date,
    partnerId: row.partner_id,
    partnerCode: row.partner_code,
    partnerName: row.partner_name,
    memo: row.memo,
    reversesId: row.reverses_id,
    reversesDocNo: row.reverses_doc_no,
    reversedById: row.reversed_by_id,
    reversedByDocNo: row.reversed_by_doc_no,
    reversedAt: row.reversed_at,
    lineCount: row.line_count,
    movementCount: row.movement_count,
    productCount: row.product_count,
    firstProductCode: row.first_product_code,
    firstProductName: row.first_product_name,
    valueInInclVat: Number(row.value_in_incl_vat),
    valueOutInclVat: Number(row.value_out_incl_vat),
    costUnknown: row.cost_unknown,
    createdAt: row.created_at,
    createdBy: row.created_by,
  }
}

async function prepareDocumentQuery(
  types: readonly StockDocumentType[],
  params: StockDocumentListParams
) {
  const supabase = await createClient()
  function build({ countOnly = false, withCount = true } = {}) {
    let query = supabase
      .from("stock_document_list_items")
      .select(DOCUMENT_LIST_COLUMNS, {
        count: withCount ? "exact" : undefined,
        head: countOnly,
      })
      .in("effective_type", [...types])
      .gte("doc_date", params.from)
      .lte("doc_date", params.to)
    if (!params.includeReversals) query = query.neq("doc_type", "reversal")
    if (params.status === "active") {
      query = query.is("reversed_by_id", null).neq("doc_type", "reversal")
    } else if (params.status === "reversed") {
      query = query.not("reversed_by_id", "is", null)
    }
    if (params.partnerId) query = query.eq("partner_id", params.partnerId)
    if (params.productId) {
      query = query.contains("product_ids", [params.productId])
    }
    if (params.q) {
      query = query.or(
        searchFilter(params.q, [
          "doc_no",
          "search_text",
          "partner_name",
          "memo",
        ])
      )
    }
    return query
      .order("doc_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("doc_no", { ascending: false })
  }
  return build
}

/**
 * One page of a 전표 list: the 전표 whose kind (for 취소 전표: the kind they
 * undo) is one of `types`, newest first.
 */
export async function listStockDocuments(
  types: readonly StockDocumentType[],
  params: StockDocumentListParams
): Promise<InventoryList<StockDocumentRow>> {
  const build = await prepareDocumentQuery(types, params)
  const pageSize = clampPageSize(params.pageSize)
  const fetchPage = (page: number) =>
    build()
      .range((page - 1) * pageSize, page * pageSize - 1)
      .overrideTypes<StockDocumentViewRow[], { merge: false }>()
  let page = Math.max(Math.floor(params.page), 1)
  let result = await fetchPage(page)
  if (
    page > 1 &&
    (result.error?.code === "PGRST103" ||
      (!result.error && result.data.length === 0))
  ) {
    const { count, error } = await build({ countOnly: true })
    if (error) throw readFailed("전표를 불러오지 못했습니다", error)
    page = pageCountOf(count ?? 0, pageSize)
    result = await fetchPage(page)
  }
  if (result.error) throw readFailed("전표를 불러오지 못했습니다", result.error)
  const total = result.count ?? result.data.length
  return {
    rows: result.data.map(toStockDocumentRow),
    total,
    page,
    pageCount: pageCountOf(total, pageSize),
  }
}

/** Every 전표 of a list for the 엑셀 download (≤ 10,000). */
export async function listStockDocumentsForExport(
  types: readonly StockDocumentType[],
  params: StockDocumentListParams
): Promise<{ rows: StockDocumentRow[]; total: number }> {
  const build = await prepareDocumentQuery(types, params)
  const rows = await readAllRows(
    "전표를 불러오지 못했습니다",
    (from, to) =>
      build({ withCount: false })
        .range(from, to)
        .overrideTypes<StockDocumentViewRow[], { merge: false }>(),
    INVENTORY_EXPORT_MAX_ROWS
  )
  return { rows: rows.map(toStockDocumentRow), total: rows.length }
}

/** One ledger line of a 전표 (view stock_movement_items). */
export type StockDocumentLine = {
  id: string
  seq: number
  /** The 전표 screen's line number (lines split by 묶음상품 / FEFO share it). */
  lineNo: number
  lotId: string
  lotNo: string
  supplierLotNo: string | null
  expiryKind: ExpiryKind
  expiryDate: string | null
  manufacturedDate: string | null
  receivedDate: string
  productId: string
  productCode: string
  productName: string
  productSpec: string | null
  productUnit: string
  productStorageType: StorageType
  /** The 묶음상품 the line came from (입고/출고 of a 묶음상품). */
  bundleId: string | null
  bundleCode: string | null
  bundleName: string | null
  bundleUnit: string | null
  bundleQuantity: number | null
  /**
   * 입고 of a 묶음상품: the 단가 typed per 묶음상품 (부가세 포함). The 전표's
   * total uses bundleQuantity × this, once per line (the 기준상품 lots'
   * 단가 are its whole-won shares, see splitBundleUnitCost).
   */
  bundleUnitCostInclVat: number | null
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
  /** + in, − out (product's 단위). */
  quantityDelta: number
  unitCostInclVat: number | null
  /** |수량| × 단가 (부가세 포함 / 별도); null without a cost. */
  amountInclVat: number | null
  amountExclVat: number | null
  reason: DisposalReason | null
  memo: string | null
  isReversal: boolean
}

type MovementViewRow = {
  id: string
  seq: number
  line_no: number
  lot_id: string
  lot_no: string
  supplier_lot_no: string | null
  expiry_kind: ExpiryKind
  expiry_date: string | null
  manufactured_date: string | null
  received_date: string
  product_id: string
  product_code: string
  product_name: string
  product_spec: string | null
  product_unit: string
  product_storage_type: StorageType
  bundle_id: string | null
  bundle_code: string | null
  bundle_name: string | null
  bundle_unit: string | null
  bundle_quantity: number | null
  bundle_unit_cost_incl_vat: number | null
  location_id: string
  location_code: string
  location_name: string | null
  zone_id: string
  zone_code: string
  zone_name: string
  zone_storage_type: StorageType
  warehouse_id: string
  warehouse_code: string
  warehouse_name: string
  quantity_delta: number
  unit_cost_incl_vat: number | null
  amount_incl_vat: number | null
  amount_excl_vat: number | null
  reason: DisposalReason | null
  memo: string | null
  is_reversal: boolean
}

export type StockDocumentDetail = StockDocumentRow & {
  lines: StockDocumentLine[]
  /** [취소] is offered: not a 취소 전표 and not undone yet. */
  canReverse: boolean
}

/** One 전표 with all its lines, or null when there is none. */
export async function getStockDocument(
  documentId: string
): Promise<StockDocumentDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("stock_document_list_items")
    .select(DOCUMENT_LIST_COLUMNS)
    .eq("id", documentId)
    .overrideTypes<StockDocumentViewRow[], { merge: false }>()
  if (error) throw readFailed("전표를 불러오지 못했습니다", error)
  const header = data[0]
  if (!header) return null
  const lines = await readAllRows(
    "전표 내용을 불러오지 못했습니다",
    (from, to) =>
      supabase
        .from("stock_movement_items")
        .select(
          "id, seq, line_no, lot_id, lot_no, supplier_lot_no, expiry_kind, expiry_date, manufactured_date, received_date, product_id, product_code, product_name, product_spec, product_unit, product_storage_type, bundle_id, bundle_code, bundle_name, bundle_unit, bundle_quantity, bundle_unit_cost_incl_vat, location_id, location_code, location_name, zone_id, zone_code, zone_name, zone_storage_type, warehouse_id, warehouse_code, warehouse_name, quantity_delta, unit_cost_incl_vat, amount_incl_vat, amount_excl_vat, reason, memo, is_reversal"
        )
        .eq("document_id", documentId)
        .order("line_no")
        .order("seq")
        .range(from, to)
        .overrideTypes<MovementViewRow[], { merge: false }>()
  )
  const row = toStockDocumentRow(header)
  return {
    ...row,
    canReverse: row.docType !== "reversal" && row.reversedById === null,
    lines: lines.map((line) => ({
      id: line.id,
      seq: line.seq,
      lineNo: line.line_no,
      lotId: line.lot_id,
      lotNo: line.lot_no,
      supplierLotNo: line.supplier_lot_no,
      expiryKind: line.expiry_kind,
      expiryDate: line.expiry_date,
      manufacturedDate: line.manufactured_date,
      receivedDate: line.received_date,
      productId: line.product_id,
      productCode: line.product_code,
      productName: line.product_name,
      productSpec: line.product_spec,
      productUnit: line.product_unit,
      productStorageType: line.product_storage_type,
      bundleId: line.bundle_id,
      bundleCode: line.bundle_code,
      bundleName: line.bundle_name,
      bundleUnit: line.bundle_unit,
      bundleQuantity:
        line.bundle_quantity === null ? null : Number(line.bundle_quantity),
      bundleUnitCostInclVat: line.bundle_unit_cost_incl_vat,
      locationId: line.location_id,
      locationCode: line.location_code,
      locationName: line.location_name,
      zoneId: line.zone_id,
      zoneCode: line.zone_code,
      zoneName: line.zone_name,
      zoneStorageType: line.zone_storage_type,
      warehouseId: line.warehouse_id,
      warehouseCode: line.warehouse_code,
      warehouseName: line.warehouse_name,
      quantityDelta: Number(line.quantity_delta),
      unitCostInclVat: line.unit_cost_incl_vat,
      amountInclVat: line.amount_incl_vat,
      amountExclVat: line.amount_excl_vat,
      reason: line.reason,
      memo: line.memo,
      isReversal: line.is_reversal,
    })),
  }
}

// ---------------------------------------------------------------------------
// 대시보드
// ---------------------------------------------------------------------------

const dashboardCardSchema = z.object({
  row_count: z.number(),
  lot_count: z.number(),
  product_count: z.number(),
  value_incl_vat: z.number().optional(),
  value_excl_vat: z.number().optional(),
  too_warm_count: z.number().optional(),
  cost_estimated: z.boolean().optional(),
  cost_missing: z.boolean().optional(),
})

const dashboardSchema = z.object({
  today: z.string(),
  expiry_warning_days: z.number(),
  expired: dashboardCardSchema,
  imminent: dashboardCardSchema,
  mismatch: dashboardCardSchema,
  stock: dashboardCardSchema,
  recent_documents: z.array(
    z.object({
      id: z.string(),
      doc_no: z.string(),
      doc_type: z.enum(Constants.public.Enums.stock_document_type),
      effective_type: z.enum(Constants.public.Enums.stock_document_type),
      doc_date: z.string(),
      partner_name: z.string().nullable(),
      first_product_name: z.string().nullable(),
      product_count: z.number(),
      line_count: z.number(),
      reverses_doc_no: z.string().nullable(),
      reversed_by_doc_no: z.string().nullable(),
      created_at: z.string(),
    })
  ),
})

/** One dashboard card: (lot × 위치) rows, lots, products and the value. */
export type StockDashboardCard = {
  rowCount: number
  lotCount: number
  productCount: number
  /** 부가세 포함 (cards with a value). */
  valueInclVat: number
  valueExclVat: number
}

export type StockDashboard = {
  today: string
  expiryWarningDays: number
  /** 기한 경과 재고 → /inventory/locations?expiry=expired */
  expired: StockDashboardCard
  /** 기한 임박 재고 (≤ N days) → /inventory/locations?expiry=imminent */
  imminent: StockDashboardCard
  /** 보관온도 불일치 → /inventory/locations?mismatch=1 */
  mismatch: Omit<StockDashboardCard, "valueInclVat" | "valueExclVat"> & {
    /** Of them: the 구역 is warmer than the product needs. */
    tooWarmCount: number
  }
  /** All stock on hand. */
  stock: StockDashboardCard & { costEstimated: boolean; costMissing: boolean }
  recentDocuments: {
    id: string
    docNo: string
    docType: StockDocumentType
    effectiveType: StockDocumentType
    docDate: string
    partnerName: string | null
    firstProductName: string | null
    productCount: number
    lineCount: number
    reversesDocNo: string | null
    reversedByDocNo: string | null
    createdAt: string
  }[]
}

/** The 재고 cards of the dashboard and the latest 전표. */
export async function getStockDashboard(
  recentLimit = 10
): Promise<StockDashboard> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("stock_dashboard", {
    recent_limit: recentLimit,
  })
  if (error) throw readFailed("재고 현황을 불러오지 못했습니다", error)
  const dashboard = dashboardSchema.parse(data)
  const card = (value: z.infer<typeof dashboardCardSchema>) => ({
    rowCount: value.row_count,
    lotCount: value.lot_count,
    productCount: value.product_count,
    valueInclVat: value.value_incl_vat ?? 0,
    valueExclVat: value.value_excl_vat ?? 0,
  })
  return {
    today: dashboard.today,
    expiryWarningDays: dashboard.expiry_warning_days,
    expired: card(dashboard.expired),
    imminent: card(dashboard.imminent),
    mismatch: {
      rowCount: dashboard.mismatch.row_count,
      lotCount: dashboard.mismatch.lot_count,
      productCount: dashboard.mismatch.product_count,
      tooWarmCount: dashboard.mismatch.too_warm_count ?? 0,
    },
    stock: {
      ...card(dashboard.stock),
      costEstimated: dashboard.stock.cost_estimated ?? false,
      costMissing: dashboard.stock.cost_missing ?? false,
    },
    recentDocuments: dashboard.recent_documents.map((document) => ({
      id: document.id,
      docNo: document.doc_no,
      docType: document.doc_type,
      effectiveType: document.effective_type,
      docDate: document.doc_date,
      partnerName: document.partner_name,
      firstProductName: document.first_product_name,
      productCount: document.product_count,
      lineCount: document.line_count,
      reversesDocNo: document.reverses_doc_no,
      reversedByDocNo: document.reversed_by_doc_no,
      createdAt: document.created_at,
    })),
  }
}

// ---------------------------------------------------------------------------
// Product pickers of the 전표 screens
// ---------------------------------------------------------------------------

/** One 구성 기준상품 of a 묶음상품 (for the 입고 conversion preview). */
export type StockProductComponent = {
  productId: string
  code: string
  name: string
  unit: string
  storageType: StorageType
  shelfLifeDays: number | null
  purchasePriceInclVat: number | null
  /** 구성 수량 per 1 unit of the 묶음상품. */
  quantityPerUnit: number
}

/** A product a 전표 line can pick (기준상품, and 묶음상품 for 입고/출고). */
export type StockProductOption = {
  id: string
  code: string
  name: string
  spec: string | null
  unit: string
  productType: "base" | "bundle"
  barcode: string | null
  isActive: boolean
  /** 보관온도 (묶음상품: the strictest of its 기준상품). */
  storageType: StorageType | null
  /** 유통기한 기준일수 (묶음상품: the shortest) — for suggestExpiryDate. */
  shelfLifeDays: number | null
  /** 기본 매입가 (부가세 포함). */
  purchasePriceInclVat: number | null
  /** 기준상품: stock now / 출고 가능 (minus 기한 경과); 묶음상품: null. */
  onHandQuantity: number | null
  availableQuantity: number | null
  /** 묶음상품: its 구성표 (empty for a 기준상품). */
  components: StockProductComponent[]
}

/** Rows per page of the product picker. */
export const STOCK_PRODUCT_PAGE_SIZE = 100

/** At most this many 사용중지 기준상품 with stock are added to a product search. */
const INACTIVE_WITH_STOCK_MAX = 100

/**
 * Products for a 전표 line: 사용 products whose 상품코드, 상품명 or 바코드
 * contains `search` (all when empty), 상품코드 order. `includeBundles`:
 * 입고/출고 (묶음상품 too); 폐기/이동/실사 pick lots instead.
 * `includeInactiveWithStock` (출고, 거래수불, filters — never 입고): also
 * 사용중지 기준상품 that still have stock (isActive false; at most 100 of
 * them per search), so a discontinued product's remaining stock can still
 * go out and be looked up.
 */
export async function searchStockProducts(
  search: string,
  options: {
    includeBundles: boolean
    offset?: number
    includeInactiveWithStock?: boolean
  }
): Promise<{ rows: StockProductOption[]; hasMore: boolean }> {
  const supabase = await createClient()
  const offset = Math.max(Math.floor(options.offset ?? 0), 0)
  const text = search.trim().slice(0, 100)

  // 사용중지 기준상품 with stock that match the search (usually few).
  let inactiveIds: string[] = []
  if (options.includeInactiveWithStock) {
    let inactive = supabase
      .from("product_stock_summary")
      .select("product_id")
      .eq("product_is_active", false)
      .gt("on_hand_quantity", 0)
    if (text) {
      inactive = inactive.or(
        searchFilter(text, ["product_code", "product_name", "product_barcode"])
      )
    }
    const { data, error } = await inactive
      .order("product_code")
      .limit(INACTIVE_WITH_STOCK_MAX)
    if (error) throw readFailed("상품을 불러오지 못했습니다", error)
    inactiveIds = data.flatMap((row) =>
      row.product_id ? [row.product_id] : []
    )
  }

  let query = supabase
    .from("product_list_items")
    .select(
      "id, code, name, spec, unit, product_type, barcode, is_active, effective_storage_type, effective_shelf_life_days, purchase_price_incl_vat"
    )
  query =
    inactiveIds.length > 0
      ? query.or(`is_active.eq.true,id.in.(${inactiveIds.join(",")})`)
      : query.eq("is_active", true)
  if (!options.includeBundles) query = query.eq("product_type", "base")
  if (text) query = query.or(searchFilter(text, ["code", "name", "barcode"]))
  const { data, error } = await query
    .order("code")
    .order("id")
    .range(offset, offset + STOCK_PRODUCT_PAGE_SIZE)
  if (error) throw readFailed("상품을 불러오지 못했습니다", error)
  const rows = data.slice(0, STOCK_PRODUCT_PAGE_SIZE)
  const options_ = await completeProductOptions(
    rows.flatMap((row) =>
      row.id && row.code && row.name && row.unit && row.product_type
        ? [
            {
              id: row.id,
              code: row.code,
              name: row.name,
              spec: row.spec,
              unit: row.unit,
              productType: row.product_type,
              barcode: row.barcode,
              isActive: row.is_active ?? true,
              storageType: row.effective_storage_type,
              shelfLifeDays: row.effective_shelf_life_days,
              purchasePriceInclVat: row.purchase_price_incl_vat,
            },
          ]
        : []
    )
  )
  return { rows: options_, hasMore: data.length > STOCK_PRODUCT_PAGE_SIZE }
}

/** The products with these ids as picker options (e.g. a document's lines). */
export async function getStockProductOptions(
  ids: readonly string[]
): Promise<StockProductOption[]> {
  if (ids.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("product_list_items")
    .select(
      "id, code, name, spec, unit, product_type, barcode, is_active, effective_storage_type, effective_shelf_life_days, purchase_price_incl_vat"
    )
    .in("id", [...ids].slice(0, 500))
  if (error) throw readFailed("상품을 불러오지 못했습니다", error)
  return completeProductOptions(
    data.flatMap((row) =>
      row.id && row.code && row.name && row.unit && row.product_type
        ? [
            {
              id: row.id,
              code: row.code,
              name: row.name,
              spec: row.spec,
              unit: row.unit,
              productType: row.product_type,
              barcode: row.barcode,
              isActive: row.is_active ?? true,
              storageType: row.effective_storage_type,
              shelfLifeDays: row.effective_shelf_life_days,
              purchasePriceInclVat: row.purchase_price_incl_vat,
            },
          ]
        : []
    )
  )
}

type ProductOptionBase = Omit<
  StockProductOption,
  "onHandQuantity" | "availableQuantity" | "components"
>

/** Adds the stock of 기준상품 and the 구성표 of 묶음상품. */
async function completeProductOptions(
  products: ProductOptionBase[]
): Promise<StockProductOption[]> {
  if (products.length === 0) return []
  const supabase = await createClient()
  const baseIds = products
    .filter((p) => p.productType === "base")
    .map((p) => p.id)
  const bundleIds = products
    .filter((p) => p.productType === "bundle")
    .map((p) => p.id)
  const [stock, items] = await Promise.all([
    baseIds.length
      ? supabase
          .from("product_stock_summary")
          .select("product_id, on_hand_quantity, available_quantity")
          .in("product_id", baseIds)
      : Promise.resolve({ data: [], error: null }),
    bundleIds.length
      ? supabase
          .from("product_bundle_items")
          .select(
            "bundle_id, quantity, sort_order, component:products!product_bundle_items_component_id_fkey (id, code, name, unit, storage_type, shelf_life_days, purchase_price_incl_vat)"
          )
          .in("bundle_id", bundleIds)
          .order("sort_order")
      : Promise.resolve({ data: [], error: null }),
  ])
  if (stock.error) throw readFailed("재고를 불러오지 못했습니다", stock.error)
  if (items.error)
    throw readFailed("구성상품을 불러오지 못했습니다", items.error)
  const stockById = new Map(
    (stock.data ?? []).map((row) => [row.product_id, row])
  )
  const componentsByBundle = new Map<string, StockProductComponent[]>()
  for (const item of items.data ?? []) {
    const component = item.component
    if (!component || !component.storage_type) continue
    componentsByBundle.set(item.bundle_id, [
      ...(componentsByBundle.get(item.bundle_id) ?? []),
      {
        productId: component.id,
        code: component.code,
        name: component.name,
        unit: component.unit,
        storageType: component.storage_type,
        shelfLifeDays: component.shelf_life_days,
        purchasePriceInclVat: component.purchase_price_incl_vat,
        quantityPerUnit: item.quantity,
      },
    ])
  }
  return products.map((product) => {
    const summary = stockById.get(product.id)
    return {
      ...product,
      onHandQuantity:
        product.productType === "base"
          ? Number(summary?.on_hand_quantity ?? 0)
          : null,
      availableQuantity:
        product.productType === "base"
          ? Number(summary?.available_quantity ?? 0)
          : null,
      components: componentsByBundle.get(product.id) ?? [],
    }
  })
}

// ---------------------------------------------------------------------------
// 실사 목록
// ---------------------------------------------------------------------------

const countSheetSchema = z.object({
  as_of: z.string(),
  lines: z.array(
    z.object({
      lot_id: z.string(),
      location_id: z.string(),
      system_quantity: z.number(),
      product_id: z.string(),
      product_code: z.string(),
      product_name: z.string(),
      product_spec: z.string().nullable(),
      product_unit: z.string(),
      product_storage_type: z.enum(Constants.public.Enums.storage_type),
      lot_no: z.string(),
      expiry_kind: z.enum(Constants.public.Enums.expiry_kind),
      expiry_date: z.string().nullable(),
      days_left: z.number().nullable(),
      received_date: z.string(),
      unit_cost_incl_vat: z.number().nullable(),
      product_purchase_price_incl_vat: z.number().nullable(),
      location_code: z.string(),
      location_name: z.string().nullable(),
      zone_id: z.string(),
      zone_code: z.string(),
      zone_name: z.string(),
      zone_storage_type: z.enum(Constants.public.Enums.storage_type),
      warehouse_id: z.string(),
      warehouse_code: z.string(),
      warehouse_name: z.string(),
    })
  ),
})

/** One line of the 실사 목록: a (lot, 위치) and its 전산 수량 at the date. */
export type CountSheetLine = {
  lotId: string
  locationId: string
  /** The quantity at the end of the 실사 date (send it back as systemQuantity). */
  systemQuantity: number
  productId: string
  productCode: string
  productName: string
  productSpec: string | null
  productUnit: string
  productStorageType: StorageType
  lotNo: string
  expiryKind: ExpiryKind
  expiryDate: string | null
  daysLeft: number | null
  receivedDate: string
  /** The lot's 입고 단가 (부가세 포함), or null. */
  unitCostInclVat: number | null
  /**
   * The 단가 the 차이 금액 uses: the lot's 입고 단가, or the product's 기본
   * 매입가 when the lot has none (same rule as 재고처별 재고현황; then
   * costEstimated). Null when neither is known.
   */
  effectiveUnitCostInclVat: number | null
  costEstimated: boolean
  locationCode: string
  locationName: string | null
  zoneId: string
  zoneCode: string
  zoneName: string
  zoneStorageType: StorageType
  warehouseId: string
  warehouseCode: string
  warehouseName: string
}

/**
 * The 실사 목록 of a 창고 (or one 구역 / 위치) at the end of `asOf` (empty =
 * today): every (lot, 위치) with stock, in 창고·구역·위치 order. At most
 * 3,000 lines (the database refuses a larger scope).
 */
export async function getCountSheet(
  scope: {
    warehouseId: string | null
    zoneId: string | null
    locationId: string | null
  },
  asOf: string | null
): Promise<{ asOf: string; lines: CountSheetLine[] }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("stock_count_sheet", {
    filter_warehouse_id: scope.warehouseId as string,
    filter_zone_id: scope.zoneId ?? undefined,
    filter_location_id: scope.locationId ?? undefined,
    as_of: asOf ?? undefined,
  })
  if (error) throw error
  const sheet = countSheetSchema.parse(data)
  return {
    asOf: sheet.as_of,
    lines: sheet.lines.map((line) => ({
      lotId: line.lot_id,
      locationId: line.location_id,
      systemQuantity: line.system_quantity,
      productId: line.product_id,
      productCode: line.product_code,
      productName: line.product_name,
      productSpec: line.product_spec,
      productUnit: line.product_unit,
      productStorageType: line.product_storage_type,
      lotNo: line.lot_no,
      expiryKind: line.expiry_kind,
      expiryDate: line.expiry_date,
      daysLeft: line.days_left,
      receivedDate: line.received_date,
      unitCostInclVat: line.unit_cost_incl_vat,
      effectiveUnitCostInclVat:
        line.unit_cost_incl_vat ?? line.product_purchase_price_incl_vat,
      costEstimated:
        line.unit_cost_incl_vat === null &&
        line.product_purchase_price_incl_vat !== null,
      locationCode: line.location_code,
      locationName: line.location_name,
      zoneId: line.zone_id,
      zoneCode: line.zone_code,
      zoneName: line.zone_name,
      zoneStorageType: line.zone_storage_type,
      warehouseId: line.warehouse_id,
      warehouseCode: line.warehouse_code,
      warehouseName: line.warehouse_name,
    })),
  }
}
