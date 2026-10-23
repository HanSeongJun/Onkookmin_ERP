/**
 * The 직원 엑셀 download: the list's rows as a CSV file that Excel opens
 * with the Korean text intact (UTF-8 with BOM, CRLF line ends). Same cell
 * rules as the 거래처 file (@/lib/partners/export).
 *
 * For a Route Handler GET /employees/export:
 *   const { rows, total } = await listEmployeesForExport(params)
 *   const body = buildEmployeeCsv(rows)
 *   const { fileName, asciiFileName } = employeeExportFileNames()
 *
 * Plain functions without the database (no "server-only" needed).
 */

import {
  driverOperationTypeLabel,
  employeeStatusLabel,
  employmentTypeLabel,
  vehicleTypeLabel,
  yesNo,
} from "@/lib/employees/schema"
import type { EmployeeListItem } from "@/lib/employees/queries"
import { formatDate, formatDateTime } from "@/lib/format"
import { csvCell, numberCell, textCell } from "@/lib/partners/export"
import { formatPhone } from "@/lib/partners/phone"

/** One column of the file: its Korean header and how to fill a cell. */
type Column = {
  header: string
  cell: (row: EmployeeListItem) => string
}

/** The file's columns, in order. */
const COLUMNS: Column[] = [
  { header: "직원코드", cell: (row) => textCell(row.code) },
  { header: "직원명", cell: (row) => csvCell(row.name) },
  {
    header: "재직여부",
    cell: (row) => csvCell(employeeStatusLabel(row.is_active)),
  },
  { header: "영업담당", cell: (row) => csvCell(yesNo(row.is_sales_rep)) },
  {
    header: "배송담당",
    cell: (row) => csvCell(yesNo(row.is_delivery_driver)),
  },
  { header: "입사일", cell: (row) => csvCell(row.hire_date) },
  { header: "퇴사일", cell: (row) => csvCell(row.resignation_date) },
  { header: "휴대폰번호1", cell: (row) => textCell(formatPhone(row.mobile)) },
  { header: "휴대폰번호2", cell: (row) => textCell(formatPhone(row.mobile2)) },
  { header: "전화번호", cell: (row) => textCell(formatPhone(row.phone)) },
  { header: "이메일", cell: (row) => csvCell(row.email) },
  { header: "우편번호", cell: (row) => textCell(row.postal_code) },
  { header: "주소", cell: (row) => csvCell(row.address) },
  { header: "상세주소", cell: (row) => csvCell(row.address_detail) },
  { header: "부서명", cell: (row) => csvCell(row.department) },
  { header: "직급/직책", cell: (row) => csvCell(row.job_title) },
  {
    header: "고용형태",
    cell: (row) =>
      csvCell(
        row.employment_type ? employmentTypeLabel(row.employment_type) : null
      ),
  },
  { header: "급여지급", cell: (row) => csvCell(yesNo(row.is_salary_paid)) },
  {
    header: "운영형태",
    cell: (row) =>
      csvCell(
        row.driver_operation_type
          ? driverOperationTypeLabel(row.driver_operation_type)
          : null
      ),
  },
  { header: "차량번호", cell: (row) => csvCell(row.vehicle_number) },
  {
    header: "차량 종류",
    cell: (row) =>
      csvCell(row.vehicle_type ? vehicleTypeLabel(row.vehicle_type) : null),
  },
  {
    header: "영업담당 거래처 수",
    cell: (row) => numberCell(row.sales_partner_count),
  },
  {
    header: "배송담당 거래처 수",
    cell: (row) => numberCell(row.delivery_partner_count),
  },
  { header: "비고", cell: (row) => csvCell(row.note) },
  { header: "등록일", cell: (row) => csvCell(formatDateTime(row.created_at)) },
  {
    header: "최종수정일",
    cell: (row) => csvCell(formatDateTime(row.updated_at)),
  },
]

/**
 * The whole CSV file: a header row, then one row per employee. Starts with
 * a BOM so Excel reads it as UTF-8; lines end with CRLF.
 */
export function buildEmployeeCsv(rows: readonly EmployeeListItem[]): string {
  const lines = [
    COLUMNS.map((column) => csvCell(column.header)),
    ...rows.map((row) => COLUMNS.map((column) => column.cell(row))),
  ].map((cells) => cells.join(","))
  return `﻿${lines.join("\r\n")}\r\n`
}

/**
 * The download's file names: 직원목록_YYYYMMDD.csv (date in Korea time),
 * and a plain one for old browsers (employees_YYYYMMDD.csv). Use both in
 * Content-Disposition: `attachment; filename="<ascii>";
 * filename*=UTF-8''<encodeURIComponent(fileName)>`.
 */
export function employeeExportFileNames(now: Date = new Date()): {
  fileName: string
  asciiFileName: string
} {
  const date = formatDate(now).replaceAll("-", "")
  return {
    fileName: `직원목록_${date}.csv`,
    asciiFileName: `employees_${date}.csv`,
  }
}
