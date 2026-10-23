import type { NextRequest } from "next/server"

import { stockDocumentExportResponse } from "@/components/inventory/stock-document-export"

/**
 * GET /inventory/receipts/export?<the list's conditions>: the 엑셀 download
 * of the 입고 전표 list (입고, 기초재고 and their 취소 전표), as
 * 입고전표_YYYYMMDD.csv. Only for signed-in employees.
 */
export function GET(request: NextRequest) {
  return stockDocumentExportResponse("receipt", request)
}
