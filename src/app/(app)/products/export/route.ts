import type { NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/auth/user"
import { formatDate, formatDateTime } from "@/lib/format"
import { formatComposition } from "@/lib/products/bundle"
import {
  allergenLabel,
  productTypeShortLabel,
  storageTypeLabel,
  taxTypeLabel,
} from "@/lib/products/constants"
import {
  listProductsForExport,
  type ProductExportRow,
} from "@/lib/products/queries"
import { parseProductListParams } from "@/lib/products/schema"

/**
 * GET /products/export?<the list's conditions>: the 엑셀 download.
 *
 * Every product matching the same search and filters as the list (all pages,
 * at most 10,000 rows, in the list's sort order) as a CSV file that Excel
 * opens with the Korean text intact (UTF-8 with BOM). File name
 * 상품목록_YYYYMMDD.csv (date in Korea time). Only for signed-in employees.
 *
 * 구분 = 기준 (기준상품) / 묶음 (묶음상품). The food columns (과세구분,
 * 보관온도, 원산지, 제조사, 유통기한, 알레르기) are the values in effect: a
 * 묶음상품's are worked out from its 기준상품 (과세구분 "혼합" = 과세 and
 * 면세 mixed), like the list. 매입단가 and 판매단가 are two columns each:
 * 부가세 별도 and 부가세 포함.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return textResponse("로그인이 필요합니다. 다시 로그인해 주세요.", 401)
  }

  // Same reading of the conditions as the list page (first value of each
  // param; anything invalid falls back to the default).
  const searchParams: Record<string, string> = {}
  for (const [key, value] of request.nextUrl.searchParams) {
    if (!(key in searchParams)) searchParams[key] = value
  }
  const params = parseProductListParams(searchParams)

  let result: Awaited<ReturnType<typeof listProductsForExport>>
  try {
    result = await listProductsForExport(params)
  } catch (error) {
    console.error("Could not export products:", error)
    return textResponse(
      "엑셀 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
      500
    )
  }

  const lines = [
    COLUMNS.map((column) => csvCell(column.header)),
    ...result.rows.map((row) => COLUMNS.map((column) => column.cell(row))),
  ].map((cells) => cells.join(","))
  // "﻿" (BOM) tells Excel the file is UTF-8; CRLF line ends are what
  // Excel writes itself.
  const body = `﻿${lines.join("\r\n")}\r\n`

  const date = formatDate(new Date()).replaceAll("-", "")
  const fileName = `상품목록_${date}.csv`

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // filename: plain fallback for old browsers; filename*: the Korean name.
      "Content-Disposition": `attachment; filename="products_${date}.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
      // For the 엑셀 button's message: rows in the file and all matches.
      "X-Export-Rows": String(result.rows.length),
      "X-Export-Total": String(result.total),
    },
  })
}

/** One column of the file: its Korean header and how to fill a cell. */
type Column = {
  header: string
  cell: (row: ProductExportRow) => string
}

const COLUMNS: Column[] = [
  {
    header: "구분",
    cell: (row) => csvCell(productTypeShortLabel(row.product_type)),
  },
  { header: "상품코드", cell: (row) => codeCell(row.code) },
  { header: "상품명", cell: (row) => csvCell(row.name) },
  { header: "규격", cell: (row) => csvCell(row.spec) },
  { header: "단위", cell: (row) => csvCell(row.unit) },
  { header: "구성", cell: (row) => csvCell(compositionText(row)) },
  {
    header: "과세구분",
    cell: (row) =>
      csvCell(
        row.effective_tax_type ? taxTypeLabel(row.effective_tax_type) : null
      ),
  },
  {
    header: "보관온도",
    cell: (row) =>
      csvCell(
        row.effective_storage_type
          ? storageTypeLabel(row.effective_storage_type)
          : null
      ),
  },
  { header: "상품분류", cell: (row) => csvCell(row.categoryPath) },
  { header: "원산지", cell: (row) => csvCell(row.effective_origin) },
  {
    header: "제조사/브랜드",
    cell: (row) => csvCell(row.effective_manufacturer),
  },
  { header: "바코드", cell: (row) => codeCell(row.barcode) },
  // Prices: 부가세 포함 = the stored price; 부가세 별도 = worked out by the
  // database (empty when it cannot be, e.g. a 혼합 묶음상품 whose
  // 기준상품 has no price).
  {
    header: "매입단가(부가세 별도)",
    cell: (row) => numberCell(row.purchase_price_excl_vat),
  },
  {
    header: "매입단가(부가세 포함)",
    cell: (row) => numberCell(row.purchase_price_incl_vat),
  },
  {
    header: "판매단가(부가세 별도)",
    cell: (row) => numberCell(row.sale_price_excl_vat),
  },
  {
    header: "판매단가(부가세 포함)",
    cell: (row) => numberCell(row.sale_price_incl_vat),
  },
  {
    header: "유통기한 기준일수",
    cell: (row) => numberCell(row.effective_shelf_life_days),
  },
  {
    header: "알레르기 유발물질",
    // Already in the order the law lists them (listProductsForExport).
    cell: (row) =>
      csvCell(row.effective_allergens.map(allergenLabel).join(", ")),
  },
  {
    header: "사용여부",
    cell: (row) => csvCell(row.is_active ? "사용" : "사용중지"),
  },
  { header: "참고사항", cell: (row) => csvCell(row.note) },
  { header: "등록일", cell: (row) => csvCell(formatDateTime(row.created_at)) },
  {
    header: "최종수정일",
    cell: (row) => csvCell(formatDateTime(row.updated_at)),
  },
]

/**
 * 구성 of a 묶음상품: "PRC-010 ×6" for one kind of 기준상품 (its code and
 * quantity), "혼합 3종" for several; empty for a 기준상품.
 */
function compositionText(row: ProductExportRow): string | null {
  if (row.product_type !== "bundle") return null
  const composition = formatComposition({
    productType: row.product_type,
    componentCount: row.component_count,
    singleComponentQuantity: row.single_component_quantity,
  })
  return row.component_count === 1 && row.single_component_code
    ? `${row.single_component_code} ${composition}`
    : composition
}

/**
 * A text cell: in double quotes (with " doubled), so commas and line breaks
 * stay inside the cell. Text that starts with = + - @ (or a tab / line
 * break) gets a leading ' so Excel shows it as text instead of running it as
 * a formula (protection against "CSV injection").
 */
function csvCell(value: string | null): string {
  if (value === null || value === "") return ""
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${text.replaceAll('"', '""')}"`
}

/**
 * A number cell (empty when there is no value). Only digits (and a minus
 * sign for a negative number), so it can never be read as a formula.
 */
function numberCell(value: number | null): string {
  return value === null ? "" : String(value)
}

/**
 * 상품코드 / 바코드. Excel guesses the type of every CSV cell, even a quoted
 * one: "000123" becomes 123, a long barcode "8.8E+12", "3-15" and "1-2"
 * become dates, "1.10" becomes 1.1 and "1E5" becomes 100000. Writing a code
 * as ="3-15" keeps it as text, exactly as in the ERP.
 * Only codes made of letters, digits, ".", "-" and "_" (all codes, as the
 * database checks) are wrapped like that: they contain no quote, so nothing
 * else can be run as a formula. Anything else goes through csvCell.
 */
function codeCell(value: string | null): string {
  if (value === null || value === "") return ""
  if (/^[A-Za-z0-9._-]+$/.test(value)) return `"=""${value}"""`
  return csvCell(value)
}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}
