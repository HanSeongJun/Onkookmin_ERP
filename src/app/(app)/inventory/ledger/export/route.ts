import type { NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/auth/user"
import {
  buildStockLedgerCsv,
  inventoryExportFileNames,
} from "@/lib/inventory/export"
import {
  getProductStockLedger,
  INVENTORY_NOT_READY_MESSAGE,
  InventoryNotReadyError,
} from "@/lib/inventory/queries"
import { parseStockLedgerParams } from "@/lib/inventory/schema"

import {
  csvResponse,
  firstSearchParams,
  textResponse,
} from "../../_components/export-response"

/**
 * GET /inventory/ledger/export?product=<id>&from=…&to=…[&warehouse|zone|
 * location=…]: the 엑셀 download of 상품별 거래수불 — the 이월 line, every
 * ledger line with its 잔량 and a 합계 line, as a CSV file Excel opens with
 * the Korean text intact (UTF-8 with BOM): 상품별거래수불_<상품코드>_
 * YYYYMMDD.csv. Only for signed-in employees. Columns: buildStockLedgerCsv
 * (`@/lib/inventory/export`).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return textResponse("로그인이 필요합니다. 다시 로그인해 주세요.", 401)
  }

  const params = parseStockLedgerParams(firstSearchParams(request))
  if (!params.productId) {
    return textResponse("거래수불을 볼 상품을 먼저 골라 주세요.", 400)
  }

  let ledger: Awaited<ReturnType<typeof getProductStockLedger>>
  try {
    ledger = await getProductStockLedger(params)
  } catch (error) {
    if (error instanceof InventoryNotReadyError) {
      return textResponse(INVENTORY_NOT_READY_MESSAGE, 503)
    }
    console.error("Could not export the stock ledger:", error)
    return textResponse(
      "엑셀 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
      500
    )
  }
  if (!ledger) {
    return textResponse("상품을 찾을 수 없습니다. 다시 골라 주세요.", 404)
  }

  const names = inventoryExportFileNames(
    `상품별거래수불_${ledger.product.code}`,
    "stock-ledger"
  )
  return csvResponse(buildStockLedgerCsv(ledger), {
    ...names,
    rows: ledger.lines.length,
  })
}
