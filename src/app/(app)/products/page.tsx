import type { Metadata } from "next"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import { requireUser } from "@/lib/auth/user"
import { findCategory } from "@/lib/categories/tree"
import {
  getAllCategories,
  hasAnyProducts,
  listProducts,
} from "@/lib/products/queries"
import {
  hasProductListFilters,
  parseProductListParams,
} from "@/lib/products/schema"

import {
  ProductListScreen,
  type ProductListEmptyState,
} from "./_components/product-list-screen"
import { ProductListSkeleton } from "./_components/product-skeletons"

export const metadata: Metadata = {
  title: "상품관리",
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * "/products": 상품관리. The list with its 조회 conditions and pages; 상품
 * 등록/수정 open as a modal on top of it (?modal=new, ?modal=edit&id=…).
 */
export default function ProductsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageTitle
        title="상품관리"
        description="취급하는 식자재 상품을 등록·수정하고 사용 여부를 관리합니다."
      />

      {/* The list depends on the URL and the signed-in user, so it loads at
          request time inside this boundary. */}
      <Suspense fallback={<ProductListSkeleton />}>
        <ProductListSection searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function ProductListSection({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await requireUser()

  // All categories, including switched-off ones (products may still be in
  // them). listProducts reuses this read (getAllCategories is cached).
  const categories = await getAllCategories()
  const urlParams = parseProductListParams(await searchParams)
  // A category id that does not exist (deleted, typed by hand) is ignored.
  const params = {
    ...urlParams,
    categoryId:
      urlParams.categoryId && findCategory(categories, urlParams.categoryId)
        ? urlParams.categoryId
        : null,
  }
  const list = await listProducts(params)

  let emptyState: ProductListEmptyState = "none"
  if (list.rows.length === 0) {
    if (hasProductListFilters(params)) {
      emptyState = "no-match"
    } else {
      emptyState = (await hasAnyProducts()) ? "all-inactive" : "no-products"
    }
  }

  return (
    <ProductListScreen
      params={{ ...params, page: list.page }}
      categories={categories}
      rows={list.rows}
      total={list.total}
      pageCount={list.pageCount}
      emptyState={emptyState}
    />
  )
}
