import type { Metadata } from "next"
import { unstable_rethrow } from "next/navigation"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import { InventoryNotReady } from "@/components/inventory/inventory-notices"
import { requireUser } from "@/lib/auth/user"
import {
  getProductStockLedger,
  getStockPlaceTree,
  INVENTORY_NOT_READY_MESSAGE,
  InventoryNotReadyError,
} from "@/lib/inventory/queries"
import { parseStockLedgerParams, todayInKorea } from "@/lib/inventory/schema"

import { InventoryScreenSkeleton } from "../_components/inventory-skeletons"
import { normalizePlaceIds } from "../_components/place-filter"
import { LedgerScreen } from "./_components/ledger-screen"

export const metadata: Metadata = {
  title: "상품별 거래수불",
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * "/inventory/ledger": 상품별 거래수불 (sidebar: 재고관리 → 상품별
 * 거래수불). One 기준상품's ledger lines in a 조회기간 (?product=<id>
 * &from=…&to=…, optionally &warehouse / &zone / &location) with the 이월
 * and the running 잔량. 상품별 재고현황 and 재고처별 재고현황 link here.
 * 엑셀 at /inventory/ledger/export.
 */
export default function StockLedgerPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageTitle
        title="상품별 거래수불"
        description="기준상품 하나의 입고·출고·폐기·이동·조정 내역과 날짜별 잔량을 봅니다."
      />
      <Suspense
        fallback={
          <InventoryScreenSkeleton
            label="상품별 거래수불을 불러오는 중…"
            searchCells={3}
          />
        }
      >
        <StockLedgerSection searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function StockLedgerSection({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await requireUser()
  const urlParams = parseStockLedgerParams(await searchParams)
  const today = todayInKorea()

  let loaded
  try {
    const places = await getStockPlaceTree()
    // Unknown places (deleted, typed by hand) are ignored.
    const params = { ...urlParams, ...normalizePlaceIds(places, urlParams) }
    const ledger = await getProductStockLedger(params)
    loaded = { places, params, ledger }
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof InventoryNotReadyError) {
      return <InventoryNotReady message={INVENTORY_NOT_READY_MESSAGE} />
    }
    throw error
  }

  return (
    <LedgerScreen
      params={loaded.params}
      ledger={loaded.ledger}
      places={loaded.places}
      today={today}
      productMissing={loaded.params.productId !== null && !loaded.ledger}
    />
  )
}
