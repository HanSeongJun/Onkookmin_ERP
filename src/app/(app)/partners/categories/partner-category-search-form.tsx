"use client"

import { SearchField, SearchPanel } from "@/components/erp/search-panel"
import type { EmployeeOption } from "@/lib/employees/schema"
import type { PartnerCategoryNode } from "@/lib/partner-categories/tree"
import type { PartnerType } from "@/lib/partners/constants"
import {
  PARTNER_STATUS_FILTERS,
  PARTNER_TYPE_FILTERS,
  type PartnerListParams,
  type PartnerStatusFilter,
} from "@/lib/partners/schema"

import {
  ALL,
  FilterSelect,
  PartnerCategoryFilter,
  PartnerSearchBox,
  repFilterOptions,
} from "../_components/partner-search-form"

/** Id of the search <form>; the 조회 button submits it with form="…". */
export const PARTNER_CATEGORY_SEARCH_FORM_ID = "partner-category-search"

/**
 * 조회 conditions of the 거래처분류설정 screen, like the reference screen:
 * 검색어, 영업담당, 적용분류 (+ 미분류 거래처만 보기), 구분, 사용여부.
 *
 * - 검색어: same as on 거래처관리 (거래처명, 거래처코드, 상호, 대표자,
 *   사업자번호, 연락처). Applied with Enter or 조회 (F4).
 * - The selects, the 적용분류 picker and the checkbox apply right away.
 *   적용분류 (any level) also finds the partners in every category below it.
 */
export function PartnerCategorySearchForm({
  formRef,
  shown,
  categories,
  employees,
  onSearch,
  onChange,
  onOpenCategoryPicker,
}: {
  formRef: React.Ref<HTMLFormElement>
  /** The conditions as shown (may be ahead of the loaded list). */
  shown: PartnerListParams
  /** Every 거래처분류 (사용 중지 too: partners may still be in them). */
  categories: PartnerCategoryNode[]
  /** Every employee (퇴사 too: partners may still have them). */
  employees: EmployeeOption[]
  /** 조회: run the search with this text (and everything else as shown). */
  onSearch: (q: string) => void
  /** A select, the picker or the checkbox changed. */
  onChange: (changes: Partial<PartnerListParams>) => void
  /** Opens the 적용분류 picker (the filter). */
  onOpenCategoryPicker: () => void
}) {
  return (
    <form
      ref={formRef}
      id={PARTNER_CATEGORY_SEARCH_FORM_ID}
      role="search"
      aria-label="거래처 조회 조건"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        onSearch(String(data.get("q") ?? "").trim())
      }}
    >
      <SearchPanel>
        <SearchField label="검색어" htmlFor="partner-search-q" span={2}>
          {/* The key resets the box when the search changes from outside
              (조건 초기화, the back button). */}
          <PartnerSearchBox key={shown.q} initialValue={shown.q} />
        </SearchField>

        {/* The spans fill every row on each screen width (no gaps). */}
        <SearchField
          label="영업담당"
          htmlFor="partner-category-sales-rep"
          className="md:col-span-2 xl:col-span-1 2xl:col-span-2"
        >
          <FilterSelect
            id="partner-category-sales-rep"
            value={shown.salesRepId ?? ALL}
            options={repFilterOptions(employees, "sales", shown.salesRepId)}
            onChange={(value) =>
              onChange({ salesRepId: value === ALL ? null : value })
            }
          />
        </SearchField>

        <SearchField label="적용분류" span={2}>
          <PartnerCategoryFilter
            label="적용분류"
            shown={shown}
            categories={categories}
            onOpenPicker={onOpenCategoryPicker}
            onChange={onChange}
          />
        </SearchField>

        <SearchField label="구분" htmlFor="partner-category-type">
          <FilterSelect
            id="partner-category-type"
            value={shown.partnerType ?? ALL}
            options={[
              { value: ALL, label: "전체" },
              ...PARTNER_TYPE_FILTERS.map(({ value, label, description }) => ({
                value,
                label: `${label} (${description})`,
              })),
            ]}
            className="max-w-64"
            onChange={(value) =>
              onChange({
                partnerType: value === ALL ? null : (value as PartnerType),
              })
            }
          />
        </SearchField>

        <SearchField
          label="사용여부"
          htmlFor="partner-category-status"
          className="xl:col-span-3 2xl:col-span-1"
        >
          <FilterSelect
            id="partner-category-status"
            value={shown.status}
            options={PARTNER_STATUS_FILTERS.map(({ value, label }) => ({
              value,
              label,
            }))}
            onChange={(value) =>
              onChange({ status: value as PartnerStatusFilter })
            }
          />
        </SearchField>
      </SearchPanel>
    </form>
  )
}
