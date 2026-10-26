"use client"

import { LoaderCircleIcon, PlusIcon } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useHotkeys } from "@/hooks/use-hotkeys"
import type { StockSaveResult } from "@/lib/inventory/actions"
import type { StockDocumentType } from "@/lib/inventory/constants"
import {
  buildStockDocumentExportHref,
  buildStockDocumentListHref,
  buildStockDocumentModalHref,
  defaultStockDocumentListParams,
  INVENTORY_EXPORT_MAX_ROWS,
  INVENTORY_PAGE_SIZES,
  parseStockDocumentModal,
  STOCK_DOCUMENT_SCREENS,
  type InventoryPageSize,
  type StockDocumentListParams,
  type StockDocumentModalState,
} from "@/lib/inventory/schema"
import { formatNumber } from "@/lib/format"

import {
  parseBalanceIdsParam,
  STOCK_DOCUMENT_SCREEN_TEXT,
  withStockDocumentKind,
} from "./document-screens"
import { downloadInventoryCsv } from "./download-csv"
import { StockDocumentGrid } from "./stock-document-grid"
import type { StockDocumentListData } from "./stock-document-data"
import {
  STOCK_DOCUMENT_SEARCH_FORM_ID,
  StockDocumentSearchForm,
} from "./stock-document-search-form"
import { StockDocumentViewDialog } from "./stock-document-view-dialog"
import { StockPagination } from "./stock-pagination"

/** The list's conditions as the shell keeps them (with the 구분 filter). */
type ShellParams = StockDocumentListParams & {
  kind: StockDocumentType | null
}

/** What a screen's 등록 modal gets from the list shell. */
export type StockNewDialogProps = {
  /** Closes the 등록 modal (ask about unsaved changes before calling it). */
  onClose: () => void
  /**
   * Call after a successful save while the modal is still shown (see
   * useNewModalStillShown): shows the toast (and the 보관온도 warnings)
   * and opens the saved 전표 in place of the 등록 modal.
   */
  onSaved: (result: Extract<StockSaveResult, { ok: true }>) => void
  /** (lot × 위치) rows that came with the link (?balances=…; 폐기, 이동). */
  initialBalanceIds: string[]
  /** 기한 임박 기준일 (재고 설정), for D-day badges. */
  expiryWarningDays: number
  /**
   * 전표 일자 허용 범위 (재고 설정): the 전표 may be dated up to today + this
   * many days (예정 전표, e.g. tomorrow's 새벽배송 출고).
   */
  futureDocDays: number
}

/**
 * The list part of a 전표 screen (입고 / 출고 / 폐기 / 이동 / 실사조정), like
 * the other ERP lists: [조회 | F4] [신규 | F5] … [엑셀 | Ctrl+F9], the
 * 조회 conditions, "N건 / 총 M건", the 전표 grid and the page links — plus
 * the modals in the URL:
 *   ?modal=new             the screen's 등록 modal (`renderNewDialog`)
 *   ?modal=view&id=<uuid>  전표 보기 with [전표 취소] (StockDocumentViewDialog)
 * After a save the 등록 modal turns into the saved 전표's 보기 modal (same
 * history entry), so 닫기 / the back button return to the list.
 *
 * The page (Server Component) reads the data with
 * loadStockDocumentListData(screen, searchParams) and a small client
 * wrapper passes the screen's 등록 modal:
 * @example
 * <StockDocumentListScreen data={data} renderNewDialog={(props) => <ReceiptDialog {...props} />} />
 */
export function StockDocumentListScreen({
  data,
  renderNewDialog,
  notes,
}: {
  data: Extract<StockDocumentListData, { ok: true }>
  renderNewDialog: (props: StockNewDialogProps) => React.ReactNode
  /** Short help under the grid. */
  notes?: React.ReactNode
}) {
  const { screen, rows, total, pageCount, expiryWarningDays, futureDocDays } =
    data
  const text = STOCK_DOCUMENT_SCREEN_TEXT[screen]
  // The URL's conditions plus the 구분 filter ("kind").
  const params: ShellParams = { ...data.params, kind: data.kind }
  const router = useRouter()
  const searchParams = useSearchParams()
  const modal = parseStockDocumentModal(searchParams)

  const [isPending, startTransition] = useTransition()
  const [shown, setShown] = useOptimistic(params)
  const searchFormRef = useRef<HTMLFormElement>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  // The modal URLs this screen added to the history, oldest first.
  const pushedModalUrlsRef = useRef<string[]>([])

  // ---- 조회 -----------------------------------------------------------------

  function listHref(next: ShellParams): string {
    return withStockDocumentKind(
      buildStockDocumentListHref(screen, next),
      next.kind
    )
  }

  function openList(next: ShellParams) {
    const href = listHref(next)
    startTransition(() => {
      setShown(next)
      if (href === listHref(params)) {
        router.refresh()
      } else {
        router.push(href)
      }
    })
  }

  /**
   * The 검색어 and 전표일자 typed in the form (applied together with any
   * other change, e.g. the 상태 select); invalid dates keep the shown ones.
   */
  function typedConditions(): Pick<
    StockDocumentListParams,
    "q" | "from" | "to"
  > {
    const form = searchFormRef.current
    if (!form) return { q: shown.q, from: shown.from, to: shown.to }
    const data = new FormData(form)
    const read = (name: string) => {
      const value = data.get(name)
      return typeof value === "string" ? value.trim() : ""
    }
    const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    let from = isDate(read("from")) ? read("from") : shown.from
    let to = isDate(read("to")) ? read("to") : shown.to
    if (from > to) [from, to] = [to, from]
    return { q: read("q"), from, to }
  }

  function applyFilters(changes: Partial<ShellParams>) {
    openList({ ...shown, ...typedConditions(), ...changes, page: 1 })
  }

  const defaults = defaultStockDocumentListParams()
  const hasFilters =
    shown.from !== defaults.from ||
    shown.to !== defaults.to ||
    shown.q !== "" ||
    shown.partnerId !== null ||
    shown.productId !== null ||
    shown.status !== "all" ||
    !shown.includeReversals ||
    shown.kind !== null

  function resetFilters() {
    openList({ ...defaults, kind: null, pageSize: shown.pageSize })
  }

  // ---- Modals (in the URL) --------------------------------------------------

  // Never router.refresh() while a modal address is shown (see CLAUDE.md):
  // the modals read fresh data with Server Actions instead.
  function modalHref(state: StockDocumentModalState | null): string {
    const query = new URLSearchParams(window.location.search)
    query.delete("balances")
    return buildStockDocumentModalHref(screen, query.toString(), state)
  }

  function currentUrl(): string {
    return window.location.pathname + window.location.search
  }

  function openModal(state: StockDocumentModalState) {
    window.history.pushState(null, "", modalHref(state))
    pushedModalUrlsRef.current.push(currentUrl())
  }

  /** Shows another modal in the same history entry (e.g. 등록 → 보기). */
  function replaceModal(state: StockDocumentModalState) {
    const before = currentUrl()
    window.history.replaceState(null, "", modalHref(state))
    const pushed = pushedModalUrlsRef.current
    const index = pushed.lastIndexOf(before)
    if (index >= 0) pushed[index] = currentUrl()
  }

  function closeModal() {
    const pushed = pushedModalUrlsRef.current
    const index = pushed.lastIndexOf(currentUrl())
    if (index >= 0) {
      // We added this entry: going back removes it.
      pushed.splice(index)
      window.history.back()
    } else {
      // Opened from a link or a refresh: just drop the modal from the URL.
      window.history.replaceState(null, "", modalHref(null))
    }
  }

  function openNew() {
    if (modal) replaceModal({ mode: "new" })
    else openModal({ mode: "new" })
  }

  function saved(result: Extract<StockSaveResult, { ok: true }>) {
    const tooWarm = result.warnings.filter((warning) => warning.tooWarm)
    toast.success(result.message, {
      description:
        result.lots.length > 0
          ? `로트 ${formatNumber(result.lots.length, 0)}개를 만들었습니다.`
          : undefined,
    })
    if (result.warnings.length > 0) {
      toast.warning(
        `보관온도가 맞지 않는 줄이 ${formatNumber(result.warnings.length, 0)}개 있습니다.`,
        {
          description:
            tooWarm.length > 0
              ? `그중 ${formatNumber(tooWarm.length, 0)}개는 온도가 너무 높은 구역입니다. 재고처별 재고현황에서 확인해 주세요.`
              : "재고처별 재고현황의 ‘보관온도 불일치’에서 확인할 수 있습니다.",
        }
      )
    }
    replaceModal({ mode: "view", id: result.documentId })
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
        withStockDocumentKind(
          buildStockDocumentExportHref(screen, params),
          params.kind
        ),
        `${text.exportName}.csv`
      )
    } finally {
      setIsExporting(false)
    }
  }

  // ---- Keyboard -------------------------------------------------------------

  // F4 = 조회, F5 = 신규 (instead of reloading), Ctrl+F9 = 엑셀. Off while a
  // modal of the URL is open (it has its own keys); ignored while a small
  // dialog (e.g. the 상품 조건 picker) is open on the list.
  const listDialogOpen = () =>
    document.querySelector('[data-slot="erp-dialog"]') !== null
  useHotkeys(
    {
      F4: () => {
        if (!listDialogOpen()) searchFormRef.current?.requestSubmit()
      },
      F5: () => {
        if (!listDialogOpen()) openNew()
      },
      "Ctrl+F9": () => {
        if (!listDialogOpen()) void downloadExcel()
      },
    },
    { enabled: modal === null }
  )

  // ---- Screen ---------------------------------------------------------------

  const balanceIds =
    modal?.mode === "new"
      ? parseBalanceIdsParam(searchParams.get("balances"))
      : []

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
        <ActionButton
          type="submit"
          form={STOCK_DOCUMENT_SEARCH_FORM_ID}
          keyHint="F4"
        >
          조회
        </ActionButton>
        <ActionButton keyHint="F5" onClick={openNew}>
          <PlusIcon aria-hidden="true" />
          신규
        </ActionButton>
      </ActionBar>

      <StockDocumentSearchForm
        formRef={searchFormRef}
        shown={shown}
        kindOptions={STOCK_DOCUMENT_SCREENS[screen].types}
        partnerLabel={text.partnerLabel}
        filterLabels={data.filterLabels}
        onSearch={(values) => applyFilters(values)}
        onChange={applyFilters}
      />

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
        <PageSizeSelect
          value={shown.pageSize}
          onChange={(pageSize) => openList({ ...shown, pageSize, page: 1 })}
        />
      </div>

      <div
        aria-busy={isPending}
        data-pending={isPending}
        className="flex min-w-0 flex-col gap-2.5 transition-opacity data-[pending=true]:opacity-60"
      >
        <StockDocumentGrid
          rows={rows}
          partnerLabel={text.partnerLabel}
          amount={text.amount}
          activeId={activeId}
          onActiveIdChange={setActiveId}
          onOpen={(id) => openModal({ mode: "view", id })}
          empty={
            <div className="flex flex-col items-center gap-2">
              <p className="font-bold text-foreground">
                {hasFilters
                  ? "조건에 맞는 전표가 없습니다."
                  : `최근 30일 동안 등록한 ${text.noun} 전표가 없습니다.`}
              </p>
              <p>
                [신규 | F5]로 {text.noun} 전표를 등록하거나, 전표일자를 넓혀
                조회해 보세요.
              </p>
              <div className="flex gap-1.5">
                <ActionButton keyHint="F5" onClick={openNew}>
                  신규
                </ActionButton>
                {hasFilters && (
                  <Link
                    href={listHref({
                      ...defaults,
                      kind: null,
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
          hrefFor={(page) => listHref({ ...params, page })}
        />
      </div>

      <div className="text-xs text-muted-foreground">
        {notes ?? null}
        <p>
          전표번호를 누르거나 줄을 두 번 누르면(또는 줄을 고르고 Enter) 전표가
          열립니다. 저장한 전표는 고칠 수 없고, 잘못 넣었으면 전표를 열어 [전표
          취소]로 되돌린 뒤 다시 등록합니다.
        </p>
        <p>
          {futureDocDays > 0
            ? `전표 일자는 오늘 이후 ${futureDocDays}일까지 정할 수 있습니다(창고·로케이션 설정 → 재고 설정). 오늘 이후 날짜의 전표에는 ‘예정’이 붙고, 재고 수량에는 이미 반영됩니다.`
            : "전표 일자는 오늘까지 정할 수 있습니다. 내일 날짜(예: 새벽배송 출고)로 등록하려면 창고·로케이션 설정 → 재고 설정에서 ‘전표 일자 허용 범위’를 늘려 주세요."}
        </p>
      </div>

      {modal?.mode === "new" && (
        <NewDialogSlot
          render={renderNewDialog}
          onClose={closeModal}
          onSaved={saved}
          initialBalanceIds={balanceIds}
          expiryWarningDays={expiryWarningDays}
          futureDocDays={futureDocDays}
        />
      )}
      {modal?.mode === "view" && (
        <StockDocumentViewDialog
          key={`view-${modal.id}`}
          documentId={modal.id}
          expiryWarningDays={expiryWarningDays}
          onClose={closeModal}
          onOpenDocument={(id) => replaceModal({ mode: "view", id })}
          onNew={() => replaceModal({ mode: "new" })}
          newLabel={`신규 ${text.noun}`}
        />
      )}
    </div>
  )
}

/** Renders the screen's 등록 modal with the shell's props. */
function NewDialogSlot({
  render,
  ...props
}: StockNewDialogProps & {
  render: (props: StockNewDialogProps) => React.ReactNode
}) {
  return render(props)
}

/** "100개씩 보기" select next to the count. */
function PageSizeSelect({
  value,
  onChange,
}: {
  value: InventoryPageSize
  onChange: (pageSize: InventoryPageSize) => void
}) {
  const options = INVENTORY_PAGE_SIZES.map((size) => ({
    value: String(size),
    label: `${size}개씩 보기`,
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
        aria-label="한 페이지에 보일 전표 수"
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
