import type { Metadata } from "next"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import { Skeleton } from "@/components/ui/skeleton"
import { requireUser } from "@/lib/auth/user"
import { getCategoryTree } from "@/lib/categories/queries"

import { CategoryTable } from "./category-table"

export const metadata: Metadata = {
  title: "상품분류설정",
}

/**
 * 상품분류설정 (/products/categories): add, rename, reorder, switch off and
 * delete the 대분류, 중분류 and 소분류 used to group products.
 * Sidebar: 상품 → 상품분류설정. The 상품 등록/수정 window opens it in a new
 * tab with its "분류값 설정" button. Categories are optional: a product
 * without one is "미분류".
 */
export default function CategoriesPage() {
  return (
    <>
      <PageTitle
        title="상품분류설정"
        description="상품을 대분류 → 중분류 → 소분류 3단계까지 나눕니다. 분류 없이도 상품을 등록할 수 있습니다(미분류)."
      />

      {/* Loading the categories needs the login session, so it streams in here. */}
      <Suspense fallback={<CategoryTableSkeleton />}>
        <Categories />
      </Suspense>
    </>
  )
}

/** Loads every category, including switched-off ones. */
async function Categories() {
  await requireUser()
  const categories = await getCategoryTree({ includeInactive: true })
  return <CategoryTable categories={categories} />
}

/** Placeholder with the outline of the screen while the categories load. */
function CategoryTableSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only">분류를 불러오는 중…</span>
      <Skeleton className="h-8 w-36 rounded-sm" />
      <Skeleton className="h-4 w-80 max-w-full rounded-sm" />
      <div className="flex flex-col gap-px border border-grid-line">
        <Skeleton className="h-9 rounded-none bg-brand-tint-strong" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-8 rounded-none" />
        ))}
      </div>
    </div>
  )
}
