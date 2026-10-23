"use client"

import { ChevronDownIcon, XIcon } from "lucide-react"
import { useState } from "react"

import { SearchField, SearchPanel } from "@/components/erp/search-panel"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  employeesWithDuty,
  formatEmployeeLabel,
  type EmployeeDuty,
  type EmployeeOption,
} from "@/lib/employees/schema"
import {
  findCategoryPath,
  formatCategoryPath,
  type PartnerCategoryNode,
} from "@/lib/partner-categories/tree"
import {
  PARTNER_INDUSTRIES,
  type PartnerIndustry,
  type PartnerType,
} from "@/lib/partners/constants"
import {
  PARTNER_LIST_SORTS,
  PARTNER_SEARCH_MAX_LENGTH,
  PARTNER_STATUS_FILTERS,
  PARTNER_TYPE_FILTERS,
  partnerSortLabel,
  REP_FILTER_NONE,
  type PartnerListParams,
  type PartnerListSort,
  type PartnerStatusFilter,
} from "@/lib/partners/schema"
import { cn } from "@/lib/utils"

/** Select value meaning "no filter". */
export const ALL = "all"

export type SelectOption = { value: string; label: string }

/** Id of the search <form>; the 조회 button submits it with form="…". */
export const PARTNER_SEARCH_FORM_ID = "partner-search"

/**
 * 조회 conditions of the partner list, as a bordered grid of
 * [grey label | input] cells.
 *
 * - 검색어: 거래처명, 거래처코드, 상호, 대표자; a number also finds
 *   사업자번호 and 대표연락처 (with or without hyphens). Applied with Enter
 *   or 조회 (F4); an Enter that only finishes a Korean syllable is ignored.
 * - The selects, the 거래처분류 picker and the 미분류 checkbox apply right
 *   away. 거래처분류 (any level) includes every category below it.
 * - 구분: 매출처 and 매입처 include the 매출·매입 거래처.
 * - 영업담당 / 배송담당: 전체, 미지정 (none set) or one employee with that
 *   담당업무 (재직 first, then 퇴사).
 * - 정렬: also shows an order chosen by clicking a grid column title.
 */
export function PartnerSearchForm({
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
  /** A select or checkbox changed. */
  onChange: (changes: Partial<PartnerListParams>) => void
  /** Opens the 거래처분류 picker (the filter). */
  onOpenCategoryPicker: () => void
}) {
  return (
    <form
      ref={formRef}
      id={PARTNER_SEARCH_FORM_ID}
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

        <SearchField label="구분" htmlFor="partner-search-type">
          <FilterSelect
            id="partner-search-type"
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

        <SearchField label="사용여부" htmlFor="partner-search-status">
          <FilterSelect
            id="partner-search-status"
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

        <SearchField label="거래처분류" span={2}>
          <PartnerCategoryFilter
            label="거래처분류"
            shown={shown}
            categories={categories}
            onOpenPicker={onOpenCategoryPicker}
            onChange={onChange}
          />
        </SearchField>

        <SearchField label="영업담당" htmlFor="partner-search-sales-rep">
          <FilterSelect
            id="partner-search-sales-rep"
            value={shown.salesRepId ?? ALL}
            options={repFilterOptions(employees, "sales", shown.salesRepId)}
            onChange={(value) =>
              onChange({ salesRepId: value === ALL ? null : value })
            }
          />
        </SearchField>

        <SearchField label="배송담당" htmlFor="partner-search-delivery-rep">
          <FilterSelect
            id="partner-search-delivery-rep"
            value={shown.deliveryRepId ?? ALL}
            options={repFilterOptions(
              employees,
              "delivery",
              shown.deliveryRepId
            )}
            onChange={(value) =>
              onChange({ deliveryRepId: value === ALL ? null : value })
            }
          />
        </SearchField>

        <SearchField label="업종" htmlFor="partner-search-industry">
          <FilterSelect
            id="partner-search-industry"
            value={shown.industry ?? ALL}
            options={[
              { value: ALL, label: "전체" },
              ...PARTNER_INDUSTRIES.map(({ value, label }) => ({
                value,
                label,
              })),
            ]}
            onChange={(value) =>
              onChange({
                industry: value === ALL ? null : (value as PartnerIndustry),
              })
            }
          />
        </SearchField>

        {/* Fills its row where the cells above leave a gap. */}
        <SearchField
          label="정렬"
          htmlFor="partner-search-sort"
          className="xl:col-span-3 2xl:col-span-3"
        >
          <FilterSelect
            id="partner-search-sort"
            value={shown.sort}
            options={sortOptions(shown.sort)}
            className="max-w-64"
            onChange={(value) => onChange({ sort: value as PartnerListSort })}
          />
        </SearchField>
      </SearchPanel>
    </form>
  )
}

/**
 * Choices of the 정렬 select: 거래처코드순, 거래처명순, 최근 등록순, plus the
 * current order when it was set with a click on a grid column title (e.g.
 * "영업담당 내림차순 ▼"), so the select always shows it.
 */
function sortOptions(current: PartnerListSort): SelectOption[] {
  const options: SelectOption[] = PARTNER_LIST_SORTS.map(
    ({ value, label }) => ({ value, label })
  )
  if (!options.some((option) => option.value === current)) {
    options.push({ value: current, label: partnerSortLabel(current) })
  }
  return options
}

/**
 * The choices of a 영업담당 / 배송담당 filter: 전체, 미지정, then every
 * employee with that 담당업무 or still on a partner as such (재직 first,
 * then 퇴사; marked "(퇴사)" / "(배송담당 해제)").
 */
export function repFilterOptions(
  employees: readonly EmployeeOption[],
  duty: EmployeeDuty,
  selected: string | null
): SelectOption[] {
  const options: SelectOption[] = [
    { value: ALL, label: "전체" },
    { value: REP_FILTER_NONE, label: "미지정 (담당 없음)" },
    ...employeesWithDuty(employees, duty).map((employee) => ({
      value: employee.id,
      label: formatEmployeeLabel(employee, duty),
    })),
  ]
  // An employee from the URL that is not in the list (lost the 담당업무
  // later, or typed by hand) still shows as chosen.
  if (selected && !options.some((option) => option.value === selected)) {
    const employee = employees.find((item) => item.id === selected)
    options.push({
      value: selected,
      label: employee ? formatEmployeeLabel(employee, duty) : "알 수 없는 직원",
    })
  }
  return options
}

/**
 * The 거래처분류 filter: a box showing the chosen category's path (or
 * "전체") that opens the picker, × to clear it, and the
 * "미분류 거래처만 보기" checkbox. Put it in a <SearchField span={2}>.
 */
export function PartnerCategoryFilter({
  label,
  shown,
  categories,
  onOpenPicker,
  onChange,
}: {
  /** The field's name, e.g. "거래처분류" or "적용분류". */
  label: string
  shown: Pick<PartnerListParams, "categoryId" | "uncategorized">
  categories: PartnerCategoryNode[]
  onOpenPicker: () => void
  onChange: (
    changes: Partial<Pick<PartnerListParams, "categoryId" | "uncategorized">>
  ) => void
}) {
  const categoryPath = shown.categoryId
    ? formatCategoryPath(findCategoryPath(categories, shown.categoryId))
    : ""
  return (
    <>
      <span className="flex min-w-0 items-center">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={`${label}: ${categoryPath || "전체"} (바꾸기)`}
          disabled={shown.uncategorized}
          onClick={onOpenPicker}
          // Same text color as the other filters' "전체" (it is a real
          // choice, not a placeholder).
          className="flex h-8 w-56 max-w-full min-w-0 items-center justify-between gap-1.5 rounded-sm border border-input bg-background pr-2 pl-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="truncate" title={categoryPath || undefined}>
            {categoryPath || "전체"}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </button>
        {categoryPath && !shown.uncategorized && (
          <button
            type="button"
            aria-label={`${label} 조건 지우기`}
            onClick={() => onChange({ categoryId: null })}
            className="ml-1 flex size-7 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        )}
      </span>
      <label className="flex min-h-7 cursor-pointer items-center gap-1.5 text-[13px]">
        <Checkbox
          checked={shown.uncategorized}
          onCheckedChange={(checked) =>
            onChange({ uncategorized: checked, categoryId: null })
          }
        />
        미분류 거래처만 보기
      </label>
    </>
  )
}

/** The 검색어 box (its text is read from the form when 조회 runs). */
export function PartnerSearchBox({
  initialValue,
  placeholder = "거래처명, 거래처코드, 상호, 대표자, 사업자번호, 연락처",
}: {
  initialValue: string
  placeholder?: string
}) {
  const [value, setValue] = useState(initialValue)

  return (
    <Input
      id="partner-search-q"
      name="q"
      type="search"
      placeholder={placeholder}
      className="h-8 w-full max-w-md rounded-sm"
      value={value}
      maxLength={PARTNER_SEARCH_MAX_LENGTH}
      enterKeyHint="search"
      autoComplete="off"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        // keyCode 229: Safari's Enter while composing Korean.
        if (
          event.key === "Enter" &&
          (event.nativeEvent.isComposing || event.keyCode === 229)
        ) {
          event.preventDefault()
        }
      }}
    />
  )
}

/** A compact select for one 조회 condition. */
export function FilterSelect({
  id,
  value,
  options,
  onChange,
  disabled = false,
  className,
}: {
  id: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <Select
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null && next !== value) onChange(next)
      }}
    >
      <SelectTrigger
        id={id}
        className={cn("h-8 w-full max-w-56 rounded-sm", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
