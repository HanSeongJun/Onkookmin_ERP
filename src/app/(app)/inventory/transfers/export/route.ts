import type { NextRequest } from "next/server"

import { stockDocumentExportResponse } from "@/components/inventory/stock-document-export"

/**
 * GET /inventory/transfers/export?<the list's conditions>: the 엑셀 download
 * of the 이동 전표 list (이동 and their 취소 전표), as
 * 이동전표_YYYYMMDD.csv. Only for signed-in employees.
 */
export function GET(request: NextRequest) {
  return stockDocumentExportResponse("transfer", request)
}
