import type { NextRequest } from "next/server"

import { stockDocumentExportResponse } from "@/components/inventory/stock-document-export"

/**
 * GET /inventory/issues/export?<the list's conditions>: the 엑셀 download
 * of the 출고 전표 list (출고 and their 취소 전표), as
 * 출고전표_YYYYMMDD.csv. Only for signed-in employees.
 */
export function GET(request: NextRequest) {
  return stockDocumentExportResponse("issue", request)
}
