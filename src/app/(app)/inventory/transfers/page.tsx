import type { Metadata } from "next"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import {
  InventoryNotReady,
  StockDocumentListSkeleton,
} from "@/components/inventory/inventory-notices"
import { loadStockDocumentListData } from "@/components/inventory/stock-document-data"

import { TransferScreen } from "./_components/transfer-screen"

export const metadata: Metadata = {
  title: "재고처간 이동등록",
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * "/inventory/transfers": 재고처간 이동등록. The list of 이동 전표 and their
 * 취소 전표; 이동 등록 and 전표 보기 open as a modal on top of it
 * (?modal=new, ?modal=view&id=…). 재고처별 재고현황 opens the 등록 modal
 * with its checked rows (?modal=new&balances=<id>,<id>).
 */
export default function TransfersPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageTitle
        title="재고처간 이동등록"
        description="로트를 다른 창고·구역·위치로 옮깁니다. 전체 재고 수량은 그대로이고 위치만 바뀝니다."
      />
      {/* The list depends on the URL and the signed-in user. */}
      <Suspense fallback={<StockDocumentListSkeleton />}>
        <TransfersSection searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function TransfersSection({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const data = await loadStockDocumentListData("transfer", await searchParams)
  if (!data.ok) return <InventoryNotReady message={data.message} />
  return <TransferScreen data={data} />
}
