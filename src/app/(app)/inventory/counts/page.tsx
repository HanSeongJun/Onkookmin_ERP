import type { Metadata } from "next"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import { InventoryNotReady } from "@/components/inventory/inventory-notices"
import { requireUser } from "@/lib/auth/user"
import {
  getStockProductOptions,
  INVENTORY_NOT_READY_MESSAGE,
  InventoryNotReadyError,
  listStockDocuments,
} from "@/lib/inventory/queries"
import {
  parseStockDocumentListParams,
  STOCK_DOCUMENT_SCREENS,
} from "@/lib/inventory/schema"

import { CountListScreen } from "./_components/count-list-screen"
import { CountListSkeleton } from "./_components/count-skeletons"

export const metadata: Metadata = {
  title: STOCK_DOCUMENT_SCREENS.count.title,
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * "/inventory/counts": 실사재고조정. The list of 실사조정 전표 (and their
 * 취소 전표) with 조회 conditions; 실사 등록 and 전표 보기 open as a modal
 * on top of it (?modal=new, ?modal=view&id=…). A 전표 is never edited:
 * a wrong one is undone with [전표 취소] (a 취소 전표).
 */
export default function StockCountsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageTitle
        title={STOCK_DOCUMENT_SCREENS.count.title}
        description="창고에서 직접 센 수량(실사 수량)을 입력하면, 전산 재고와 다른 만큼만 늘리거나 줄입니다."
      />

      {/* The list depends on the URL and the signed-in user, so it loads at
          request time inside this boundary. */}
      <Suspense fallback={<CountListSkeleton />}>
        <CountListSection searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function CountListSection({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await requireUser()
  const params = parseStockDocumentListParams(await searchParams)

  let loaded: Awaited<ReturnType<typeof loadList>> | null = null
  try {
    loaded = await loadList(params)
  } catch (error) {
    // The 재고 DB 변경 is not applied yet (hosted DB before db:push).
    if (!(error instanceof InventoryNotReadyError)) throw error
  }
  if (!loaded) {
    return <InventoryNotReady message={INVENTORY_NOT_READY_MESSAGE} />
  }

  const { list, product } = loaded
  return (
    <CountListScreen
      params={{ ...params, page: list.page }}
      rows={list.rows}
      total={list.total}
      pageCount={list.pageCount}
      productLabel={product ? `[${product.code}] ${product.name}` : null}
    />
  )
}

async function loadList(
  params: ReturnType<typeof parseStockDocumentListParams>
) {
  const [list, products] = await Promise.all([
    listStockDocuments(STOCK_DOCUMENT_SCREENS.count.types, params),
    params.productId
      ? getStockProductOptions([params.productId])
      : Promise.resolve([]),
  ])
  return { list, product: products[0] ?? null }
}
