import type { Metadata } from "next"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import { requireUser } from "@/lib/auth/user"
import { getEmployeeOptions } from "@/lib/employees/queries"
import { getPartnerCategoryTree } from "@/lib/partner-categories/queries"
import { findCategory } from "@/lib/partner-categories/tree"
import { hasAnyPartners, listPartners } from "@/lib/partners/queries"
import {
  defaultPartnerListParams,
  hasPartnerListFilters,
  PARTNER_CATEGORY_SCREEN_COLUMN_IDS,
  parsePartnerListParams,
  partnerSortState,
  type PartnerListParams,
} from "@/lib/partners/schema"

import type { PartnerListEmptyState } from "../_components/partner-list-screen"
import { PartnerListSkeleton } from "../_components/partner-skeletons"
import { PartnerCategoryScreen } from "./partner-category-screen"
import { PARTNER_CATEGORY_SETTINGS_PARAM } from "./settings-link"

export const metadata: Metadata = {
  title: "거래처분류설정",
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * 거래처분류설정 (/partners/categories), sidebar 거래처 → 거래처분류설정.
 *
 * - The partner list (검색어, 영업담당, 적용분류, 구분, 사용여부): check
 *   partners, then [분류적용 | F8] puts them into a category (any level)
 *   and [분류해제] makes them 미분류, in one request.
 * - [분류값 설정] opens the window where the 거래처분류 tree (대분류 >
 *   중분류 > 소분류) is edited and saved all at once. `?settings=1` opens
 *   it right away (the [분류값 설정] links of other screens use it).
 */
export default function PartnerCategoriesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageTitle
        title="거래처분류설정"
        description="거래처를 체크한 뒤 [분류적용]으로 분류에 넣거나 [분류해제]로 미분류로 되돌립니다. 분류(대분류·중분류·소분류)는 [분류값 설정]에서 만듭니다."
      />

      {/* The list depends on the URL and the signed-in user, so it loads at
          request time inside this boundary. */}
      <Suspense fallback={<PartnerListSkeleton />}>
        <PartnerCategorySection searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function PartnerCategorySection({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await requireUser()

  // Every category (as a tree) and employee, including switched-off and
  // 퇴사 ones (partners may still have them). listPartners reuses the
  // category read (cached).
  const [categories, employees] = await Promise.all([
    getPartnerCategoryTree(),
    getEmployeeOptions(),
  ])
  const rawParams = await searchParams
  const urlParams = parsePartnerListParams(rawParams)
  const sortState = partnerSortState(urlParams.sort)
  const params: PartnerListParams = {
    ...urlParams,
    // A category id that does not exist (deleted, typed by hand) is ignored.
    categoryId:
      urlParams.categoryId && findCategory(categories, urlParams.categoryId)
        ? urlParams.categoryId
        : null,
    // This screen has no 배송담당 / 업종 conditions: a link from 거래처관리
    // must not filter by something that is not shown.
    deliveryRepId: null,
    industry: null,
    // Only the columns of this screen's grid can be sorted here.
    sort:
      sortState === null ||
      (PARTNER_CATEGORY_SCREEN_COLUMN_IDS as readonly string[]).includes(
        sortState.column
      )
        ? urlParams.sort
        : defaultPartnerListParams.sort,
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

  const settings = rawParams[PARTNER_CATEGORY_SETTINGS_PARAM]
  return (
    <PartnerCategoryScreen
      params={{ ...params, page: list.page }}
      categories={categories}
      employees={employees}
      rows={list.rows}
      total={list.total}
      pageCount={list.pageCount}
      emptyState={emptyState}
      openSettingsOnLoad={
        (Array.isArray(settings) ? settings[0] : settings) === "1"
      }
    />
  )
}
