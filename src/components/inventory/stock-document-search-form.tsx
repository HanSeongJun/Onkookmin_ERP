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
  stockDocumentTypeLabel,
  type StockDocumentType,
} from "@/lib/inventory/constants"
import type { StockProductOption } from "@/lib/inventory/queries"
import {
  INVENTORY_SEARCH_MAX_LENGTH,
  STOCK_DOCUMENT_STATUS_FILTERS,
  todayInKorea,
  type StockDocumentListParams,
  type StockDocumentStatusFilter,
} from "@/lib/inventory/schema"

import { DATE_FILTER_INPUT_CLASS } from "./date-range"
import { QuickRangeButtons } from "./quick-range-buttons"
import { StockProductPickerDialog } from "./stock-product-picker-dialog"

/** Id of the 전표 search <form>; the 조회 button submits it with form="…". */
export const STOCK_DOCUMENT_SEARCH_FORM_ID = "stock-document-search"

/** The conditions the form shows: the list params plus the 구분 filter. */
export type StockDocumentSearchValues = StockDocumentListParams & {
  kind: StockDocumentType | null
}

/**
 * 조회 conditions of a 전표 list: 전표일자 (from ~ to, with quick buttons),
 * 검색어 (전표번호, 상품코드·상품명, 로트번호, 거래처명, 메모), 구분 (only
 * where the screen lists several kinds, e.g. 입고 / 기초재고), 상품 (전표
 * with this 기준상품; picker), 상태 (전체 / 정상 / 취소됨) and "취소 전표도
 * 보기". The dates and the 검색어 apply with Enter or 조회 (F4); the quick
 * buttons, the selects, the 상품 and the checkbox at once. A 거래처
 * condition that came with a link shows as a chip (× removes it).
 */
export function StockDocumentSearchForm({
  formRef,
  shown,
  kindOptions,
  partnerLabel,
  filterLabels,
  onSearch,
  onChange,
}: {
  formRef: React.Ref<HTMLFormElement>
  shown: StockDocumentSearchValues
  /** The kinds the screen lists; a 구분 select shows when there are several. */
  kindOptions: readonly StockDocumentType[]
  /** "매입처" / "거래처", or null when the screen has none. */
  partnerLabel: string | null
  filterLabels: { product: string | null; partner: string | null }
  onSearch: (values: { q: string; from: string; to: string }) => void
  onChange: (changes: Partial<StockDocumentSearchValues>) => void
}) {
  const today = todayInKorea()
  const [productPickerOpen, setProductPickerOpen] = useState(false)
  // The name of a product picked here (until the server sends its label).
  const [picked, setPicked] = useState<StockProductOption | null>(null)
  const productLabel =
    shown.productId === null
      ? null
      : picked?.id === shown.productId
        ? `${picked.code} ${picked.name}`
        : (filterLabels.product ?? "선택한 상품")
  return (
    <form
      ref={formRef}
      id={STOCK_DOCUMENT_SEARCH_FORM_ID}
      role="search"
      aria-label="전표 조회 조건"
      onSubmit={(event) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        let from = String(data.get("from") ?? "") || shown.from
        let to = String(data.get("to") ?? "") || shown.to
        if (from > to) [from, to] = [to, from]
        onSearch({ q: String(data.get("q") ?? "").trim(), from, to })
      }}
    >
      <SearchPanel>
        <SearchField label="전표일자" span={2}>
          {/* The key resets the boxes when the period changes from outside. */}
          <span
            key={`${shown.from}~${shown.to}`}
            className="flex flex-wrap items-center gap-1"
          >
            <Input
              type="date"
              name="from"
              aria-label="전표일자 시작"
              defaultValue={shown.from}
              max={today}
              className={DATE_FILTER_INPUT_CLASS}
            />
            <span aria-hidden="true">~</span>
            <Input
              type="date"
              name="to"
              aria-label="전표일자 끝"
              defaultValue={shown.to}
              max={today}
              className={DATE_FILTER_INPUT_CLASS}
            />
          </span>
          <QuickRangeButtons
            today={today}
            from={shown.from}
            to={shown.to}
            onPick={(from, to) => onChange({ from, to })}
          />
        </SearchField>

        <SearchField label="검색어" htmlFor="stock-document-search-q">
          <SearchBox
            key={shown.q}
            initialValue={shown.q}
            partnerLabel={partnerLabel}
          />
        </SearchField>

        {kindOptions.length > 1 && (
          <SearchField label="구분" htmlFor="stock-document-search-kind">
            <KindSelect
              options={kindOptions}
              value={shown.kind}
              onChange={(kind) => onChange({ kind })}
            />
          </SearchField>
        )}

        <SearchField label="상품" htmlFor="stock-document-search-product">
          <span className="flex min-w-0 items-center">
            <button
              id="stock-document-search-product"
              type="button"
              aria-haspopup="dialog"
              aria-label={`상품 조건: ${productLabel ?? "전체"} (바꾸기)`}
              onClick={() => setProductPickerOpen(true)}
              className="flex h-8 w-56 max-w-full min-w-0 items-center justify-between gap-1.5 rounded-sm border border-input bg-background pr-2 pl-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate" title={productLabel ?? undefined}>
                {productLabel ?? "전체"}
              </span>
              <ChevronDownIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            </button>
            {shown.productId && (
              <button
                type="button"
                aria-label="상품 조건 지우기"
                onClick={() => onChange({ productId: null })}
                className="ml-1 flex size-7 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <XIcon aria-hidden="true" className="size-4" />
              </button>
            )}
          </span>
          {productPickerOpen && (
            <StockProductPickerDialog
              includeBundles={false}
              includeInactiveWithStock
              multiple={false}
              title="상품 조건 선택 (이 기준상품이 들어간 전표)"
              onPick={([product]) => {
                if (!product) return
                setPicked(product)
                onChange({ productId: product.id })
              }}
              onClose={() => setProductPickerOpen(false)}
            />
          )}
        </SearchField>

        <SearchField label="상태" htmlFor="stock-document-search-status">
          <StatusSelect
            value={shown.status}
            onChange={(status) => onChange({ status })}
          />
          <label className="flex min-h-7 cursor-pointer items-center gap-1.5 text-[13px]">
            <Checkbox
              checked={shown.includeReversals}
              onCheckedChange={(checked) =>
                onChange({ includeReversals: checked })
              }
            />
            취소 전표도 보기
          </label>
        </SearchField>

        {shown.partnerId && (
          <SearchField label="추가 조건" span={2}>
            {shown.partnerId && (
              <FilterChip
                label={`${partnerLabel ?? "거래처"}: ${filterLabels.partner ?? "선택한 거래처"}`}
                onRemove={() => onChange({ partnerId: null })}
              />
            )}
          </SearchField>
        )}
      </SearchPanel>
    </form>
  )
}

function SearchBox({
  initialValue,
  partnerLabel,
}: {
  initialValue: string
  partnerLabel: string | null
}) {
  const [value, setValue] = useState(initialValue)
  return (
    <Input
      id="stock-document-search-q"
      name="q"
      type="search"
      placeholder={`전표번호, 상품, 로트번호${partnerLabel ? `, ${partnerLabel}` : ""}, 메모`}
      className="h-8 w-full max-w-md rounded-sm"
      value={value}
      maxLength={INVENTORY_SEARCH_MAX_LENGTH}
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

/** 구분 select: 전체 or one of the screen's kinds (e.g. 입고 / 기초재고). */
function KindSelect({
  options,
  value,
  onChange,
}: {
  options: readonly StockDocumentType[]
  value: StockDocumentType | null
  onChange: (value: StockDocumentType | null) => void
}) {
  const items = [
    { value: "all", label: "전체" },
    ...options.map((type) => ({
      value: type,
      label: stockDocumentTypeLabel(type),
    })),
  ]
  return (
    <Select
      items={items}
      value={value ?? "all"}
      onValueChange={(next) => {
        if (next === null || next === (value ?? "all")) return
        onChange(next === "all" ? null : (next as StockDocumentType))
      }}
    >
      <SelectTrigger
        id="stock-document-search-kind"
        className="h-8 w-32 rounded-sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function StatusSelect({
  value,
  onChange,
}: {
  value: StockDocumentStatusFilter
  onChange: (value: StockDocumentStatusFilter) => void
}) {
  const options = STOCK_DOCUMENT_STATUS_FILTERS.map(({ value, label }) => ({
    value,
    label,
  }))
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(next) => {
        if (next !== null && next !== value) {
          onChange(next as StockDocumentStatusFilter)
        }
      }}
    >
      <SelectTrigger
        id="stock-document-search-status"
        className="h-8 w-28 rounded-sm"
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

function FilterChip({
  label,
  onRemove,
}: {
  label: string
  onRemove: () => void
}) {
  return (
    <span className="inline-flex h-7 max-w-full items-center gap-1 rounded-sm border border-brand-border bg-brand-tint pr-0.5 pl-2 text-[13px] text-brand-active">
      <span className="truncate" title={label}>
        {label}
      </span>
      <button
        type="button"
        aria-label={`${label} 조건 지우기`}
        onClick={onRemove}
        className="flex size-6 items-center justify-center rounded-sm outline-none hover:bg-brand-tint-strong focus-visible:ring-2 focus-visible:ring-ring"
      >
        <XIcon aria-hidden="true" className="size-3.5" />
      </button>
    </span>
  )
}
