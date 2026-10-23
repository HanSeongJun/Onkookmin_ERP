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
  DataGridHeadGroup,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { Input } from "@/components/ui/input"
import { EMPTY_VALUE, formatNumber } from "@/lib/format"
import { searchBaseProductsForBundle } from "@/lib/products/actions"
import type { BaseProductOption } from "@/lib/products/bundle"
import {
  BUNDLE_ITEMS_MAX,
  storageTypeLabel,
  taxTypeLabel,
} from "@/lib/products/constants"
import { PRODUCT_SEARCH_MAX_LENGTH } from "@/lib/products/schema"
import { excludedOf } from "@/lib/products/vat"
import { cn } from "@/lib/utils"

/** Wait after the last key before searching (ms). */
const SEARCH_DELAY = 300

/** Number of columns (for the full-width empty row). */
const COLUMN_COUNT = 9

/** What the list shows. */
type SearchResult =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready"
      /** The search text these rows belong to. */
      searched: string
      rows: BaseProductOption[]
      /** All matches (more than `rows` when "더 보기" is offered). */
      total: number
    }

/**
 * 기준상품 선택 dialog for a 묶음상품's 구성상품 ([기준상품 추가]).
 *
 * - Shows 사용 중인 기준상품 only, in 상품코드 order, 100 at a time
 *   ("더 보기" reads the next 100). The search box looks in 상품코드, 상품명
 *   and 바코드 (while typing, or at once with Enter).
 * - Several products can be checked, also across searches, and added
 *   together with [선택 추가]. A double-click (or Enter on a row) adds that
 *   row (plus the checked ones) right away.
 * - Products already in the 구성상품 table are shown but cannot be picked
 *   ("추가됨"). At most `capacity` more can be picked.
 * - Keyboard: ↓ from the search box goes to the list, ↑/↓ move between
 *   rows, Space checks, Enter adds. Esc closes only this dialog.
 *
 * Mount it only while it is open (`{open && <BaseProductPickerDialog … />}`):
 * every opening starts fresh.
 */
export function BaseProductPickerDialog({
  addedIds,
  capacity = BUNDLE_ITEMS_MAX,
  onAdd,
  onClose,
}: {
  /** 기준상품 already in the 구성상품 table (shown as "추가됨"). */
  addedIds: ReadonlySet<string>
  /** How many more 기준상품 may be added. */
  capacity?: number
  /** Adds these 기준상품 (in the order they were checked). */
  onAdd: (products: BaseProductOption[]) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<SearchResult>({ status: "loading" })
  const [loadingMore, setLoadingMore] = useState(false)
  // Checked products, in the order they were checked (kept across searches).
  const [checked, setChecked] = useState<Map<string, BaseProductOption>>(
    () => new Map()
  )
  const [activeId, setActiveId] = useState<string | null>(null)

  const [, startFetch] = useTransition()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  // Only the answer to the latest request is shown.
  const requestRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Reads one page of matches. `offset` 0 replaces the list, more appends
   * (the "더 보기" button).
   */
  function fetchRows(text: string, offset: number) {
    const request = ++requestRef.current
    // In a transition, so a redirect from the server (e.g. to the login page
    // when the session has expired) is carried out by Next.js.
    startFetch(async () => {
      let found: { rows: BaseProductOption[]; total: number }
      try {
        found = await searchBaseProductsForBundle(text, offset)
      } catch (error) {
        unstable_rethrow(error)
        if (request !== requestRef.current) return
        console.error(error)
        setLoadingMore(false)
        setResult({ status: "error" })
        return
      }
      if (request !== requestRef.current) return
      const { rows, total } = found
      setLoadingMore(false)
      setResult((current) => {
        if (offset === 0 || current.status !== "ready") {
          return { status: "ready", searched: text, rows, total }
        }
        const shown = new Set(current.rows.map((row) => row.id))
        return {
          status: "ready",
          searched: text,
          rows: [...current.rows, ...rows.filter((row) => !shown.has(row.id))],
          total,
        }
      })
    })
  }

  // The first list (all 사용 기준상품) when the dialog opens (once).
  useEffect(() => {
    const requests = requestRef
    const timer = timerRef
    fetchRows("", 0)
    return () => {
      // Closed: ignore answers still on their way, stop a waiting search.
      requests.current++
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  /** Searches for `text` from the first row. */
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
  const remaining = capacity - checked.size

  function isPickable(row: BaseProductOption): boolean {
    return !addedIds.has(row.id) && (checked.has(row.id) || remaining > 0)
  }

  function toggle(row: BaseProductOption, next: boolean) {
    if (addedIds.has(row.id)) return
    setChecked((current) => {
      const updated = new Map(current)
      if (next && updated.size < capacity) {
        updated.set(row.id, row)
      } else {
        updated.delete(row.id)
      }
      return updated
    })
  }

  /** Adds the checked products (and `row`, if given) and closes. */
  function add(row?: BaseProductOption) {
    const products = [...checked.values()]
    if (
      row &&
      !addedIds.has(row.id) &&
      !checked.has(row.id) &&
      products.length < capacity
    ) {
      products.push(row)
    }
    if (products.length === 0) return
    onAdd(products)
    onClose()
  }

  function focusRow(element: Element | null | undefined) {
    if (element instanceof HTMLElement) element.focus()
  }

  function handleRowKeyDown(
    event: React.KeyboardEvent<HTMLTableRowElement>,
    row: BaseProductOption
  ) {
    if (event.target !== event.currentTarget) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      focusRow(event.currentTarget.nextElementSibling)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      const previous = event.currentTarget.previousElementSibling
      if (previous) {
        focusRow(previous)
      } else {
        searchInputRef.current?.focus()
      }
    } else if (event.key === " ") {
      event.preventDefault()
      if (isPickable(row)) toggle(row, !checked.has(row.id))
    } else if (event.key === "Enter") {
      event.preventDefault()
      add(row)
    }
  }

  // The row reached with Tab: the current row, or the first one.
  const focusId =
    activeId && rows.some((row) => row.id === activeId)
      ? activeId
      : (rows[0]?.id ?? null)

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="기준상품 선택"
      size="lg"
      initialFocus={searchInputRef}
      description="사용 중인 기준상품만 보입니다. 여러 개를 체크해 [선택 추가]를 누르거나, 줄을 두 번 누르면(또는 Enter) 그 상품을 바로 추가합니다."
      footer={
        <>
          <ActionButton variant="secondary" size="lg" onClick={onClose}>
            취소
          </ActionButton>
          <ActionButton
            size="lg"
            disabled={checked.size === 0}
            onClick={() => add()}
          >
            선택 추가
            {checked.size > 0 && ` (${formatNumber(checked.size, 0)}개)`}
          </ActionButton>
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
            aria-label="기준상품 검색"
            placeholder="상품코드, 상품명, 바코드로 찾기"
            className="h-8 rounded-sm pl-8"
            value={query}
            maxLength={PRODUCT_SEARCH_MAX_LENGTH}
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
                // Never submit a form around the dialog. Enter that only
                // finishes a Korean syllable (IME) does nothing else.
                event.preventDefault()
                if (event.nativeEvent.isComposing || event.keyCode === 229) {
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

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {result.status === "ready" && (
            <DataGridCount shown={rows.length} total={result.total} />
          )}
          <span className="text-[13px]" aria-live="polite">
            체크{" "}
            <strong className="font-bold text-brand">
              {formatNumber(checked.size, 0)}
            </strong>
            건
            {remaining <= 0 &&
              ` · 더 넣을 수 없습니다 (묶음상품 하나에 ${BUNDLE_ITEMS_MAX}종류까지)`}
          </span>
        </div>

        <DataGrid
          ref={tableRef}
          aria-label="기준상품 목록"
          aria-busy={result.status === "loading"}
          containerClassName="max-h-[min(24rem,45dvh)]"
          className={rows.length > 0 ? "min-w-[50rem]" : undefined}
        >
          <DataGridHeader>
            <tr>
              <DataGridHead rowSpan={2} className="w-9">
                <span className="sr-only">선택</span>
              </DataGridHead>
              <DataGridHead rowSpan={2} className="w-28">
                상품코드
              </DataGridHead>
              <DataGridHead rowSpan={2} className="min-w-48">
                상품명
              </DataGridHead>
              <DataGridHead rowSpan={2} className="w-24">
                규격
              </DataGridHead>
              <DataGridHead rowSpan={2} className="w-14">
                단위
              </DataGridHead>
              <DataGridHead rowSpan={2} className="w-16">
                보관온도
              </DataGridHead>
              <DataGridHead rowSpan={2} className="w-16">
                과세구분
              </DataGridHead>
              <DataGridHeadGroup colSpan={2}>판매단가</DataGridHeadGroup>
            </tr>
            <tr>
              <DataGridHead subHead className="w-24">
                부가세 별도
              </DataGridHead>
              <DataGridHead subHead className="w-24 border-r-0">
                부가세 포함
              </DataGridHead>
            </tr>
          </DataGridHeader>
          <DataGridBody>
            {result.status === "error" ? (
              <DataGridEmpty colSpan={COLUMN_COUNT}>
                <div role="alert" className="flex flex-col items-center gap-2">
                  <p>기준상품을 불러오지 못했습니다.</p>
                  <ActionButton
                    variant="neutral"
                    onClick={() => search(query.trim())}
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
                  기준상품을 불러오는 중…
                </span>
              </DataGridEmpty>
            ) : result.status === "ready" && rows.length === 0 ? (
              <DataGridEmpty colSpan={COLUMN_COUNT}>
                {result.searched
                  ? `‘${result.searched}’이(가) 들어간 사용 중인 기준상품이 없습니다.`
                  : "사용 중인 기준상품이 없습니다. 먼저 기준상품을 등록해 주세요."}
              </DataGridEmpty>
            ) : (
              rows.map((row) => {
                const isAdded = addedIds.has(row.id)
                const isChecked = checked.has(row.id)
                const pickable = isPickable(row)
                return (
                  <DataGridRow
                    key={row.id}
                    selected={isChecked}
                    tabIndex={row.id === focusId ? 0 : -1}
                    aria-disabled={isAdded || undefined}
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
                      add(row)
                    }}
                    onKeyDown={(event) => handleRowKeyDown(event, row)}
                    className={cn(
                      "cursor-default outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[active=true]:outline-2 data-[active=true]:-outline-offset-2 data-[active=true]:outline-brand",
                      isAdded && "text-muted-foreground"
                    )}
                  >
                    <DataGridCell align="center" className="px-0">
                      <DataGridCheckbox
                        tabIndex={-1}
                        aria-label={`${row.name} 선택`}
                        checked={isChecked || isAdded}
                        disabled={!pickable}
                        onCheckedChange={(next) => toggle(row, next)}
                      />
                    </DataGridCell>
                    <DataGridCell align="center" className="tabular-nums">
                      {row.code}
                    </DataGridCell>
                    <DataGridCell
                      className="max-w-72 truncate"
                      title={row.name}
                    >
                      {row.name}
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
                      {storageTypeLabel(row.storageType)}
                    </DataGridCell>
                    <DataGridCell align="center">
                      {taxTypeLabel(row.taxType)}
                    </DataGridCell>
                    <DataGridCell numeric>
                      {row.salePriceInclVat === null
                        ? EMPTY_VALUE
                        : formatNumber(
                            excludedOf(
                              row.salePriceInclVat,
                              row.taxType === "taxable"
                            ),
                            0
                          )}
                    </DataGridCell>
                    <DataGridCell numeric>
                      {formatNumber(row.salePriceInclVat, 0)}
                    </DataGridCell>
                  </DataGridRow>
                )
              })
            )}
          </DataGridBody>
        </DataGrid>

        {result.status === "ready" && rows.length < result.total && (
          <div className="flex justify-center">
            <ActionButton
              variant="neutral"
              disabled={loadingMore}
              onClick={loadMore}
            >
              {loadingMore && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              더 보기 (남은 {formatNumber(result.total - rows.length, 0)}건)
            </ActionButton>
          </div>
        )}
      </div>
    </ErpDialog>
  )
}
