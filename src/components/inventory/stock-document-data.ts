import "server-only"

import { requireUser } from "@/lib/auth/user"
import {
  getInventorySettings,
  getStockProductOptions,
  INVENTORY_NOT_READY_MESSAGE,
  InventoryNotReadyError,
  listStockDocuments,
  type StockDocumentRow,
} from "@/lib/inventory/queries"
import {
  parseStockDocumentListParams,
  type StockDocumentListParams,
  type StockDocumentScreen,
} from "@/lib/inventory/schema"
import { createClient } from "@/lib/supabase/server"
import type { StockDocumentType } from "@/lib/inventory/constants"

import {
  parseStockDocumentKind,
  stockDocumentListTypes,
} from "./document-screens"

/** What a 전표 list page needs (or why it cannot be shown). */
export type StockDocumentListData =
  | {
      ok: true
      screen: StockDocumentScreen
      /** The list's conditions (page clamped to the last page). */
      params: StockDocumentListParams
      /** 구분 filter (URL "kind", 입고 등록: 입고 / 기초재고), or null = all. */
      kind: StockDocumentType | null
      rows: StockDocumentRow[]
      total: number
      pageCount: number
      /** 기한 임박 기준일 (재고 설정), for the D-day badges. */
      expiryWarningDays: number
      /** Names of the 상품 / 거래처 conditions from the URL (for the chips). */
      filterLabels: { product: string | null; partner: string | null }
    }
  | { ok: false; message: string }

/**
 * Reads one page of a 전표 screen's list for its page (Server Component,
 * inside <Suspense>): checks the login, reads the URL's conditions, the
 * 전표 of the screen's kinds, the 기한 임박 기준일 and the names of the
 * 상품 / 거래처 conditions. `{ ok: false }` with the Korean notice when the
 * 재고 migration is not applied yet.
 *
 * @example
 * const data = await loadStockDocumentListData("receipt", await searchParams)
 * if (!data.ok) return <InventoryNotReady message={data.message} />
 * return <ReceiptScreen data={data} />
 */
export async function loadStockDocumentListData(
  screen: StockDocumentScreen,
  searchParams: Record<string, string | string[] | undefined>
): Promise<StockDocumentListData> {
  await requireUser()
  const params = parseStockDocumentListParams(searchParams)
  const kind = parseStockDocumentKind(screen, searchParams.kind)
  try {
    const [list, settings, product, partner] = await Promise.all([
      listStockDocuments(stockDocumentListTypes(screen, kind), params),
      getInventorySettings(),
      params.productId
        ? getStockProductOptions([params.productId]).then(
            (options) => options[0] ?? null
          )
        : null,
      params.partnerId ? readPartnerLabel(params.partnerId) : null,
    ])
    return {
      ok: true,
      screen,
      params: { ...params, page: list.page },
      kind,
      rows: list.rows,
      total: list.total,
      pageCount: list.pageCount,
      expiryWarningDays: settings.expiryWarningDays,
      filterLabels: {
        product: product ? `${product.code} ${product.name}` : null,
        partner,
      },
    }
  } catch (error) {
    if (error instanceof InventoryNotReadyError) {
      return { ok: false, message: INVENTORY_NOT_READY_MESSAGE }
    }
    throw error
  }
}

/** "코드 이름" of a 거래처, or null when there is none. */
async function readPartnerLabel(partnerId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("partners")
    .select("code, name")
    .eq("id", partnerId)
    .maybeSingle()
  if (error) {
    console.error("Could not read a partner name:", error)
    return null
  }
  return data ? `${data.code} ${data.name}` : null
}
