import type { Metadata } from "next"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import { requireUser } from "@/lib/auth/user"
import { getEmployeeOptions } from "@/lib/employees/queries"
import { getPartnerCategoryTree } from "@/lib/partner-categories/queries"
import { findCategory } from "@/lib/partner-categories/tree"
import { hasAnyPartners, listPartners } from "@/lib/partners/queries"
import {
  hasPartnerListFilters,
  parsePartnerListParams,
} from "@/lib/partners/schema"

import {
  PartnerListScreen,
  type PartnerListEmptyState,
} from "./_components/partner-list-screen"
import { PartnerListSkeleton } from "./_components/partner-skeletons"

export const metadata: Metadata = {
  title: "거래처관리",
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * "/partners": 거래처관리 (매출처, 매입처, 매출·매입 on one screen). The list
 * with its 조회 conditions and pages; 거래처 등록/수정 open as a modal on top
 * of it (?modal=new, ?modal=edit&id=…).
 */
export default function PartnersPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageTitle
        title="거래처관리"
        description="상품을 파는 곳(매출처)과 사 오는 곳(매입처)을 등록·수정하고 사용 여부를 관리합니다."
      />

      {/* The list depends on the URL and the signed-in user, so it loads at
          request time inside this boundary. */}
      <Suspense fallback={<PartnerListSkeleton />}>
        <PartnerListSection searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function PartnerListSection({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await requireUser()

  // All categories (as a tree) and employees, including switched-off and
  // 퇴사 ones (partners may still have them). listPartners reuses the
  // category read (cached).
  const [categories, employees] = await Promise.all([
    getPartnerCategoryTree(),
    getEmployeeOptions(),
  ])
  const urlParams = parsePartnerListParams(await searchParams)
  // A category id that does not exist (deleted, typed by hand) is ignored.
  const params = {
    ...urlParams,
    categoryId:
      urlParams.categoryId && findCategory(categories, urlParams.categoryId)
        ? urlParams.categoryId
        : null,
  }
  const list = await listPartners(params)

  let emptyState: PartnerListEmptyState = "none"
  if (list.rows.length === 0) {
    if (hasPartnerListFilters(params)) {
      emptyState = "no-match"
    } else {
      emptyState = (await hasAnyPartners()) ? "all-inactive" : "no-partners"
    }
  }

  return (
    <PartnerListScreen
      params={{ ...params, page: list.page }}
      categories={categories}
      employees={employees}
      rows={list.rows}
      total={list.total}
      pageCount={list.pageCount}
      emptyState={emptyState}
    />
  )
}
