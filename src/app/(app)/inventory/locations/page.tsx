import type { Metadata } from "next"
import { unstable_rethrow } from "next/navigation"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import { InventoryNotReady } from "@/components/inventory/inventory-notices"
import { requireUser } from "@/lib/auth/user"
import {
  getStockPlaceTree,
  getStockProductOptions,
  INVENTORY_NOT_READY_MESSAGE,
  InventoryNotReadyError,
  listLotStock,
} from "@/lib/inventory/queries"
import { parseLotStockParams } from "@/lib/inventory/schema"

import { InventoryScreenSkeleton } from "../_components/inventory-skeletons"
import { normalizePlaceIds } from "../_components/place-filter"
import {
  LotStockScreen,
  type LotStockProductFilter,
} from "./_components/lot-stock-screen"

export const metadata: Metadata = {
  title: "재고처별 재고현황",
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * "/inventory/locations": 재고처별 재고현황 (sidebar: 재고관리 → 재고처별
 * 재고현황). The stock on hand per (로트 × 위치), filtered by the 창고 >
 * 구역 > 위치 tree, 기한 상태 (?expiry=expired|imminent|attention…),
 * 보관온도 불일치 (?mismatch=1) and 상품 (?product=<id>); the dashboard
 * cards link here. Checked rows go to 이동 / 폐기 등록. 엑셀 at
 * /inventory/locations/export.
 */
export default function LotStockPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageTitle
        title="재고처별 재고현황"
        description="창고·구역·선반별로 로트(기한)마다 남은 재고와 기한, 보관온도를 확인합니다."
      />
      <Suspense
        fallback={
          <InventoryScreenSkeleton
            label="재고처별 재고현황을 불러오는 중…"
            searchCells={6}
          />
        }
      >
        <LotStockSection searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function LotStockSection({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await requireUser()
  const urlParams = parseLotStockParams(await searchParams)

  let loaded
  try {
    const [places, products] = await Promise.all([
      getStockPlaceTree(),
      urlParams.productId
        ? getStockProductOptions([urlParams.productId])
        : Promise.resolve([]),
    ])
    const found = products[0]
    const product: LotStockProductFilter | null = found
      ? { id: found.id, code: found.code, name: found.name }
      : null
    // Unknown places and products (deleted, typed by hand) are ignored; a
    // 위치 brings its 구역 and 창고 (for the tree).
    const params = {
      ...urlParams,
      ...normalizePlaceIds(places, urlParams),
      productId: product ? product.id : null,
    }
    const list = await listLotStock(params)
    loaded = { places, list, product, params }
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof InventoryNotReadyError) {
      return <InventoryNotReady message={INVENTORY_NOT_READY_MESSAGE} />
    }
    throw error
  }

  return (
    <LotStockScreen
      params={{ ...loaded.params, page: loaded.list.page }}
      list={loaded.list}
      places={loaded.places}
      product={loaded.product}
    />
  )
}
