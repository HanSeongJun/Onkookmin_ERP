import type { Metadata } from "next"
import { unstable_rethrow } from "next/navigation"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import { InventoryNotReady } from "@/components/inventory/inventory-notices"
import { requireUser } from "@/lib/auth/user"
import { findCategory } from "@/lib/categories/tree"
import {
  getInventorySettings,
  getStockPeriodReport,
  getStockPlaceTree,
  INVENTORY_NOT_READY_MESSAGE,
  InventoryNotReadyError,
} from "@/lib/inventory/queries"
import { parseStockReportParams, todayInKorea } from "@/lib/inventory/schema"
import { getAllCategories } from "@/lib/products/queries"

import { InventoryScreenSkeleton } from "./_components/inventory-skeletons"
import { normalizePlaceIds } from "./_components/place-filter"
import { StockReportScreen } from "./_components/stock-report-screen"

export const metadata: Metadata = {
  title: "상품별 재고현황",
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * "/inventory": 상품별 재고현황 (sidebar: 재고관리 → 상품별 재고현황). One
 * row per 기준상품: 이월재고, the period's 입고 / 출고 / 조정 / 폐기 / 이동,
 * 기말재고, 재고단가 and 재고금액 (부가세 포함 / 별도), the earliest 기한
 * of the stock left. A product opens 상품별 거래수불; 엑셀 at
 * /inventory/export.
 */
export default function StockReportPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageTitle
        title="상품별 재고현황"
        description="조회기간의 이월·입고·출고·조정·폐기와 기말재고, 재고금액을 기준상품별로 봅니다."
      />

      {/* The report depends on the URL and the signed-in user, so it loads
          at request time inside this boundary. */}
      <Suspense
        fallback={
          <InventoryScreenSkeleton label="상품별 재고현황을 불러오는 중…" />
        }
      >
        <StockReportSection searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function StockReportSection({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await requireUser()
  const urlParams = parseStockReportParams(await searchParams)
  const today = todayInKorea()

  let loaded
  try {
    const [categories, places, settings] = await Promise.all([
      getAllCategories(),
      getStockPlaceTree(),
      getInventorySettings(),
    ])
    // Ids that do not exist (deleted, typed by hand) are ignored.
    const place = normalizePlaceIds(places, {
      warehouseId: urlParams.warehouseId,
      zoneId: urlParams.zoneId,
      locationId: null,
    })
    const params = {
      ...urlParams,
      categoryId:
        urlParams.categoryId && findCategory(categories, urlParams.categoryId)
          ? urlParams.categoryId
          : null,
      warehouseId: place.warehouseId,
      zoneId: place.zoneId,
    }
    const report = await getStockPeriodReport(params)
    loaded = { categories, places, settings, params, report }
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof InventoryNotReadyError) {
      return <InventoryNotReady message={INVENTORY_NOT_READY_MESSAGE} />
    }
    throw error
  }

  return (
    <StockReportScreen
      params={{ ...loaded.params, page: loaded.report.page }}
      report={loaded.report}
      categories={loaded.categories}
      places={loaded.places}
      today={today}
      warningDays={loaded.settings.expiryWarningDays}
    />
  )
}
