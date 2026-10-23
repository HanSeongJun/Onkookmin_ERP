import type { Metadata } from "next"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import { Skeleton } from "@/components/ui/skeleton"
import { requireUser } from "@/lib/auth/user"
import { hasAnyEmployees, listEmployees } from "@/lib/employees/queries"
import {
  hasEmployeeListFilters,
  parseEmployeeListParams,
} from "@/lib/employees/schema"

import {
  EmployeeListScreen,
  type EmployeeListEmptyState,
} from "./_components/employee-list-screen"

export const metadata: Metadata = {
  title: "직원관리",
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

/**
 * "/employees": 직원관리 (sidebar: 기초정보 → 직원관리). The staff list
 * with its 조회 conditions and pages; 직원 등록/수정 open as a modal on top
 * of it (?modal=new, ?modal=edit&id=…). 거래처 choose their 영업담당
 * (판매 플랫폼·영업 담당자) and 배송담당 (직배송 기사) from this list.
 * Employees are never deleted (재직 / 퇴사).
 */
export default function EmployeesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  return (
    <>
      <PageTitle
        title="직원관리"
        description="직원과 판매 플랫폼, 배송 기사를 관리합니다. 거래처의 영업담당·배송담당은 이 명단에서 고릅니다."
      />

      {/* The list depends on the URL and the signed-in user, so it loads at
          request time inside this boundary. */}
      <Suspense fallback={<EmployeeListSkeleton />}>
        <EmployeeListSection searchParams={searchParams} />
      </Suspense>
    </>
  )
}

async function EmployeeListSection({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await requireUser()
  const params = parseEmployeeListParams(await searchParams)
  const list = await listEmployees(params)

  let emptyState: EmployeeListEmptyState = "none"
  if (list.rows.length === 0) {
    if (hasEmployeeListFilters(params)) {
      emptyState = "no-match"
    } else {
      emptyState = (await hasAnyEmployees()) ? "all-inactive" : "no-employees"
    }
  }

  return (
    <EmployeeListScreen
      params={{ ...params, page: list.page }}
      rows={list.rows}
      total={list.total}
      pageCount={list.pageCount}
      emptyState={emptyState}
    />
  )
}

/** Placeholder for the 직원관리 screen while it loads. */
function EmployeeListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true">
      <span className="sr-only">직원 목록을 불러오는 중…</span>
      <div className="flex flex-wrap gap-1.5">
        {[16, 16, 20, 20].map((width, index) => (
          <Skeleton
            key={index}
            className="h-8 rounded-sm"
            style={{ width: `${width * 0.25}rem` }}
          />
        ))}
      </div>
      <div className="grid grid-cols-1 border-t border-l border-input md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="flex min-h-10 border-r border-b border-input"
          >
            <div className="w-24 shrink-0 bg-label sm:w-28" />
            <div className="flex flex-1 items-center px-2">
              <Skeleton className="h-6 w-full max-w-56 rounded-sm" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-5 w-36 rounded-sm" />
      <div className="flex flex-col gap-px border border-input">
        <Skeleton className="h-9 rounded-none bg-brand-tint-strong" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-8 rounded-none" />
        ))}
      </div>
    </div>
  )
}
