import type { Metadata } from "next"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import {
  InventoryNotReady,
  StockDocumentListSkeleton,
} from "@/components/inventory/inventory-notices"
import { loadStockDocumentListData } from "@/components/inventory/stock-document-data"

import { IssueScreen } from "./_components/issue-screen"

export const metadata: Metadata = {
  title: "출고 등록",
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * "/inventory/issues": 출고 등록 (manual 출고; the future 주문 module uses
 * the same FEFO allocation). The list of 출고 전표 and their 취소 전표;
 * 출고 등록 and 전표 보기 open as a modal on top of it (?modal=new,
 * ?modal=view&id=…). The lots are chosen by FEFO (기한 빠른 로트부터).
 */
export default function IssuesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageTitle
        title="출고 등록"
        description="나간 상품을 등록합니다. 로트는 기한이 빠른 것부터 자동으로 고르고(FEFO), 기한이 지난 재고는 내보내지 않습니다."
      />
      {/* The list depends on the URL and the signed-in user. */}
      <Suspense fallback={<StockDocumentListSkeleton />}>
        <IssuesSection searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function IssuesSection({ searchParams }: { searchParams: SearchParams }) {
  const data = await loadStockDocumentListData("issue", await searchParams)
  if (!data.ok) return <InventoryNotReady message={data.message} />
  return <IssueScreen data={data} />
}
