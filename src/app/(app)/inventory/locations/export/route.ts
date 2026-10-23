import type { NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/auth/user"
import {
  buildLotStockCsv,
  inventoryExportFileNames,
} from "@/lib/inventory/export"
import {
  INVENTORY_NOT_READY_MESSAGE,
  InventoryNotReadyError,
  listLotStockForExport,
} from "@/lib/inventory/queries"
import { parseLotStockParams } from "@/lib/inventory/schema"

import {
  csvResponse,
  firstSearchParams,
  textResponse,
} from "../../_components/export-response"

/**
 * GET /inventory/locations/export?<재고처별 재고현황's conditions>: the 엑셀
 * download. Every (로트 × 위치) row with stock matching the same conditions
 * as the screen (all pages, at most 10,000, in the screen's sort order) as
 * a CSV file Excel opens with the Korean text intact (UTF-8 with BOM):
 * 재고처별재고현황_YYYYMMDD.csv. Only for signed-in employees. Columns:
 * buildLotStockCsv (`@/lib/inventory/export`).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return textResponse("로그인이 필요합니다. 다시 로그인해 주세요.", 401)
  }

  const params = parseLotStockParams(firstSearchParams(request))

  let result: Awaited<ReturnType<typeof listLotStockForExport>>
  try {
    result = await listLotStockForExport(params)
  } catch (error) {
    if (error instanceof InventoryNotReadyError) {
      return textResponse(INVENTORY_NOT_READY_MESSAGE, 503)
    }
    console.error("Could not export the lot stock:", error)
    return textResponse(
      "엑셀 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
      500
    )
  }

  return csvResponse(buildLotStockCsv(result.rows), {
    ...inventoryExportFileNames("재고처별재고현황", "lot-stock"),
    rows: result.rows.length,
  })
}
