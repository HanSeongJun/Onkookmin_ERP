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
  DataGridEmpty,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { Input } from "@/components/ui/input"
import { searchProductsForStock } from "@/lib/inventory/actions"
import { formatStockQuantity } from "@/lib/inventory/constants"
import type { StockProductOption } from "@/lib/inventory/queries"
import { EMPTY_VALUE, formatNumber } from "@/lib/format"
import { storageTypeLabel } from "@/lib/products/constants"
import { cn } from "@/lib/utils"

/** Wait after the last key before searching (ms). */
const SEARCH_DELAY = 300

type SearchResult =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready"
      searched: string
      rows: StockProductOption[]
      hasMore: boolean
    }

/** "×24" for one kind of 기준상품, "혼합 2종" for several. */
export function bundleCompositionLabel(product: StockProductOption): string {
  if (product.productType !== "bundle") return ""
  if (product.components.length === 1) {
    return `${product.components[0].code} ×${formatNumber(product.components[0].quantityPerUnit, 3)}`
  }
  return `혼합 ${product.components.length}종`
}

/**
 * 상품 선택 dialog for the lines of a 전표 (입고, 출고, 실사 발견 재고):
 * 사용 중인 상품 by 상품코드 / 상품명 / 바코드, 100 at a time ("더 보기").
 * With `includeBundles` 묶음상품 are listed too (입고/출고 split them by
 * their 구성표 into 기준상품). With `includeInactiveWithStock` (출고,
 * 거래수불, filters — never 입고) 사용중지 기준상품 that still have stock
 * are listed too, marked "사용중지". Every 기준상품 shows its 현재고 and
 * 출고 가능 (현재고 − 기한 경과).
 *
 * `multiple` (default): check several and [선택 추가]; a double-click (or
 * Enter) adds that row (plus the checked ones) at once. Products in
 * `addedIds` are marked "추가됨" but can be picked again (e.g. a second
 * 입고 line of the same product with another 기한).
 *
 * Mount it only while it is open.
 */
export function StockProductPickerDialog({
  includeBundles,
  includeInactiveWithStock = false,
  title = "상품 선택",
  multiple = true,
  addedIds,
  onPick,
  onClose,
}: {
  includeBundles: boolean
  /** Also 사용중지 기준상품 with stock (출고, 거래수불, filters). */
  includeInactiveWithStock?: boolean
  title?: string
  multiple?: boolean
  addedIds?: ReadonlySet<string>
  /** The picked products, in the order they were checked. */
  onPick: (products: StockProductOption[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<SearchResult>({ status: "loading" })
  const [loadingMore, setLoadingMore] = useState(false)
  const [checked, setChecked] = useState<Map<string, StockProductOption>>(
    () => new Map()
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [, startFetch] = useTransition()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const requestRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function fetchRows(text: string, offset: number) {
    const request = ++requestRef.current
    startFetch(async () => {
      let found: { rows: StockProductOption[]; hasMore: boolean }
      try {
        found = await searchProductsForStock(
          text,
          includeBundles,
          offset,
          includeInactiveWithStock
        )
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
        if (offset === 0 || current.status !== "ready") {
          return { status: "ready", searched: text, ...found }
        }
        const shown = new Set(current.rows.map((row) => row.id))
        return {
          status: "ready",
          searched: text,
          rows: [
            ...current.rows,
            ...found.rows.filter((row) => !shown.has(row.id)),
          ],
          hasMore: found.hasMore,
        }
      })
    })
  }

  useEffect(() => {
    const requests = requestRef
    const timer = timerRef
    fetchRows("", 0)
    return () => {
      requests.current++
      if (timer.current) clearTimeout(timer.current)
    }
    // Once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function search(text: string) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setResult({ status: "loading" })
    setLoadingMore(false)
    fetchRows(text, 0)
  }

  function loadMore() {
    if (result.status !== "ready" || loadingMore) return
    setLoadingMore(true)
    fetchRows(result.searched, result.rows.length)
  }

  const rows = result.status === "ready" ? result.rows : []

  function toggle(row: StockProductOption, next: boolean) {
    setChecked((current) => {
      const updated = new Map(current)
      if (next) updated.set(row.id, row)
      else updated.delete(row.id)
      return updated
    })
  }

  function pick(row?: StockProductOption) {
    const products = multiple ? [...checked.values()] : []
    if (row && !products.some((product) => product.id === row.id)) {
      products.push(row)
    }
    if (products.length === 0) return
    onPick(products)
    onClose()
  }

  function focusRow(element: Element | null | undefined) {
    if (element instanceof HTMLElement) element.focus()
  }

  function handleRowKeyDown(
    event: React.KeyboardEvent<HTMLTableRowElement>,
    row: StockProductOption
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
    } else if (event.key === " " && multiple) {
      event.preventDefault()
      toggle(row, !checked.has(row.id))
    } else if (event.key === "Enter") {
      event.preventDefault()
      pick(row)
    }
  }

  const focusId =
    activeId && rows.some((row) => row.id === activeId)
      ? activeId
      : (rows[0]?.id ?? null)
  const columnCount = multiple ? 10 : 9

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={title}
      size="lg"
      initialFocus={searchInputRef}
      description={
        multiple
          ? "사용 중인 상품만 보입니다. 여러 개를 체크해 [선택 추가]를 누르거나, 줄을 두 번 누르면(또는 Enter) 그 상품을 바로 추가합니다."
          : "사용 중인 상품만 보입니다. 줄을 두 번 누르거나(또는 Enter) 줄을 고른 뒤 [선택]을 누르세요."
      }
      footer={
        <>
          <ActionButton variant="secondary" size="lg" onClick={onClose}>
            취소
          </ActionButton>
          {multiple ? (
            <ActionButton
              size="lg"
              disabled={checked.size === 0}
              onClick={() => pick()}
            >
              선택 추가
              {checked.size > 0 && ` (${formatNumber(checked.size, 0)}개)`}
            </ActionButton>
          ) : (
            <ActionButton
              size="lg"
              disabled={!rows.some((row) => row.id === activeId)}
              onClick={() => pick(rows.find((row) => row.id === activeId))}
            >
              선택
            </ActionButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="relative max-w-md">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchInputRef}
            type="search"
            aria-label="상품 검색"
            placeholder="상품코드, 상품명, 바코드로 찾기"
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
                () => search(text.trim()),
                SEARCH_DELAY
              )
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                if (event.nativeEvent.isComposing || event.keyCode === 229) {
                  return
                }
                // A scanned barcode or an exact code with one match: take it.
                if (
                  result.status === "ready" &&
                  result.searched === query.trim() &&
                  result.rows.length === 1
                ) {
                  pick(result.rows[0])
                  return
                }
                search(query.trim())
              } else if (event.key === "ArrowDown") {
                event.preventDefault()
                focusRow(tableRef.current?.querySelector("tbody tr[tabindex]"))
              }
            }}
          />
        </div>

        {multiple && (
          <p className="text-[13px]" aria-live="polite">
            체크{" "}
            <strong className="font-bold text-brand">
              {formatNumber(checked.size, 0)}
            </strong>
            건
          </p>
        )}

        <DataGrid
          ref={tableRef}
          aria-label="상품 목록"
          aria-busy={result.status === "loading"}
          containerClassName="max-h-[min(26rem,50dvh)]"
          className={rows.length > 0 ? "min-w-[56rem]" : undefined}
        >
          <DataGridHeader>
            <tr>
              {multiple && (
                <DataGridHead className="w-9">
                  <span className="sr-only">선택</span>
                </DataGridHead>
              )}
              <DataGridHead className="w-14">구분</DataGridHead>
              <DataGridHead className="w-28">상품코드</DataGridHead>
              <DataGridHead className="min-w-48">상품명</DataGridHead>
              <DataGridHead className="w-24">규격</DataGridHead>
              <DataGridHead className="w-14">단위</DataGridHead>
              <DataGridHead className="w-16">보관온도</DataGridHead>
              <DataGridHead className="w-24">현재고</DataGridHead>
              <DataGridHead className="w-24">출고 가능</DataGridHead>
              <DataGridHead className="w-28">기본 매입가(포함)</DataGridHead>
            </tr>
          </DataGridHeader>
          <DataGridBody>
            {result.status === "error" ? (
              <DataGridEmpty colSpan={columnCount}>
                <div role="alert" className="flex flex-col items-center gap-2">
                  <p>상품을 불러오지 못했습니다.</p>
                  <ActionButton
                    variant="neutral"
                    onClick={() => search(query.trim())}
                  >
                    다시 시도
                  </ActionButton>
                </div>
              </DataGridEmpty>
            ) : result.status === "loading" ? (
              <DataGridEmpty colSpan={columnCount}>
                <span className="inline-flex items-center gap-1.5">
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="size-4 animate-spin"
                  />
                  상품을 불러오는 중…
                </span>
              </DataGridEmpty>
            ) : rows.length === 0 ? (
              <DataGridEmpty colSpan={columnCount}>
                {result.searched
                  ? `‘${result.searched}’이(가) 들어간 사용 중인 상품이 없습니다.`
                  : "사용 중인 상품이 없습니다. 먼저 상품관리에서 상품을 등록해 주세요."}
              </DataGridEmpty>
            ) : (
              rows.map((row) => {
                const isChecked = checked.has(row.id)
                const isAdded = addedIds?.has(row.id) ?? false
                return (
                  <DataGridRow
                    key={row.id}
                    selected={isChecked || (!multiple && row.id === activeId)}
                    tabIndex={row.id === focusId ? 0 : -1}
                    data-active={row.id === activeId ? "true" : undefined}
                    onClick={() => setActiveId(row.id)}
                    onFocus={(event) => {
                      if (event.target === event.currentTarget) {
                        setActiveId(row.id)
                      }
                    }}
                    onDoubleClick={(event) => {
                      const target = event.target as HTMLElement
                      if (target.closest('[role="checkbox"]')) return
                      pick(row)
                    }}
                    onKeyDown={(event) => handleRowKeyDown(event, row)}
                    className="cursor-default outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[active=true]:outline-2 data-[active=true]:-outline-offset-2 data-[active=true]:outline-brand"
                  >
                    {multiple && (
                      <DataGridCell align="center" className="px-0">
                        <DataGridCheckbox
                          tabIndex={-1}
                          aria-label={`${row.name} 선택`}
                          checked={isChecked}
                          onCheckedChange={(next) => toggle(row, next)}
                        />
                      </DataGridCell>
                    )}
                    <DataGridCell align="center">
                      <ProductTypeBadge type={row.productType} />
                    </DataGridCell>
                    <DataGridCell align="center" className="tabular-nums">
                      {row.code}
                    </DataGridCell>
                    <DataGridCell
                      className="max-w-80 truncate"
                      title={row.name}
                    >
                      {row.name}
                      {row.productType === "bundle" && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          ({bundleCompositionLabel(row)})
                        </span>
                      )}
                      {!row.isActive && (
                        <span className="ml-1.5 rounded-sm bg-label px-1 text-[11px] font-bold text-muted-foreground">
                          사용중지
                        </span>
                      )}
                      {isAdded && (
                        <span className="ml-1.5 rounded-sm border border-input px-1 text-[11px] font-bold">
                          추가됨
                        </span>
                      )}
                    </DataGridCell>
                    <DataGridCell
                      align="center"
                      className="max-w-32 truncate"
                      title={row.spec ?? undefined}
                    >
                      {row.spec ?? EMPTY_VALUE}
                    </DataGridCell>
                    <DataGridCell align="center">{row.unit}</DataGridCell>
                    <DataGridCell align="center">
                      {row.storageType
                        ? storageTypeLabel(row.storageType)
                        : EMPTY_VALUE}
                    </DataGridCell>
                    <DataGridCell numeric>
                      {row.onHandQuantity === null
                        ? EMPTY_VALUE
                        : formatStockQuantity(row.onHandQuantity, "")}
                    </DataGridCell>
                    <DataGridCell
                      numeric
                      className={cn(
                        row.availableQuantity !== null &&
                          row.onHandQuantity !== null &&
                          row.availableQuantity < row.onHandQuantity &&
                          "text-destructive"
                      )}
                      title={
                        row.availableQuantity !== null &&
                        row.onHandQuantity !== null &&
                        row.availableQuantity < row.onHandQuantity
                          ? "기한이 지난 재고는 출고 가능 수량에서 빠집니다."
                          : undefined
                      }
                    >
                      {row.availableQuantity === null
                        ? EMPTY_VALUE
                        : formatStockQuantity(row.availableQuantity, "")}
                    </DataGridCell>
                    <DataGridCell numeric>
                      {formatNumber(row.purchasePriceInclVat, 0)}
                    </DataGridCell>
                  </DataGridRow>
                )
              })
            )}
          </DataGridBody>
        </DataGrid>

        {result.status === "ready" && result.hasMore && (
          <div className="flex justify-center">
            <ActionButton
              variant="neutral"
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              더 보기
            </ActionButton>
          </div>
        )}
        {includeBundles && (
          <p className="text-xs text-muted-foreground">
            묶음상품은 재고가 따로 없습니다. 입고·출고하면 구성표대로 기준상품
            재고가 늘거나 줄어듭니다.
          </p>
        )}
      </div>
    </ErpDialog>
  )
}

/** "기준" / "묶음" badge of a product. */
export function ProductTypeBadge({ type }: { type: "base" | "bundle" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm border px-1 text-[11px] font-bold",
        type === "bundle"
          ? "border-brand bg-brand-tint text-brand-active"
          : "border-input text-muted-foreground"
      )}
    >
      {type === "bundle" ? "묶음" : "기준"}
    </span>
  )
}
