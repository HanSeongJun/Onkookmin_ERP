import "server-only"

import type { NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/auth/user"
import {
  buildStockDocumentCsv,
  inventoryExportFileNames,
} from "@/lib/inventory/export"
import {
  InventoryNotReadyError,
  INVENTORY_NOT_READY_MESSAGE,
  listStockDocumentsForExport,
} from "@/lib/inventory/queries"
import {
  parseStockDocumentListParams,
  type StockDocumentScreen,
} from "@/lib/inventory/schema"

import {
  parseStockDocumentKind,
  STOCK_DOCUMENT_SCREEN_TEXT,
  stockDocumentListTypes,
} from "./document-screens"

/**
 * The 엑셀 download of a 전표 list (the body of a Route Handler):
 * every 전표 matching the list's conditions (all pages, at most 10,000,
 * newest first) as a CSV file that Excel opens with the Korean text intact,
 * named e.g. 입고전표_20261023.csv (date in Korea). Only for signed-in
 * employees; the header X-Export-Rows tells the 엑셀 button how many rows
 * the file has.
 *
 * @example
 * // src/app/(app)/inventory/receipts/export/route.ts
 * export function GET(request: NextRequest) {
 *   return stockDocumentExportResponse("receipt", request)
 * }
 */
export async function stockDocumentExportResponse(
  screen: StockDocumentScreen,
  request: NextRequest
): Promise<Response> {
  const user = await getCurrentUser()
  if (!user) {
    return textResponse("로그인이 필요합니다. 다시 로그인해 주세요.", 401)
  }

  // Same reading of the conditions as the list page (first value of each).
  const searchParams: Record<string, string> = {}
  for (const [key, value] of request.nextUrl.searchParams) {
    if (!(key in searchParams)) searchParams[key] = value
  }
  const params = parseStockDocumentListParams(searchParams)

  let result: Awaited<ReturnType<typeof listStockDocumentsForExport>>
  try {
    result = await listStockDocumentsForExport(
      stockDocumentListTypes(
        screen,
        parseStockDocumentKind(screen, searchParams.kind)
      ),
      params
    )
  } catch (error) {
    if (error instanceof InventoryNotReadyError) {
      return textResponse(INVENTORY_NOT_READY_MESSAGE, 503)
    }
    console.error(`Could not export ${screen} documents:`, error)
    return textResponse(
      "엑셀 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
      500
    )
  }

  const text = STOCK_DOCUMENT_SCREEN_TEXT[screen]
  const { fileName, asciiFileName } = inventoryExportFileNames(
    text.exportName,
    text.exportAsciiName
  )
  return new Response(buildStockDocumentCsv(result.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Export-Rows": String(result.rows.length),
      "X-Export-Total": String(result.total),
    },
  })
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
