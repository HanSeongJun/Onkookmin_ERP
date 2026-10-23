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
  findCategoryPath,
  formatCategoryPath,
  type CategoryNode,
} from "@/lib/categories/tree"
import {
  EFFECTIVE_TAX_TYPES,
  PRODUCT_TYPES,
  STORAGE_TYPES,
  type EffectiveTaxType,
  type ProductType,
  type StorageType,
} from "@/lib/products/constants"
import {
  PRODUCT_LIST_SORTS,
  PRODUCT_SEARCH_MAX_LENGTH,
  PRODUCT_STATUS_FILTERS,
  productSortLabel,
  type ProductListParams,
  type ProductListSort,
  type ProductStatusFilter,
} from "@/lib/products/schema"
import { cn } from "@/lib/utils"

/** Select value meaning "no filter". */
const ALL = "all"

type SelectOption = { value: string; label: string }

/** Id of the search <form>; the 조회 button submits it with form="…". */
export const PRODUCT_SEARCH_FORM_ID = "product-search"

/**
 * 조회 conditions of the product list, as a bordered grid of
 * [grey label | input] cells.
 *
 * - 검색어: applied with Enter or 조회 (F4). Enter that only finishes a
 *   Korean syllable (IME) is ignored, so the search uses the whole word.
 * - The selects and the 미분류 checkbox apply right away.
 * - 상품유형: 전체 / 기준상품 / 묶음상품.
 * - 과세구분 / 보관온도 look at the values in effect: a 묶음상품's are worked
 *   out from its 기준상품 (과세구분 "혼합" = 과세 and 면세 mixed).
 * - 상품분류: opens the category picker (any level; switched-off ones too);
 *   × goes back to all categories.
 * - 정렬: also shows an order chosen by clicking a grid column title.
 *
 * Layout: 9 cells (검색어 and 상품분류 are 2 wide), so laptop screens (3
 * per row) get 3 full rows; wide screens (4 per row) put 정렬 alone on the
 * third row.
 */
export function ProductSearchForm({
  formRef,
  shown,
  categories,
  onSearch,
  onChange,
  onOpenCategoryPicker,
}: {
  formRef: React.Ref<HTMLFormElement>
  /** The conditions as shown (may be ahead of the loaded list). */
  shown: ProductListParams
  categories: CategoryNode[]
  /** 조회: run the search with this text (and everything else as shown). */
  onSearch: (q: string) => void
  /** A select or checkbox changed. */
  onChange: (changes: Partial<ProductListParams>) => void
  onOpenCategoryPicker: () => void
}) {
  const categoryPath = shown.categoryId
    ? formatCategoryPath(findCategoryPath(categories, shown.categoryId))
    : ""

  return (
    <form
      ref={formRef}
      id={PRODUCT_SEARCH_FORM_ID}
      role="search"
      aria-label="상품 조회 조건"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        onSearch(String(data.get("q") ?? "").trim())
      }}
    >
      <SearchPanel>
        <SearchField label="검색어" htmlFor="product-search-q" span={2}>
          {/* The key resets the box when the search changes from outside
              (조건 초기화, the back button). */}
          <SearchBox key={shown.q} initialValue={shown.q} />
        </SearchField>

        <SearchField label="상품유형" htmlFor="product-search-type">
          <FilterSelect
            id="product-search-type"
            value={shown.productType ?? ALL}
            options={[
              { value: ALL, label: "전체" },
              ...PRODUCT_TYPES.map(({ value, longLabel }) => ({
                value,
                label: longLabel,
              })),
            ]}
            onChange={(value) =>
              onChange({
                productType: value === ALL ? null : (value as ProductType),
              })
            }
          />
        </SearchField>

        <SearchField label="사용여부" htmlFor="product-search-status">
          <FilterSelect
            id="product-search-status"
            value={shown.status}
            options={PRODUCT_STATUS_FILTERS.map(({ value, label }) => ({
              value,
              label,
            }))}
            onChange={(value) =>
              onChange({ status: value as ProductStatusFilter })
            }
          />
        </SearchField>

        <SearchField label="과세구분" htmlFor="product-search-tax">
          <FilterSelect
            id="product-search-tax"
            value={shown.taxType ?? ALL}
            options={[
              { value: ALL, label: "전체" },
              ...EFFECTIVE_TAX_TYPES.map(({ value, label }) => ({
                value,
                label: value === "mixed" ? `${label} (묶음상품)` : label,
              })),
            ]}
            onChange={(value) =>
              onChange({
                taxType: value === ALL ? null : (value as EffectiveTaxType),
              })
            }
          />
        </SearchField>

        <SearchField label="보관온도" htmlFor="product-search-storage">
          <FilterSelect
            id="product-search-storage"
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

        <SearchField label="상품분류" span={2}>
          <span className="flex min-w-0 items-center">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-label={`상품분류: ${categoryPath || "전체"} (바꾸기)`}
              disabled={shown.uncategorized}
              onClick={onOpenCategoryPicker}
              // Same text color as the other filters' "전체" (it is a real
              // choice, not a placeholder).
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
            미분류 상품만 보기
          </label>
        </SearchField>

        {/* Fills its row where the cells above leave a gap. */}
        <SearchField
          label="정렬"
          htmlFor="product-search-sort"
          className="md:col-span-2 xl:col-span-1 2xl:col-span-4"
        >
          <FilterSelect
            id="product-search-sort"
            value={shown.sort}
            options={sortOptions(shown.sort)}
            // Wider: "판매단가(부가세 포함) 내림차순 ▼" fits.
            className="max-w-72"
            onChange={(value) => onChange({ sort: value as ProductListSort })}
          />
        </SearchField>
      </SearchPanel>
    </form>
  )
}

/**
 * Choices of the 정렬 select: 상품코드순, 상품명순, 최근 등록순, plus the
 * current order when it was set with a click on a grid column title (e.g.
 * "판매단가(부가세 포함) 내림차순 ▼"), so the select always shows it.
 */
function sortOptions(current: ProductListSort): SelectOption[] {
  const options: SelectOption[] = PRODUCT_LIST_SORTS.map(
    ({ value, label }) => ({ value, label })
  )
  if (!options.some((option) => option.value === current)) {
    options.push({ value: current, label: productSortLabel(current) })
  }
  return options
}

/** The 검색어 box (its text is read from the form when 조회 runs). */
function SearchBox({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue)

  return (
    <Input
      id="product-search-q"
      name="q"
      type="search"
      placeholder="상품코드, 상품명, 바코드, 제조사/브랜드"
      className="h-8 w-full max-w-md rounded-sm"
      value={value}
      maxLength={PRODUCT_SEARCH_MAX_LENGTH}
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
function FilterSelect({
  id,
  value,
  options,
  onChange,
  className,
}: {
  id: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <Select
      items={options}
      value={value}
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
