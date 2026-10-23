"use client"

import { ChevronDownIcon, XIcon } from "lucide-react"

import { SearchField, SearchPanel } from "@/components/erp/search-panel"
import { Checkbox } from "@/components/ui/checkbox"
import {
  findCategoryPath,
  formatCategoryPath,
  type CategoryNode,
} from "@/lib/categories/tree"
import type { StockWarehouseNode } from "@/lib/inventory/queries"
import {
  PRODUCT_STATUS_FILTERS,
  type ProductStatusFilter,
  type StockReportParams,
} from "@/lib/inventory/schema"
import {
  STORAGE_TYPES,
  TAX_TYPES,
  type StorageType,
  type TaxType,
} from "@/lib/products/constants"

import {
  ALL,
  FilterSelect,
  PeriodInputs,
  PlaceSelects,
  SearchTextBox,
} from "./search-controls"

/** Id of the search <form>; the 조회 button submits it with form="…". */
export const STOCK_REPORT_SEARCH_FORM_ID = "stock-report-search"

/**
 * 조회 conditions of 상품별 재고현황, as a bordered grid of [grey label |
 * input] cells (at most 3 per row; in this order the cells fill whole rows
 * on tablets and laptops): 조회기간, 검색어, 과세구분, 상품분류, 창고·구역,
 * 보관온도, 상품사용여부, 재고.
 *
 * - 조회기간 and 검색어 apply with 조회 (F4) or Enter; the quick choices
 *   (오늘 / 이번 달 / 지난 달), selects and checkboxes apply at once.
 * - 상품분류 opens the category picker (any level, the levels below
 *   included); × goes back to all. "미분류만" shows products without one.
 * - 창고·구역: only the stock and movements of that 창고 / 구역 (이동 then
 *   shows what came in or went out of it).
 */
export function StockReportSearchForm({
  formRef,
  shown,
  categories,
  places,
  today,
  onSubmit,
  onChange,
  onOpenCategoryPicker,
}: {
  formRef: React.Ref<HTMLFormElement>
  /** The conditions as shown (may be ahead of the loaded list). */
  shown: StockReportParams
  categories: CategoryNode[]
  places: StockWarehouseNode[]
  today: string
  /** 조회: apply the typed 검색어 and 조회기간 (and everything else as shown). */
  onSubmit: () => void
  /** A choice changed (applies at once). */
  onChange: (changes: Partial<StockReportParams>) => void
  onOpenCategoryPicker: () => void
}) {
  const categoryPath = shown.categoryId
    ? formatCategoryPath(findCategoryPath(categories, shown.categoryId))
    : ""

  return (
    <form
      ref={formRef}
      id={STOCK_REPORT_SEARCH_FORM_ID}
      role="search"
      aria-label="상품별 재고현황 조회 조건"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <SearchPanel className="2xl:grid-cols-3">
        <SearchField label="조회기간" span={2}>
          <PeriodInputs
            key={`${shown.from}~${shown.to}`}
            idPrefix="stock-report"
            from={shown.from}
            to={shown.to}
            today={today}
            onPick={(from, to) => onChange({ from, to })}
          />
        </SearchField>

        <SearchField label="검색어" htmlFor="stock-report-q">
          <SearchTextBox
            key={shown.q}
            id="stock-report-q"
            initialValue={shown.q}
            placeholder="상품코드, 상품명, 바코드"
          />
        </SearchField>

        <SearchField label="과세구분" htmlFor="stock-report-tax">
          <FilterSelect
            id="stock-report-tax"
            value={shown.taxType ?? ALL}
            options={[
              { value: ALL, label: "전체" },
              ...TAX_TYPES.map(({ value, label }) => ({ value, label })),
            ]}
            onChange={(value) =>
              onChange({ taxType: value === ALL ? null : (value as TaxType) })
            }
          />
        </SearchField>

        <SearchField label="상품분류" span={2}>
          <span className="flex min-w-0 items-center">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`상품분류: ${categoryPath || "전체"} (바꾸기)`}
              disabled={shown.uncategorized}
              onClick={onOpenCategoryPicker}
              className="flex h-8 w-56 max-w-full min-w-0 items-center justify-between gap-1.5 rounded-sm border border-input bg-background pr-2 pl-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="truncate">{categoryPath || "전체"}</span>
              <ChevronDownIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            </button>
            {categoryPath && !shown.uncategorized && (
              <button
                type="button"
                aria-label="상품분류 조건 지우기"
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
            미분류 상품만
          </label>
        </SearchField>

        <SearchField label="창고·구역" span={2}>
          <PlaceSelects
            idPrefix="stock-report"
            places={places}
            value={{
              warehouseId: shown.warehouseId,
              zoneId: shown.zoneId,
              locationId: null,
            }}
            onChange={(place) =>
              onChange({ warehouseId: place.warehouseId, zoneId: place.zoneId })
            }
          />
        </SearchField>

        <SearchField label="보관온도" htmlFor="stock-report-storage">
          <FilterSelect
            id="stock-report-storage"
            value={shown.storageType ?? ALL}
            options={[
              { value: ALL, label: "전체" },
              ...STORAGE_TYPES.map(({ value, label }) => ({ value, label })),
            ]}
            onChange={(value) =>
              onChange({
                storageType: value === ALL ? null : (value as StorageType),
              })
            }
          />
        </SearchField>

        <SearchField label="상품사용여부" htmlFor="stock-report-status">
          <FilterSelect
            id="stock-report-status"
            value={shown.productStatus}
            options={PRODUCT_STATUS_FILTERS.map(({ value, label }) => ({
              value,
              label,
            }))}
            onChange={(value) =>
              onChange({ productStatus: value as ProductStatusFilter })
            }
          />
        </SearchField>

        <SearchField label="재고" className="md:col-span-2 xl:col-span-2">
          <label className="flex min-h-7 cursor-pointer items-center gap-1.5 text-[13px]">
            <Checkbox
              checked={shown.withStock}
              onCheckedChange={(checked) => onChange({ withStock: checked })}
            />
            기말재고가 있는 상품만 보기
          </label>
        </SearchField>
      </SearchPanel>
    </form>
  )
}
