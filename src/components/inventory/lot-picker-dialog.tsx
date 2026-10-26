"use client"

import { LoaderCircleIcon, SearchIcon } from "lucide-react"
import { unstable_rethrow } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"

import { ActionButton } from "@/components/erp/action-bar"
import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridCheckbox,
  DataGridCount,
  DataGridEmpty,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { loadLotStockOptions } from "@/lib/inventory/actions"
import { formatPlacePath, formatStockQuantity } from "@/lib/inventory/constants"
import type { LotStockRow } from "@/lib/inventory/queries"
import {
  LOT_EXPIRY_FILTERS,
  todayInKorea,
  type LotExpiryFilter,
} from "@/lib/inventory/schema"
import { formatNumber } from "@/lib/format"

import { ExpiryText } from "./expiry-badge"
import { placeFilterIds, type StockPlaceLevel } from "./place-tree"
import { ScheduledBadge } from "./scheduled-badge"
import { StockPlaceField } from "./stock-place-field"
import { StorageFitIcon } from "./storage-fit"
import { useStockPlaces } from "./use-stock-places"

const SEARCH_DELAY = 300
const PAGE_SIZE = 100
const COLUMN_COUNT = 8

type Filters = {
  q: string
  expiry: LotExpiryFilter
  /** 창고 / 구역 / 위치 filter, or null. */
  place: StockPlaceRef | null
}

/** A chosen 창고 / 구역 / 위치: its level and id. */
export type StockPlaceRef = { level: StockPlaceLevel; id: string }

type LotResult =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready"
      rows: LotStockRow[]
      total: number
      page: number
      pageCount: number
    }

/** "본사 물류센터 > 냉장 B구역 > B-02-R02" of a lot row. */
export function lotRowPlace(row: LotStockRow): string {
  return formatPlacePath(row.warehouseName, row.zoneName, row.locationCode)
}

/**
 * 재고(로트) 선택 dialog for 폐기 and 이동: the stock on hand per (lot,
 * 위치) — the same rows as 재고처별 재고현황 — with filters 검색어 (상품
 * 코드·상품명·바코드·로트번호), 기한 (전체 / 경과·임박 / …) and 위치 (창고,
 * 구역 or 위치). 100 rows at a time ("더 보기"). Several rows can be
 * checked and added with [선택 추가]; a double-click (or Enter) adds that
 * row too. Rows already in the form (`addedBalanceIds`) cannot be picked
 * again.
 *
 * Mount it only while it is open.
 *
 * @example
 * {lotPickerOpen && (
 *   <LotPickerDialog title="폐기할 재고 선택" initialExpiry="attention" sort="expiry_date"
 *     addedBalanceIds={added} onPick={addLines} onClose={() => setLotPickerOpen(false)} />
 * )}
 */
export function LotPickerDialog({
  title = "재고 선택",
  description,
  initialExpiry = "all",
  initialPlace = null,
  lockPlace = false,
  productId = null,
  sort = "location",
  addedBalanceIds,
  onPick,
  onClose,
}: {
  title?: string
  description?: string
  initialExpiry?: LotExpiryFilter
  /** Start with this 창고 / 구역 / 위치 filter. */
  initialPlace?: StockPlaceRef | null
  /** The 위치 filter cannot be changed (e.g. the 보내는 위치 of 이동). */
  lockPlace?: boolean
  /** Only lots of this 기준상품. */
  productId?: string | null
  /** "expiry_date": earliest 기한 first (폐기); "location": by 위치 (이동). */
  sort?: "expiry_date" | "location"
  addedBalanceIds: ReadonlySet<string>
  onPick: (rows: LotStockRow[]) => void
  onClose: () => void
}) {
  const places = useStockPlaces()
  const [filters, setFilters] = useState<Filters>({
    q: "",
    expiry: initialExpiry,
    place: initialPlace,
  })
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<LotResult>({ status: "loading" })
  const [loadingMore, setLoadingMore] = useState(false)
  const [checked, setChecked] = useState<Map<string, LotStockRow>>(
    () => new Map()
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [, startFetch] = useTransition()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const requestRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function fetchPage(next: Filters, page: number) {
    const request = ++requestRef.current
    startFetch(async () => {
      let list: Awaited<ReturnType<typeof loadLotStockOptions>>
      try {
        list = await loadLotStockOptions({
          q: next.q,
          expiry: next.expiry,
          ...placeFilterIds(next.place),
          productId,
          page,
          pageSize: PAGE_SIZE,
          sort,
        })
      } catch (error) {
        unstable_rethrow(error)
        if (request !== requestRef.current) return
        console.error(error)
        setLoadingMore(false)
        setResult({ status: "error" })
        return
      }
      if (request !== requestRef.current) return
      setLoadingMore(false)
      setResult((current) => {
        if (page === 1 || current.status !== "ready") {
          return {
            status: "ready",
            rows: list.rows,
            total: list.total,
            page: list.page,
            pageCount: list.pageCount,
          }
        }
        const shown = new Set(current.rows.map((row) => row.balanceId))
        return {
          status: "ready",
          rows: [
            ...current.rows,
            ...list.rows.filter((row) => !shown.has(row.balanceId)),
          ],
          total: list.total,
          page: list.page,
          pageCount: list.pageCount,
        }
      })
    })
  }

  // The first page when the dialog opens (later changes call fetchPage).
  useEffect(() => {
    const requests = requestRef
    const timer = timerRef
    fetchPage(filters, 1)
    return () => {
      requests.current++
      if (timer.current) clearTimeout(timer.current)
    }
    // Once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function applyFilters(changes: Partial<Filters>) {
    const next = { ...filters, ...changes }
    setFilters(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setResult({ status: "loading" })
    setLoadingMore(false)
    fetchPage(next, 1)
  }

  function loadMore() {
    if (result.status !== "ready" || loadingMore) return
    if (result.page >= result.pageCount) return
    setLoadingMore(true)
    fetchPage(filters, result.page + 1)
  }

  const rows = result.status === "ready" ? result.rows : []

  function toggle(row: LotStockRow, next: boolean) {
    if (addedBalanceIds.has(row.balanceId)) return
    setChecked((current) => {
      const updated = new Map(current)
      if (next) updated.set(row.balanceId, row)
      else updated.delete(row.balanceId)
      return updated
    })
  }

  function pick(row?: LotStockRow) {
    const picked = [...checked.values()]
    if (
      row &&
      !addedBalanceIds.has(row.balanceId) &&
      !checked.has(row.balanceId)
    ) {
      picked.push(row)
    }
    if (picked.length === 0) return
    onPick(picked)
    onClose()
  }

  function focusRow(element: Element | null | undefined) {
    if (element instanceof HTMLElement) element.focus()
  }

  function handleRowKeyDown(
    event: React.KeyboardEvent<HTMLTableRowElement>,
    row: LotStockRow
  ) {
    if (event.target !== event.currentTarget) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      focusRow(event.currentTarget.nextElementSibling)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      const previous = event.currentTarget.previousElementSibling
      if (previous) focusRow(previous)
      else searchInputRef.current?.focus()
    } else if (event.key === " ") {
      event.preventDefault()
      toggle(row, !checked.has(row.balanceId))
    } else if (event.key === "Enter") {
      event.preventDefault()
      pick(row)
    }
  }

  const focusId =
    activeId && rows.some((row) => row.balanceId === activeId)
      ? activeId
      : (rows[0]?.balanceId ?? null)
  const expiryOptions = LOT_EXPIRY_FILTERS.map(({ value, label }) => ({
    value,
    label,
  }))

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={title}
      size="xl"
      initialFocus={searchInputRef}
      description={
        description ??
        "재고가 있는 로트만 보입니다(로트 × 위치). 여러 줄을 체크해 [선택 추가]를 누르거나, 줄을 두 번 누르면(또는 Enter) 바로 추가합니다."
      }
      footer={
        <>
          <ActionButton variant="secondary" size="lg" onClick={onClose}>
            취소
          </ActionButton>
          <ActionButton
            size="lg"
            disabled={checked.size === 0}
            onClick={() => pick()}
          >
            선택 추가
            {checked.size > 0 && ` (${formatNumber(checked.size, 0)}줄)`}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,20rem)_10rem_minmax(0,1fr)]">
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchInputRef}
              type="search"
              aria-label="재고 검색"
              placeholder="상품코드, 상품명, 바코드, 로트번호"
              className="h-8 rounded-sm pl-8"
              value={query}
              maxLength={100}
              enterKeyHint="search"
              autoComplete="off"
              onChange={(event) => {
                const text = event.target.value
                setQuery(text)
                if (timerRef.current) clearTimeout(timerRef.current)
                timerRef.current = setTimeout(
                  () => applyFilters({ q: text.trim() }),
                  SEARCH_DELAY
                )
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  if (event.nativeEvent.isComposing || event.keyCode === 229) {
                    return
                  }
                  applyFilters({ q: query.trim() })
                } else if (event.key === "ArrowDown") {
                  event.preventDefault()
                  focusRow(
                    tableRef.current?.querySelector("tbody tr[tabindex]")
                  )
                }
              }}
            />
          </div>
          <Select
            items={expiryOptions}
            value={filters.expiry}
            onValueChange={(next) => {
              if (next && next !== filters.expiry) {
                applyFilters({ expiry: next as LotExpiryFilter })
              }
            }}
          >
            <SelectTrigger
              aria-label="기한 조건"
              className="h-8 w-full rounded-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {expiryOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  기한: {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <StockPlaceField
            aria-label="위치 조건"
            value={filters.place?.id ?? null}
            onChange={(place) =>
              applyFilters({
                place: place ? { level: place.level, id: place.id } : null,
              })
            }
            tree={places.tree}
            treeStatus={places.status}
            onReloadTree={places.reload}
            reloading={places.reloading}
            selectable="any"
            purpose="filter"
            placeholder="전체 위치"
            clearable={!lockPlace}
            clearLabel={lockPlace ? undefined : "전체 위치"}
            disabled={lockPlace}
            pickerTitle="위치 조건 선택"
          />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {result.status === "ready" && (
            <DataGridCount shown={rows.length} total={result.total} />
          )}
          <span className="text-[13px]" aria-live="polite">
            체크{" "}
            <strong className="font-bold text-brand">
              {formatNumber(checked.size, 0)}
            </strong>
            줄
          </span>
        </div>

        <DataGrid
          ref={tableRef}
          aria-label="재고(로트) 목록"
          aria-busy={result.status === "loading"}
          containerClassName="max-h-[min(30rem,52dvh)]"
          className={rows.length > 0 ? "min-w-[64rem]" : undefined}
        >
          <DataGridHeader>
            <tr>
              <DataGridHead className="w-9">
                <span className="sr-only">선택</span>
              </DataGridHead>
              <DataGridHead className="min-w-48">위치</DataGridHead>
              <DataGridHead className="w-28">상품코드</DataGridHead>
              <DataGridHead className="min-w-44">상품명</DataGridHead>
              <DataGridHead className="w-36">로트번호</DataGridHead>
              <DataGridHead className="w-56">기한</DataGridHead>
              <DataGridHead className="w-28">수량</DataGridHead>
              <DataGridHead className="w-24">입고일</DataGridHead>
            </tr>
          </DataGridHeader>
          <DataGridBody>
            {result.status === "error" ? (
              <DataGridEmpty colSpan={COLUMN_COUNT}>
                <div role="alert" className="flex flex-col items-center gap-2">
                  <p>재고를 불러오지 못했습니다.</p>
                  <ActionButton
                    variant="neutral"
                    onClick={() => applyFilters({})}
                  >
                    다시 시도
                  </ActionButton>
                </div>
              </DataGridEmpty>
            ) : result.status === "loading" ? (
              <DataGridEmpty colSpan={COLUMN_COUNT}>
                <span className="inline-flex items-center gap-1.5">
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="size-4 animate-spin"
                  />
                  재고를 불러오는 중…
                </span>
              </DataGridEmpty>
            ) : rows.length === 0 ? (
              <DataGridEmpty colSpan={COLUMN_COUNT}>
                조건에 맞는 재고가 없습니다. 검색어나 기한·위치 조건을 바꿔
                보세요.
              </DataGridEmpty>
            ) : (
              rows.map((row) => {
                const isAdded = addedBalanceIds.has(row.balanceId)
                const isChecked = checked.has(row.balanceId)
                return (
                  <DataGridRow
                    key={row.balanceId}
                    selected={isChecked}
                    tabIndex={row.balanceId === focusId ? 0 : -1}
                    aria-disabled={isAdded || undefined}
                    data-active={
                      row.balanceId === activeId ? "true" : undefined
                    }
                    onClick={() => setActiveId(row.balanceId)}
                    onFocus={(event) => {
                      if (event.target === event.currentTarget) {
                        setActiveId(row.balanceId)
                      }
                    }}
                    onDoubleClick={(event) => {
                      const target = event.target as HTMLElement
                      if (target.closest('[role="checkbox"]')) return
                      pick(row)
                    }}
                    onKeyDown={(event) => handleRowKeyDown(event, row)}
                    className={
                      isAdded
                        ? "cursor-default text-muted-foreground outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                        : "cursor-default outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[active=true]:outline-2 data-[active=true]:-outline-offset-2 data-[active=true]:outline-brand"
                    }
                  >
                    <DataGridCell align="center" className="px-0">
                      <DataGridCheckbox
                        tabIndex={-1}
                        aria-label={`${row.productName} ${row.lotNo} 선택`}
                        checked={isChecked || isAdded}
                        disabled={isAdded}
                        onCheckedChange={(next) => toggle(row, next)}
                      />
                    </DataGridCell>
                    <DataGridCell className="max-w-64">
                      <span className="flex items-center gap-1">
                        <span className="truncate" title={lotRowPlace(row)}>
                          {lotRowPlace(row)}
                        </span>
                        <StorageFitIcon
                          productStorage={row.productStorageType}
                          zoneStorage={row.zoneStorageType}
                        />
                      </span>
                    </DataGridCell>
                    <DataGridCell align="center" className="tabular-nums">
                      {row.productCode}
                    </DataGridCell>
                    <DataGridCell
                      className="max-w-64 truncate"
                      title={row.productName}
                    >
                      {row.productName}
                      {isAdded && (
                        <span className="ml-1.5 rounded-sm border border-input px-1 text-[11px] font-bold">
                          추가됨
                        </span>
                      )}
                    </DataGridCell>
                    <DataGridCell className="tabular-nums">
                      {row.lotNo}
                    </DataGridCell>
                    <DataGridCell>
                      <ExpiryText
                        kind={row.expiryKind}
                        date={row.expiryDate}
                        daysLeft={row.daysLeft}
                        status={row.expiryStatus}
                      />
                    </DataGridCell>
                    <DataGridCell numeric>
                      {formatStockQuantity(row.quantity, row.productUnit)}
                    </DataGridCell>
                    <DataGridCell align="center" className="tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        {row.receivedDate}
                        <ScheduledBadge
                          date={row.receivedDate}
                          today={todayInKorea()}
                          title="오늘 이후 날짜의 예정 입고입니다. 그 날짜부터 폐기·이동할 수 있습니다."
                        />
                      </span>
                    </DataGridCell>
                  </DataGridRow>
                )
              })
            )}
          </DataGridBody>
        </DataGrid>

        {result.status === "ready" && result.page < result.pageCount && (
          <div className="flex justify-center">
            <ActionButton
              variant="neutral"
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              더 보기 (남은 {formatNumber(result.total - rows.length, 0)}줄)
            </ActionButton>
          </div>
        )}
      </div>
    </ErpDialog>
  )
}
