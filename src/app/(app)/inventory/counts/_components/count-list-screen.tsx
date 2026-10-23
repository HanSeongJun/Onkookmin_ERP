"use client"

import { LoaderCircleIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useOptimistic, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import {
  ActionBar,
  ActionButton,
  actionButtonClassName,
} from "@/components/erp/action-bar"
import { DataGridCount } from "@/components/erp/data-grid"
import { DATE_FILTER_INPUT_CLASS } from "@/components/inventory/date-range"
import { downloadInventoryCsv } from "@/components/inventory/download-csv"
import { QuickRangeButtons } from "@/components/inventory/quick-range-buttons"
import { StockPagination } from "@/components/inventory/stock-pagination"
import { SearchField, SearchPanel } from "@/components/erp/search-panel"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { formatNumber } from "@/lib/format"
import type { StockDocumentRow } from "@/lib/inventory/queries"
import {
  buildStockDocumentExportHref,
  buildStockDocumentListHref,
  buildStockDocumentModalHref,
  defaultStockDocumentListParams,
  INVENTORY_EXPORT_MAX_ROWS,
  INVENTORY_PAGE_SIZES,
  INVENTORY_SEARCH_MAX_LENGTH,
  isCalendarDate,
  parseStockDocumentModal,
  STOCK_DOCUMENT_STATUS_FILTERS,
  todayInKorea,
  type InventoryPageSize,
  type StockDocumentListParams,
  type StockDocumentModalState,
  type StockDocumentStatusFilter,
} from "@/lib/inventory/schema"

import { CountDialog } from "./count-dialog"
import { CountDocumentDialog } from "./count-document-dialog"
import { CountDocumentGrid } from "./count-document-grid"
import { SimpleSelect } from "./count-ui"

const SEARCH_FORM_ID = "count-search"

/**
 * The 실사재고조정 screen below the page title: action buttons (조회 F4,
 * 신규 F5 = 실사 등록, 엑셀 Ctrl+F9), the 조회 conditions, "N건 / 총 M건",
 * the 전표 grid and its pages, plus the modals (실사 등록, 전표 보기).
 *
 * Everything that should survive a refresh or the back button is in the
 * URL: the conditions (?from=…&to=…&q=…) and the open modal (?modal=new or
 * ?modal=view&id=…). Opening a modal adds a history entry without
 * reloading the list, so the browser's back button closes it.
 */
export function CountListScreen({
  params,
  rows,
  total,
  pageCount,
  productLabel,
}: {
  /** Conditions of the loaded list (from the URL; page clamped). */
  params: StockDocumentListParams
  rows: StockDocumentRow[]
  /** 전표 matching the conditions (all pages). */
  total: number
  pageCount: number
  /** "[코드] 상품명" of the URL's product filter, or null. */
  productLabel: string | null
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const modal = parseStockDocumentModal(searchParams)

  const [isPending, startTransition] = useTransition()
  // The conditions as just chosen (ahead of the loaded list while it loads).
  const [shown, setShown] = useOptimistic(params)
  const searchFormRef = useRef<HTMLFormElement>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  // The modal URLs this screen added to the history, oldest first.
  const pushedModalUrlsRef = useRef<string[]>([])

  // ---- 조회 -----------------------------------------------------------------

  function openList(next: StockDocumentListParams) {
    const href = buildStockDocumentListHref("count", next)
    startTransition(() => {
      setShown(next)
      // 조회 with unchanged conditions reads the list again.
      if (href === buildStockDocumentListHref("count", params)) {
        router.refresh()
      } else {
        router.push(href)
      }
    })
  }

  /** The 기간 and 검색어 boxes (applied together with any other change). */
  function typedConditions(): Pick<
    StockDocumentListParams,
    "from" | "to" | "q"
  > | null {
    const form = searchFormRef.current
    if (!form) return { from: shown.from, to: shown.to, q: shown.q }
    const data = new FormData(form)
    const from = String(data.get("from") ?? "").trim()
    const to = String(data.get("to") ?? "").trim()
    if (!isCalendarDate(from) || !isCalendarDate(to)) {
      toast.error("전표일자 기간을 날짜로 입력해 주세요. (예: 2026-10-01)")
      return null
    }
    return {
      from: from <= to ? from : to,
      to: from <= to ? to : from,
      q: String(data.get("q") ?? "").trim(),
    }
  }

  function applyFilters(changes: Partial<StockDocumentListParams>) {
    const typed = typedConditions()
    if (!typed) return
    openList({ ...shown, ...typed, ...changes, page: 1 })
  }

  /** A quick period button (same choices as the other 재고 lists). */
  function applyPeriod(from: string, to: string) {
    const typed = typedConditions()
    openList({
      ...shown,
      q: typed?.q ?? shown.q,
      from,
      to,
      page: 1,
    })
  }

  function resetFilters() {
    openList({
      ...defaultStockDocumentListParams(),
      pageSize: shown.pageSize,
    })
  }

  const defaults = defaultStockDocumentListParams()
  const hasFilters =
    shown.from !== defaults.from ||
    shown.to !== defaults.to ||
    shown.q !== "" ||
    shown.productId !== null ||
    shown.partnerId !== null ||
    shown.status !== "all" ||
    !shown.includeReversals

  // ---- Modal (in the URL) ---------------------------------------------------

  // Never router.refresh() while a modal address is shown: Next.js would
  // then stop following later pushState addresses. The modals read fresh
  // data with Server Actions instead.
  function openModal(state: StockDocumentModalState) {
    window.history.pushState(
      null,
      "",
      buildStockDocumentModalHref("count", window.location.search, state)
    )
    // Remember it in the browser's own spelling, to compare it later.
    pushedModalUrlsRef.current.push(
      window.location.pathname + window.location.search
    )
  }

  function closeModal() {
    const current = window.location.pathname + window.location.search
    const pushed = pushedModalUrlsRef.current
    const index = pushed.lastIndexOf(current)
    if (index >= 0) {
      // We added this entry: going back removes it, so the browser's back
      // button later does not reopen it.
      pushed.splice(index)
      window.history.back()
    } else {
      // Opened from a link or a refresh: just drop the modal from the URL.
      window.history.replaceState(
        null,
        "",
        buildStockDocumentModalHref("count", window.location.search, null)
      )
    }
  }

  /** After 실사 저장: the 등록 modal becomes the saved 전표 (same history entry). */
  function showSavedDocument(documentId: string) {
    const before = window.location.pathname + window.location.search
    window.history.replaceState(
      null,
      "",
      buildStockDocumentModalHref("count", window.location.search, {
        mode: "view",
        id: documentId,
      })
    )
    const after = window.location.pathname + window.location.search
    const pushed = pushedModalUrlsRef.current
    const index = pushed.lastIndexOf(before)
    if (index >= 0) pushed[index] = after
  }

  // ---- 엑셀 -----------------------------------------------------------------

  async function downloadExcel() {
    if (isExporting) return
    if (total === 0) {
      toast.info("내려받을 전표가 없습니다. 조회 조건을 확인해 주세요.")
      return
    }
    if (
      total > INVENTORY_EXPORT_MAX_ROWS &&
      !window.confirm(
        `조회된 전표가 ${formatNumber(total, 0)}건입니다. 엑셀에는 앞의 ${formatNumber(INVENTORY_EXPORT_MAX_ROWS, 0)}건만 담깁니다. 계속할까요?`
      )
    ) {
      return
    }

    setIsExporting(true)
    try {
      await downloadInventoryCsv(
        buildStockDocumentExportHref("count", params),
        "실사조정전표.csv"
      )
    } finally {
      setIsExporting(false)
    }
  }

  // ---- Keyboard ---------------------------------------------------------------

  // F4 = 조회, F5 = 신규 (instead of reloading the page), Ctrl+F9 = 엑셀.
  // Off while a modal is open (it has its own keys).
  useHotkeys(
    {
      F4: () => searchFormRef.current?.requestSubmit(),
      F5: () => openModal({ mode: "new" }),
      "Ctrl+F9": () => void downloadExcel(),
    },
    { enabled: modal === null }
  )

  // ---- Screen ---------------------------------------------------------------

  const statusOptions = STOCK_DOCUMENT_STATUS_FILTERS.map(
    ({ value, label }) => ({
      value,
      label: value === "reversed" ? "취소된 전표" : label,
    })
  )
  const sizeOptions = INVENTORY_PAGE_SIZES.map((size) => ({
    value: String(size),
    label: `${size}개씩 보기`,
  }))

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <ActionBar
        end={
          <>
            <ActionButton
              variant="neutral"
              disabled={!hasFilters}
              onClick={resetFilters}
            >
              조건 초기화
            </ActionButton>
            <ActionButton
              keyHint="Ctrl+F9"
              disabled={isExporting}
              onClick={() => void downloadExcel()}
            >
              {isExporting && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              엑셀
            </ActionButton>
          </>
        }
      >
        <ActionButton type="submit" form={SEARCH_FORM_ID} keyHint="F4">
          조회
        </ActionButton>
        <ActionButton keyHint="F5" onClick={() => openModal({ mode: "new" })}>
          신규
        </ActionButton>
      </ActionBar>

      <form
        ref={searchFormRef}
        id={SEARCH_FORM_ID}
        role="search"
        aria-label="실사 전표 조회 조건"
        onSubmit={(event) => {
          event.preventDefault()
          applyFilters({})
        }}
      >
        <SearchPanel>
          <SearchField label="전표일자" span={2}>
            {/* The keys reset the boxes when the conditions change from
                outside (조건 초기화, the back button, a period button). */}
            <Input
              key={`from-${shown.from}`}
              name="from"
              type="date"
              aria-label="전표일자 시작일"
              defaultValue={shown.from}
              className={DATE_FILTER_INPUT_CLASS}
            />
            <span aria-hidden="true">~</span>
            <Input
              key={`to-${shown.to}`}
              name="to"
              type="date"
              aria-label="전표일자 종료일"
              defaultValue={shown.to}
              className={DATE_FILTER_INPUT_CLASS}
            />
            <QuickRangeButtons
              today={todayInKorea()}
              from={shown.from}
              to={shown.to}
              onPick={applyPeriod}
            />
          </SearchField>

          <SearchField label="검색어" htmlFor="count-search-q" span={2}>
            <SearchBox key={`q-${shown.q}`} initialValue={shown.q} />
          </SearchField>

          <SearchField label="상태" htmlFor="count-search-status">
            <SimpleSelect
              id="count-search-status"
              value={shown.status}
              options={statusOptions}
              onChange={(value) =>
                applyFilters({ status: value as StockDocumentStatusFilter })
              }
            />
          </SearchField>

          <SearchField label="취소 전표">
            <label className="flex min-h-7 cursor-pointer items-center gap-1.5 text-[13px]">
              <Checkbox
                checked={shown.includeReversals}
                onCheckedChange={(checked) =>
                  applyFilters({ includeReversals: checked })
                }
              />
              취소 전표도 함께 보기
            </label>
          </SearchField>

          {shown.productId && (
            <SearchField label="상품" span={2}>
              <span className="flex min-w-0 items-center gap-1">
                <span className="truncate font-bold">
                  {productLabel ?? "알 수 없는 상품"}
                </span>
                <button
                  type="button"
                  aria-label="상품 조건 지우기"
                  onClick={() => applyFilters({ productId: null })}
                  className="flex size-7 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <XIcon aria-hidden="true" className="size-4" />
                </button>
              </span>
            </SearchField>
          )}
        </SearchPanel>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <DataGridCount shown={rows.length} total={total} />
          {isPending && (
            <LoaderCircleIcon
              className="size-4 animate-spin text-muted-foreground"
              aria-label="불러오는 중"
            />
          )}
        </div>
        <SimpleSelect
          aria-label="한 페이지에 보일 전표 수"
          value={String(shown.pageSize)}
          options={sizeOptions}
          className="w-36"
          onChange={(value) =>
            openList({
              ...shown,
              pageSize: Number(value) as InventoryPageSize,
              page: 1,
            })
          }
        />
      </div>

      <div
        aria-busy={isPending}
        data-pending={isPending}
        className="flex min-w-0 flex-col gap-2.5 transition-opacity data-[pending=true]:opacity-60"
      >
        <CountDocumentGrid
          rows={rows}
          activeId={activeId}
          onActiveIdChange={setActiveId}
          onOpen={(id) => openModal({ mode: "view", id })}
          empty={
            <div className="flex flex-col items-center gap-2">
              <p className="font-bold text-foreground">
                조건에 맞는 실사 전표가 없습니다.
              </p>
              <p>기간을 넓혀 조회하거나, [신규 | F5]로 실사를 시작해 보세요.</p>
              <div className="flex flex-wrap justify-center gap-1.5">
                <ActionButton
                  keyHint="F5"
                  onClick={() => openModal({ mode: "new" })}
                >
                  신규
                </ActionButton>
                {hasFilters && (
                  <Link
                    href={buildStockDocumentListHref("count", {
                      ...defaultStockDocumentListParams(),
                      pageSize: params.pageSize,
                    })}
                    className={actionButtonClassName({ variant: "neutral" })}
                  >
                    조건 초기화
                  </Link>
                )}
              </div>
            </div>
          }
        />
        <StockPagination
          page={params.page}
          pageCount={pageCount}
          hrefFor={(page) =>
            buildStockDocumentListHref("count", { ...params, page })
          }
        />
      </div>

      <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs text-muted-foreground">
        <li>
          [신규 | F5]에서 창고(또는 구역·선반)를 고르고 실사 목록을 불러온 뒤,
          직접 센 수량을 입력하면 전산 수량과 다른 줄만 조정됩니다. 입력하지
          않은 줄은 바뀌지 않습니다.
        </li>
        <li>
          실사 전표는 고칠 수 없습니다. 잘못 저장했다면 전표를 열어 [전표
          취소]로 되돌린 뒤 다시 실사합니다. 전표번호를 누르거나 줄을 두 번
          누르면(또는 줄을 고르고 Enter) 전표가 열립니다.
        </li>
      </ul>

      {modal?.mode === "new" && (
        <CountDialog
          key="new"
          onClose={closeModal}
          onSaved={showSavedDocument}
        />
      )}
      {modal?.mode === "view" && (
        <CountDocumentDialog
          key={`view-${modal.id}`}
          documentId={modal.id}
          onClose={closeModal}
          onOpenDocument={(id) => openModal({ mode: "view", id })}
        />
      )}
    </div>
  )
}

/** The 검색어 box (its text is read from the form when 조회 runs). */
function SearchBox({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue)
  return (
    <Input
      id="count-search-q"
      name="q"
      type="search"
      placeholder="전표번호, 상품코드, 상품명, 로트번호, 사유"
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
