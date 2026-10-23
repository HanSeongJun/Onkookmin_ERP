import type { Metadata } from "next"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import {
  InventoryNotReady,
  StockDocumentListSkeleton,
} from "@/components/inventory/inventory-notices"
import { loadStockDocumentListData } from "@/components/inventory/stock-document-data"

import { DisposalScreen } from "./_components/disposal-screen"

export const metadata: Metadata = {
  title: "폐기 등록",
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * "/inventory/disposals": 폐기 등록. The list of 폐기 전표 and their 취소
 * 전표; 폐기 등록 and 전표 보기 open as a modal on top of it (?modal=new,
 * ?modal=view&id=…). 재고처별 재고현황 opens the 등록 modal with its
 * checked rows (?modal=new&balances=<id>,<id>).
 */
export default function DisposalsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageTitle
        title="폐기 등록"
        description="기한이 지났거나 파손·품질 불량인 재고를 로트별로 폐기합니다. 폐기한 수량은 재고에서 빠집니다."
      />
      {/* The list depends on the URL and the signed-in user. */}
      <Suspense fallback={<StockDocumentListSkeleton />}>
        <DisposalsSection searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function DisposalsSection({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const data = await loadStockDocumentListData("disposal", await searchParams)
  if (!data.ok) return <InventoryNotReady message={data.message} />
  return <DisposalScreen data={data} />
}
