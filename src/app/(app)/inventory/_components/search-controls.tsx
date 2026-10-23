"use client"

import { useState } from "react"

import { DATE_FILTER_INPUT_CLASS } from "@/components/inventory/date-range"
import { QuickRangeButtons } from "@/components/inventory/quick-range-buttons"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { formatNumber } from "@/lib/format"
import { storageTypeLabel } from "@/lib/products/constants"
import {
  INVENTORY_PAGE_SIZES,
  INVENTORY_SEARCH_MAX_LENGTH,
  type InventoryPageSize,
} from "@/lib/inventory/schema"
import type { StockWarehouseNode } from "@/lib/inventory/queries"
import { cn } from "@/lib/utils"

import type { PlaceIds } from "./place-filter"

// Inputs of the 재고 screens' 조회 conditions (inside a <SearchPanel>).
// Text and dates are applied with 조회 (F4) or Enter; selects and
// checkboxes right away, like the 상품관리 conditions.

/** Select value meaning "no filter". */
export const ALL = "all"

export type SelectOption = { value: string; label: string }

/** A compact select for one 조회 condition. */
export function FilterSelect({
  id,
  value,
  options,
  onChange,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  id?: string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
  "aria-label"?: string
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
        aria-label={ariaLabel}
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

/**
 * The 검색어 box (its text is read from the form when 조회 runs). Give it
 * `key={shown.q}` so it resets when the search changes from outside
 * (조건 초기화, the back button).
 */
export function SearchTextBox({
  id,
  initialValue,
  placeholder,
}: {
  id: string
  initialValue: string
  placeholder: string
}) {
  const [value, setValue] = useState(initialValue)

  return (
    <Input
      id={id}
      name="q"
      type="search"
      placeholder={placeholder}
      className="h-8 w-full max-w-md rounded-sm"
      value={value}
      maxLength={INVENTORY_SEARCH_MAX_LENGTH}
      enterKeyHint="search"
      autoComplete="off"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        // Enter that only finishes a Korean syllable (IME) does not search
        // yet. keyCode 229: Safari's Enter while composing Korean.
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

/** Earliest / latest date the inputs accept (the database's range). */
const MIN_DATE = "2000-01-01"
const MAX_DATE = "2099-12-31"

/**
 * 조회기간: two date boxes (form fields "from" and "to", read when 조회
 * runs) and quick choices (오늘, 최근 7일, 최근 30일, 이번 달, 지난 달)
 * that apply at once.
 * Give it `key={`${from}~${to}`}` so the boxes follow outside changes.
 */
export function PeriodInputs({
  idPrefix,
  from,
  to,
  today,
  onPick,
}: {
  idPrefix: string
  from: string
  to: string
  /** Today in Korea ("YYYY-MM-DD"), from the server. */
  today: string
  onPick: (from: string, to: string) => void
}) {
  return (
    <>
      <span className="flex flex-wrap items-center gap-1">
        <Input
          id={`${idPrefix}-from`}
          name="from"
          type="date"
          aria-label="조회 시작일"
          min={MIN_DATE}
          max={MAX_DATE}
          defaultValue={from}
          className={DATE_FILTER_INPUT_CLASS}
        />
        <span aria-hidden="true">~</span>
        <Input
          id={`${idPrefix}-to`}
          name="to"
          type="date"
          aria-label="조회 종료일"
          min={MIN_DATE}
          max={MAX_DATE}
          defaultValue={to}
          className={DATE_FILTER_INPUT_CLASS}
        />
      </span>
      <QuickRangeButtons today={today} from={from} to={to} onPick={onPick} />
    </>
  )
}

/**
 * The 조회기간 typed in the form (both boxes), earlier date first, or
 * { message } in Korean when a box is empty or invalid.
 */
export function readPeriod(
  form: HTMLFormElement | null,
  fallback: { from: string; to: string }
): { from: string; to: string } | { message: string } {
  if (!form) return fallback
  const data = new FormData(form)
  const from = String(data.get("from") ?? "")
  const to = String(data.get("to") ?? "")
  const valid = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= MIN_DATE && value <= MAX_DATE
  if (!valid(from) || !valid(to)) {
    return { message: "조회기간을 날짜(예: 2026-10-01)로 입력해 주세요." }
  }
  return from <= to ? { from, to } : { from: to, to: from }
}

/** "100건씩 보기" select next to the count. */
export function PageSizeSelect({
  value,
  onChange,
  noun = "건",
}: {
  value: InventoryPageSize
  onChange: (pageSize: InventoryPageSize) => void
  noun?: string
}) {
  const options = INVENTORY_PAGE_SIZES.map((size) => ({
    value: String(size),
    label: `${formatNumber(size, 0)}${noun}씩 보기`,
  }))
  return (
    <Select
      items={options}
      value={String(value)}
      onValueChange={(next) => {
        if (next !== null && next !== String(value)) {
          onChange(Number(next) as InventoryPageSize)
        }
      }}
    >
      <SelectTrigger
        aria-label="한 페이지에 보일 줄 수"
        className="h-8 rounded-sm"
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

/**
 * 창고 → 구역 (→ 위치) selects. Choosing a 창고 clears the 구역 and 위치;
 * a 구역 can only be chosen after its 창고. 사용중지 places are listed too
 * (they may still hold stock), marked "(사용중지)".
 */
export function PlaceSelects({
  idPrefix,
  places,
  value,
  onChange,
  withLocation = false,
}: {
  idPrefix: string
  places: StockWarehouseNode[]
  value: PlaceIds
  onChange: (value: PlaceIds) => void
  /** Also offer the 위치(선반) select. */
  withLocation?: boolean
}) {
  const warehouse = places.find((item) => item.id === value.warehouseId)
  const zone = warehouse?.zones.find((item) => item.id === value.zoneId)
  const inactive = (isActive: boolean) => (isActive ? "" : " (사용중지)")

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      <FilterSelect
        id={`${idPrefix}-warehouse`}
        aria-label="창고"
        value={value.warehouseId ?? ALL}
        className="w-40"
        options={[
          { value: ALL, label: "전체 창고" },
          ...places.map((item) => ({
            value: item.id,
            label: `${item.name}${inactive(item.isActive)}`,
          })),
        ]}
        onChange={(next) =>
          onChange({
            warehouseId: next === ALL ? null : next,
            zoneId: null,
            locationId: null,
          })
        }
      />
      <FilterSelect
        id={`${idPrefix}-zone`}
        aria-label="구역"
        value={value.zoneId ?? ALL}
        disabled={!warehouse}
        className="w-40"
        options={[
          { value: ALL, label: "전체 구역" },
          ...(warehouse?.zones ?? []).map((item) => ({
            value: item.id,
            label: `${item.name} (${storageTypeLabel(item.storageType)})${inactive(item.isActive)}`,
          })),
        ]}
        onChange={(next) =>
          onChange({
            warehouseId: value.warehouseId,
            zoneId: next === ALL ? null : next,
            locationId: null,
          })
        }
      />
      {withLocation && (
        <FilterSelect
          id={`${idPrefix}-location`}
          aria-label="위치(선반)"
          value={value.locationId ?? ALL}
          disabled={!zone}
          className="w-36"
          options={[
            { value: ALL, label: "전체 위치" },
            ...(zone?.locations ?? []).map((item) => ({
              value: item.id,
              label: `${item.code}${item.name ? ` ${item.name}` : ""}${inactive(item.isActive)}`,
            })),
          ]}
          onChange={(next) =>
            onChange({
              warehouseId: value.warehouseId,
              zoneId: value.zoneId,
              locationId: next === ALL ? null : next,
            })
          }
        />
      )}
    </span>
  )
}
