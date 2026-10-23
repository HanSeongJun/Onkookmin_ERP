import type { NextRequest } from "next/server"

import { stockDocumentExportResponse } from "@/components/inventory/stock-document-export"

/**
 * GET /inventory/disposals/export?<the list's conditions>: the 엑셀 download
 * of the 폐기 전표 list (폐기 and their 취소 전표), as
 * 폐기전표_YYYYMMDD.csv. Only for signed-in employees.
 */
export function GET(request: NextRequest) {
  return stockDocumentExportResponse("disposal", request)
}
