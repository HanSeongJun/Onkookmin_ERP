import type { NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/auth/user"
import {
  buildStockReportCsv,
  inventoryExportFileNames,
} from "@/lib/inventory/export"
import {
  getStockPeriodReportForExport,
  INVENTORY_NOT_READY_MESSAGE,
  InventoryNotReadyError,
} from "@/lib/inventory/queries"
import { parseStockReportParams } from "@/lib/inventory/schema"

import {
  csvResponse,
  firstSearchParams,
  textResponse,
} from "../_components/export-response"

/**
 * GET /inventory/export?<상품별 재고현황's conditions>: the 엑셀 download.
 *
 * Every 기준상품 matching the same conditions as the screen (all pages, at
 * most 10,000, in the screen's sort order) with a 총계 line, as a CSV file
 * that Excel opens with the Korean text intact (UTF-8 with BOM). File name
 * 상품별재고현황_YYYYMMDD.csv (date in Korea). Only for signed-in
 * employees. Columns: buildStockReportCsv (`@/lib/inventory/export`).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return textResponse("로그인이 필요합니다. 다시 로그인해 주세요.", 401)
  }

  const params = parseStockReportParams(firstSearchParams(request))

  let report: Awaited<ReturnType<typeof getStockPeriodReportForExport>>
  try {
    report = await getStockPeriodReportForExport(params)
  } catch (error) {
    if (error instanceof InventoryNotReadyError) {
      return textResponse(INVENTORY_NOT_READY_MESSAGE, 503)
    }
    console.error("Could not export the stock report:", error)
    return textResponse(
      "엑셀 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
      500
    )
  }

  return csvResponse(buildStockReportCsv(report), {
    ...inventoryExportFileNames("상품별재고현황", "stock-report"),
    rows: report.rows.length,
  })
}
