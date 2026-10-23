import type { NextRequest } from "next/server"

import { stockDocumentExportResponse } from "@/components/inventory/stock-document-export"

/**
 * GET /inventory/counts/export?<the list's conditions>: the 엑셀 download
 * of the 실사조정 전표 list (and 취소 전표 of one), as
 * 실사조정전표_YYYYMMDD.csv. Only for signed-in employees.
 */
export function GET(request: NextRequest) {
  return stockDocumentExportResponse("count", request)
}
