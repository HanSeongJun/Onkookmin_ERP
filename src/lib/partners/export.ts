/**
 * The 거래처 엑셀 download: the list's rows as a CSV file that Excel opens
 * with the Korean text intact (UTF-8 with BOM, CRLF line ends).
 *
 * Used by the Route Handler GET /partners/export:
 *   const { rows, total } = await listPartnersForExport(params)
 *   const body = buildPartnerCsv(rows)
 *   const { fileName, asciiFileName } = partnerExportFileNames()
 *
 * Plain functions without the database (no "server-only" needed).
 */

import { formatDate, formatDateTime } from "@/lib/format"
import { formatBusinessNumber } from "@/lib/partners/business-number"
import {
  formatCreditLimit,
  formatPaymentTerm,
  invoiceTypeLabel,
  partnerIndustryLabel,
  partnerTypeLabel,
  slipPrintLabel,
} from "@/lib/partners/constants"
import { formatPhone } from "@/lib/partners/phone"
import type { PartnerListItem } from "@/lib/partners/queries"
import { UNCATEGORIZED_PARTNER_LABEL } from "@/lib/partner-categories/tree"

/** One column of the file: its Korean header and how to fill a cell. */
type Column = {
  header: string
  cell: (row: PartnerListItem) => string
}

/** The file's columns, in order. */
const COLUMNS: Column[] = [
  {
    header: "구분",
    cell: (row) => csvCell(partnerTypeLabel(row.partner_type)),
  },
  { header: "거래처코드", cell: (row) => textCell(row.code) },
  { header: "거래처명", cell: (row) => csvCell(row.name) },
  { header: "대표자", cell: (row) => csvCell(row.representative) },
  {
    header: "사업자번호",
    cell: (row) => textCell(formatBusinessNumber(row.business_number)),
  },
  { header: "상호(법인명)", cell: (row) => csvCell(row.company_name) },
  { header: "업태", cell: (row) => csvCell(row.business_category) },
  { header: "종목", cell: (row) => csvCell(row.business_item) },
  { header: "대표연락처", cell: (row) => textCell(formatPhone(row.phone)) },
  {
    header: "업종",
    cell: (row) =>
      csvCell(row.industry ? partnerIndustryLabel(row.industry) : null),
  },
  { header: "영업담당", cell: (row) => csvCell(row.sales_rep_name) },
  { header: "배송담당", cell: (row) => csvCell(row.delivery_rep_name) },
  {
    header: "거래처분류",
    cell: (row) => csvCell(row.category_path ?? UNCATEGORIZED_PARTNER_LABEL),
  },
  {
    header: "기본 배송지명",
    cell: (row) => csvCell(row.default_address_label),
  },
  {
    header: "기본 배송지 우편번호",
    cell: (row) => textCell(row.default_address_postal_code),
  },
  { header: "기본 배송지", cell: (row) => csvCell(row.default_address_text) },
  {
    header: "결제일",
    cell: (row) =>
      csvCell(formatPaymentTerm(row.payment_term, row.payment_day)),
  },
  {
    header: "외상한도",
    cell: (row) =>
      csvCell(
        row.credit_limit_type === "limited"
          ? "한도 설정"
          : formatCreditLimit(row.credit_limit_type, null)
      ),
  },
  {
    header: "외상한도 금액",
    cell: (row) => numberCell(row.credit_limit),
  },
  {
    header: "계산서 발행",
    cell: (row) => csvCell(invoiceTypeLabel(row.invoice_type)),
  },
  {
    header: "전표 인쇄",
    cell: (row) => csvCell(slipPrintLabel(row.slip_print)),
  },
  { header: "사업장 우편번호", cell: (row) => textCell(row.postal_code) },
  { header: "사업장 주소", cell: (row) => csvCell(row.address) },
  { header: "사업장 상세주소", cell: (row) => csvCell(row.address_detail) },
  { header: "세금계산서 이메일", cell: (row) => csvCell(row.tax_email) },
  { header: "담당자 수", cell: (row) => numberCell(row.contact_count) },
  { header: "배송지 수", cell: (row) => numberCell(row.address_count) },
  {
    header: "사용여부",
    cell: (row) => csvCell(row.is_active ? "사용" : "미사용"),
  },
  { header: "특이사항", cell: (row) => csvCell(row.note) },
  { header: "등록일", cell: (row) => csvCell(formatDateTime(row.created_at)) },
  {
    header: "최종수정일",
    cell: (row) => csvCell(formatDateTime(row.updated_at)),
  },
]

/**
 * The whole CSV file: a header row, then one row per partner. Starts with
 * a BOM ("﻿") so Excel reads it as UTF-8; lines end with CRLF (what
 * Excel writes itself).
 */
export function buildPartnerCsv(rows: readonly PartnerListItem[]): string {
  const lines = [
    COLUMNS.map((column) => csvCell(column.header)),
    ...rows.map((row) => COLUMNS.map((column) => column.cell(row))),
  ].map((cells) => cells.join(","))
  return `﻿${lines.join("\r\n")}\r\n`
}

/**
 * The download's file names: 거래처목록_YYYYMMDD.csv (date in Korea time),
 * and a plain one for old browsers (partners_YYYYMMDD.csv). Use both in
 * Content-Disposition: `attachment; filename="<ascii>";
 * filename*=UTF-8''<encodeURIComponent(fileName)>`.
 */
export function partnerExportFileNames(now: Date = new Date()): {
  fileName: string
  asciiFileName: string
} {
  const date = formatDate(now).replaceAll("-", "")
  return {
    fileName: `거래처목록_${date}.csv`,
    asciiFileName: `partners_${date}.csv`,
  }
}

/**
 * A text cell: in double quotes (with " doubled), so commas and line breaks
 * stay inside the cell. Text that starts with = + - @ (or a tab / line
 * break) gets a leading ' so Excel shows it as text instead of running it
 * as a formula (protection against "CSV injection").
 */
export function csvCell(value: string | null): string {
  if (value === null || value === "") return ""
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${text.replaceAll('"', '""')}"`
}

/**
 * A number cell (empty when there is no value). Only digits (and a minus
 * sign), so it can never be read as a formula.
 */
export function numberCell(value: number | null): string {
  return value === null ? "" : String(value)
}

/**
 * 거래처코드, 사업자번호, phone numbers and 우편번호. Excel guesses the
 * type of every CSV cell, even a quoted one: "000123" becomes 123, a phone
 * number loses its leading 0, "3-15" becomes a date. Writing the value as
 * ="02-123-4567" keeps it as text, exactly as in the ERP.
 * Only values made of letters, digits, ".", "-" and "_" (all codes, phone
 * numbers, 사업자번호 and 우편번호 as the database checks them) are wrapped
 * like that: they contain no quote, so nothing else can be run as a
 * formula. Anything else goes through csvCell.
 */
export function textCell(value: string | null): string {
  if (value === null || value === "") return ""
  if (/^[A-Za-z0-9._-]+$/.test(value)) return `"=""${value}"""`
  return csvCell(value)
}
