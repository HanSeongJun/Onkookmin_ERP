/**
 * 재고관리 엑셀 downloads: CSV files that Excel opens with the Korean text
 * intact (UTF-8 with BOM, CRLF line ends), like the 상품/거래처 downloads.
 * Codes (상품코드, 로트번호, 전표번호 …) are written as ="…" so Excel keeps
 * them as text; other text gets a leading ' when it starts with = + - @.
 *
 * Route Handlers use them, e.g. GET /inventory/export:
 *   const report = await getStockPeriodReportForExport(params)
 *   const body = buildStockReportCsv(report)
 *   const { fileName, asciiFileName } = inventoryExportFileNames("상품별재고현황", "stock")
 *
 * Plain functions without the database (no "server-only" needed).
 */

import {
  disposalReasonLabel,
  expiryKindLabel,
  EXPIRY_STATUS_LABELS,
  formatDaysLeft,
  movementLabel,
  stockDocumentTypeLabel,
} from "@/lib/inventory/constants"
import type {
  LotStockRow,
  StockDocumentRow,
  StockLedger,
  StockReportRow,
  StockReportTotals,
} from "@/lib/inventory/queries"
import { formatDate, formatDateTime } from "@/lib/format"
import { csvCell, numberCell, textCell } from "@/lib/partners/export"
import { storageTypeLabel, taxTypeLabel } from "@/lib/products/constants"

type Column<Row> = { header: string; cell: (row: Row) => string }

function buildCsv<Row>(
  columns: readonly Column<Row>[],
  rows: readonly Row[],
  extraLines: string[][] = []
): string {
  const lines = [
    columns.map((column) => csvCell(column.header)),
    ...rows.map((row) => columns.map((column) => column.cell(row))),
    ...extraLines,
  ].map((cells) => cells.join(","))
  return `﻿${lines.join("\r\n")}\r\n`
}

/** A quantity cell: digits only, up to 3 decimals. */
function quantityCell(value: number | null): string {
  if (value === null) return ""
  return String(Math.round(value * 1000) / 1000)
}

/**
 * File names "<name>_YYYYMMDD.csv" (date in Korea) and a plain one for old
 * browsers ("<asciiName>_YYYYMMDD.csv"). Use both in Content-Disposition.
 */
export function inventoryExportFileNames(
  name: string,
  asciiName: string,
  now: Date = new Date()
): { fileName: string; asciiFileName: string } {
  const date = formatDate(now).replaceAll("-", "")
  return {
    fileName: `${name}_${date}.csv`,
    asciiFileName: `${asciiName}_${date}.csv`,
  }
}

// ---------------------------------------------------------------------------
// 상품별 재고현황
// ---------------------------------------------------------------------------

const REPORT_COLUMNS: Column<StockReportRow>[] = [
  { header: "상품코드", cell: (row) => textCell(row.code) },
  { header: "상품명", cell: (row) => csvCell(row.name) },
  { header: "규격", cell: (row) => csvCell(row.spec) },
  { header: "단위", cell: (row) => csvCell(row.unit) },
  { header: "상품분류", cell: (row) => csvCell(row.categoryPath) },
  { header: "이월재고", cell: (row) => quantityCell(row.openingQty) },
  { header: "입고", cell: (row) => quantityCell(row.receiptQty) },
  { header: "기초재고", cell: (row) => quantityCell(row.openingStockQty) },
  { header: "출고", cell: (row) => quantityCell(row.issueQty) },
  { header: "조정(+)", cell: (row) => quantityCell(row.adjustInQty) },
  { header: "조정(-)", cell: (row) => quantityCell(row.adjustOutQty) },
  { header: "폐기", cell: (row) => quantityCell(row.disposalQty) },
  { header: "이동(입)", cell: (row) => quantityCell(row.transferInQty) },
  { header: "이동(출)", cell: (row) => quantityCell(row.transferOutQty) },
  { header: "기말재고", cell: (row) => quantityCell(row.closingQty) },
  {
    header: "재고단가(부가세포함)",
    cell: (row) => numberCell(row.closingUnitCostInclVat),
  },
  {
    header: "재고금액(부가세포함)",
    cell: (row) => numberCell(row.closingValueInclVat),
  },
  {
    header: "재고금액(부가세별도)",
    cell: (row) => numberCell(row.closingValueExclVat),
  },
  {
    header: "단가 참고",
    cell: (row) =>
      csvCell(
        row.costMissing
          ? "단가 없는 재고 있음"
          : row.costEstimated
            ? "기본 매입가로 추정한 재고 있음"
            : null
      ),
  },
  {
    header: "가장 빠른 기한",
    cell: (row) =>
      csvCell(
        row.nearestExpiryDate
          ? `${row.nearestExpiryKind ? expiryKindLabel(row.nearestExpiryKind) + " " : ""}${row.nearestExpiryDate}`
          : null
      ),
  },
  {
    header: "보관온도",
    cell: (row) => csvCell(storageTypeLabel(row.storageType)),
  },
  { header: "과세구분", cell: (row) => csvCell(taxTypeLabel(row.taxType)) },
  {
    header: "사용여부",
    cell: (row) => csvCell(row.isActive ? "사용" : "사용중지"),
  },
]

/** 상품별 재고현황 with a 총계 line at the end. */
export function buildStockReportCsv(report: {
  dateFrom: string
  dateTo: string
  rows: readonly StockReportRow[]
  totals: StockReportTotals
}): string {
  const total = REPORT_COLUMNS.map(() => "")
  total[0] = csvCell(`총계 (${report.dateFrom} ~ ${report.dateTo})`)
  const sum = (pick: (row: StockReportRow) => number | null) =>
    quantityCell(
      report.rows.reduce((value, row) => value + (pick(row) ?? 0), 0)
    )
  total[5] = sum((row) => row.openingQty)
  total[6] = sum((row) => row.receiptQty)
  total[7] = sum((row) => row.openingStockQty)
  total[8] = sum((row) => row.issueQty)
  total[9] = sum((row) => row.adjustInQty)
  total[10] = sum((row) => row.adjustOutQty)
  total[11] = sum((row) => row.disposalQty)
  total[12] = sum((row) => row.transferInQty)
  total[13] = sum((row) => row.transferOutQty)
  total[14] = sum((row) => row.closingQty)
  total[16] = numberCell(report.totals.closingValueInclVat)
  total[17] = numberCell(report.totals.closingValueExclVat)
  return buildCsv(REPORT_COLUMNS, report.rows, [total])
}

// ---------------------------------------------------------------------------
// 재고처별 재고현황
// ---------------------------------------------------------------------------

const LOT_COLUMNS: Column<LotStockRow>[] = [
  { header: "창고", cell: (row) => csvCell(row.warehouseName) },
  { header: "구역", cell: (row) => csvCell(row.zoneName) },
  { header: "위치", cell: (row) => textCell(row.locationCode) },
  {
    header: "구역 보관온도",
    cell: (row) => csvCell(storageTypeLabel(row.zoneStorageType)),
  },
  { header: "상품코드", cell: (row) => textCell(row.productCode) },
  { header: "상품명", cell: (row) => csvCell(row.productName) },
  { header: "규격", cell: (row) => csvCell(row.productSpec) },
  { header: "단위", cell: (row) => csvCell(row.productUnit) },
  {
    header: "상품 보관온도",
    cell: (row) => csvCell(storageTypeLabel(row.productStorageType)),
  },
  {
    header: "보관온도 확인",
    cell: (row) =>
      csvCell(
        row.storageTooWarm
          ? "위험(온도 높음)"
          : row.storageMismatch
            ? "불일치"
            : null
      ),
  },
  { header: "로트번호", cell: (row) => textCell(row.lotNo) },
  { header: "공급처 로트번호", cell: (row) => textCell(row.supplierLotNo) },
  {
    header: "기한 종류",
    cell: (row) => csvCell(expiryKindLabel(row.expiryKind)),
  },
  { header: "기한일", cell: (row) => csvCell(row.expiryDate) },
  {
    header: "D-day",
    cell: (row) =>
      csvCell(row.expiryDate ? formatDaysLeft(row.daysLeft) : null),
  },
  {
    header: "기한 상태",
    cell: (row) => csvCell(EXPIRY_STATUS_LABELS[row.expiryStatus]),
  },
  { header: "제조일자", cell: (row) => csvCell(row.manufacturedDate) },
  { header: "입고일", cell: (row) => csvCell(row.receivedDate) },
  { header: "수량", cell: (row) => quantityCell(row.quantity) },
  {
    header: "단가(부가세포함)",
    cell: (row) => numberCell(row.effectiveUnitCostInclVat),
  },
  { header: "금액(부가세포함)", cell: (row) => numberCell(row.valueInclVat) },
  { header: "금액(부가세별도)", cell: (row) => numberCell(row.valueExclVat) },
  {
    header: "단가 참고",
    cell: (row) => csvCell(row.costEstimated ? "기본 매입가로 추정" : null),
  },
  { header: "매입처", cell: (row) => csvCell(row.supplierName) },
]

export function buildLotStockCsv(rows: readonly LotStockRow[]): string {
  return buildCsv(LOT_COLUMNS, rows)
}

// ---------------------------------------------------------------------------
// 상품별 거래수불
// ---------------------------------------------------------------------------

type LedgerCsvLine = {
  docDate: string
  docNo: string
  kind: string
  partner: string | null
  lotNo: string | null
  expiry: string | null
  place: string | null
  inQty: number | null
  outQty: number | null
  balance: number
  memo: string | null
}

const LEDGER_COLUMNS: Column<LedgerCsvLine>[] = [
  { header: "일자", cell: (row) => csvCell(row.docDate) },
  { header: "전표번호", cell: (row) => textCell(row.docNo) },
  { header: "구분", cell: (row) => csvCell(row.kind) },
  { header: "거래처", cell: (row) => csvCell(row.partner) },
  { header: "로트번호", cell: (row) => textCell(row.lotNo) },
  { header: "기한", cell: (row) => csvCell(row.expiry) },
  { header: "위치", cell: (row) => csvCell(row.place) },
  { header: "입고", cell: (row) => quantityCell(row.inQty) },
  { header: "출고", cell: (row) => quantityCell(row.outQty) },
  { header: "잔량", cell: (row) => quantityCell(row.balance) },
  { header: "메모", cell: (row) => csvCell(row.memo) },
]

/** 상품별 거래수불: an 이월 line, the lines with their 잔량, a 합계 line. */
export function buildStockLedgerCsv(ledger: StockLedger): string {
  const lines: LedgerCsvLine[] = [
    {
      docDate: ledger.dateFrom,
      docNo: "",
      kind: "이월",
      partner: null,
      lotNo: null,
      expiry: null,
      place: null,
      inQty: null,
      outQty: null,
      balance: ledger.openingQty,
      memo: `${ledger.product.code} ${ledger.product.name} (${ledger.product.unit})`,
    },
    ...ledger.lines.map((line) => ({
      docDate: line.docDate,
      docNo: line.docNo,
      // "당일취소": a 전표 undone on its own date (the 잔량 stays).
      kind: `${movementLabel(line.movementType, line.isReversal)}${line.sameDayCancelled ? " (당일취소)" : ""}`,
      partner: line.partnerName,
      lotNo: line.lotNo,
      expiry: line.expiryDate
        ? `${expiryKindLabel(line.expiryKind)} ${line.expiryDate}`
        : null,
      place: `${line.warehouseName} > ${line.zoneName} > ${line.locationCode}`,
      inQty: line.inQty || null,
      outQty: line.outQty || null,
      balance: line.balance,
      memo:
        [
          line.reason ? `사유: ${disposalReasonLabel(line.reason)}` : null,
          line.bundleName ? `묶음상품: ${line.bundleName}` : null,
          line.memo,
        ]
          .filter(Boolean)
          .join(" / ") || null,
    })),
    {
      docDate: ledger.dateTo,
      docNo: "",
      kind: "합계",
      partner: null,
      lotNo: null,
      expiry: null,
      place: null,
      inQty: ledger.inQty,
      outQty: ledger.outQty,
      balance: ledger.closingQty,
      memo: null,
    },
  ]
  return buildCsv(LEDGER_COLUMNS, lines)
}

// ---------------------------------------------------------------------------
// 전표 lists
// ---------------------------------------------------------------------------

const DOCUMENT_COLUMNS: Column<StockDocumentRow>[] = [
  { header: "전표일자", cell: (row) => csvCell(row.docDate) },
  { header: "전표번호", cell: (row) => textCell(row.docNo) },
  {
    header: "구분",
    cell: (row) =>
      csvCell(
        row.docType === "reversal"
          ? `${stockDocumentTypeLabel(row.effectiveType)}취소`
          : stockDocumentTypeLabel(row.docType)
      ),
  },
  { header: "거래처", cell: (row) => csvCell(row.partnerName) },
  {
    header: "상품",
    cell: (row) =>
      csvCell(
        row.firstProductName
          ? row.productCount > 1
            ? `${row.firstProductName} 외 ${row.productCount - 1}건`
            : row.firstProductName
          : null
      ),
  },
  { header: "줄 수", cell: (row) => numberCell(row.lineCount) },
  {
    header: "들어온 금액(부가세포함)",
    cell: (row) => numberCell(row.valueInInclVat),
  },
  {
    header: "나간 금액(부가세포함)",
    cell: (row) => numberCell(row.valueOutInclVat),
  },
  {
    header: "상태",
    cell: (row) =>
      csvCell(
        row.reversedByDocNo
          ? `취소됨 (${row.reversedByDocNo})`
          : row.reversesDocNo
            ? `${row.reversesDocNo} 취소`
            : "정상"
      ),
  },
  { header: "메모", cell: (row) => csvCell(row.memo) },
  { header: "등록일시", cell: (row) => csvCell(formatDateTime(row.createdAt)) },
]

export function buildStockDocumentCsv(
  rows: readonly StockDocumentRow[]
): string {
  return buildCsv(DOCUMENT_COLUMNS, rows)
}
