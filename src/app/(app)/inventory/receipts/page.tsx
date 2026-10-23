import type { Metadata } from "next"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import {
  InventoryNotReady,
  StockDocumentListSkeleton,
} from "@/components/inventory/inventory-notices"
import { loadStockDocumentListData } from "@/components/inventory/stock-document-data"

import { ReceiptScreen } from "./_components/receipt-screen"

export const metadata: Metadata = {
  title: "입고 등록",
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * "/inventory/receipts": 입고 등록. The list of 입고 전표 (with the 기초재고
 * 전표 of 자료일괄등록 and the 취소 전표 of both); 입고 등록 and 전표 보기
 * open as a modal on top of it (?modal=new, ?modal=view&id=…). Every 입고
 * line makes a new lot (a 묶음상품 one per 기준상품).
 */
export default function ReceiptsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageTitle
        title="입고 등록"
        description="들어온 상품을 로트(기한·위치별)로 등록합니다. 묶음상품은 구성표대로 기준상품 재고가 됩니다."
      />
      {/* The list depends on the URL and the signed-in user. */}
      <Suspense fallback={<StockDocumentListSkeleton />}>
        <ReceiptsSection searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function ReceiptsSection({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const data = await loadStockDocumentListData("receipt", await searchParams)
  if (!data.ok) return <InventoryNotReady message={data.message} />
  return <ReceiptScreen data={data} />
}
