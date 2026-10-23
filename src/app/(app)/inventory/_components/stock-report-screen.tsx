"use client"

import { LoaderCircleIcon } from "lucide-react"
import Link from "next/link"
import { unstable_rethrow, useRouter } from "next/navigation"
import { useOptimistic, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { CategoryPickerDialog } from "@/components/category-picker-dialog"
import {
  ActionBar,
  ActionButton,
  actionButtonClassName,
} from "@/components/erp/action-bar"
import { DataGridCount } from "@/components/erp/data-grid"
import { downloadInventoryCsv } from "@/components/inventory/download-csv"
import { StockPagination } from "@/components/inventory/stock-pagination"
import { useColumnOrder } from "@/hooks/use-column-order"
import { useHotkeys } from "@/hooks/use-hotkeys"
import type { CategoryNode } from "@/lib/categories/tree"
import { formatNumber } from "@/lib/format"
import type { StockReport, StockWarehouseNode } from "@/lib/inventory/queries"
import {
  buildStockLedgerHref,
  buildStockReportExportHref,
  buildStockReportHref,
  INVENTORY_EXPORT_MAX_ROWS,
  type StockReportParams,
} from "@/lib/inventory/schema"
import { loadProductCategories } from "@/lib/products/actions"

import { PageSizeSelect, readPeriod } from "./search-controls"
import {
  STOCK_REPORT_GRID_COLUMN_IDS,
  STOCK_REPORT_GRID_ORDER_KEY,
  StockReportGrid,
} from "./stock-report-grid"
import {
  STOCK_REPORT_SEARCH_FORM_ID,
  StockReportSearchForm,
} from "./stock-report-search-form"

/**
 * The 상품별 재고현황 screen below the page title, like a classic ERP
 * report: action buttons (조회 F4, 엑셀 Ctrl+F9), the 조회 conditions,
 * "N건 / 총 M건", the grid with its 총계 row, and the page links.
 *
 * Everything that should survive a refresh or the back button is in the
 * URL (?from=…&to=…&q=…&warehouse=…&sort=…&page=2). A product opens
 * 상품별 거래수불 with the same 조회기간 and 창고/구역.
 */
export function StockReportScreen({
  params,
  report,
  categories,
  places,
  today,
  warningDays,
}: {
  /** Conditions of the loaded report (from the URL; page clamped). */
  params: StockReportParams
  report: StockReport
  categories: CategoryNode[]
  places: StockWarehouseNode[]
  /** Today in Korea ("YYYY-MM-DD"). */
  today: string
  /** 기한 임박 기준일 (재고 설정). */
  warningDays: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // The conditions as the user just chose them. While the new report is
  // loading, `params` is still the old one; the inputs show `shown` right
  // away, and a second quick change builds on the first.
  const [shown, setShown] = useOptimistic(params)
  const searchFormRef = useRef<HTMLFormElement>(null)
  const columns = useColumnOrder(
    STOCK_REPORT_GRID_ORDER_KEY,
    STOCK_REPORT_GRID_COLUMN_IDS
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  // 상품분류 picker; the categories are read again when it opens (some may
  // have been added in the 상품분류설정 tab meanwhile).
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [isReloading, startReload] = useTransition()
  const [reloaded, setReloaded] = useState<{
    from: CategoryNode[]
    tree: CategoryNode[]
  } | null>(null)
  const shownCategories =
    reloaded && reloaded.from === categories ? reloaded.tree : categories

  const defaultFrom = `${today.slice(0, 8)}01`

  // ---- 조회 -----------------------------------------------------------------

  function openList(next: StockReportParams) {
    const href = buildStockReportHref(next)
    startTransition(() => {
      setShown(next)
      // 조회 with unchanged conditions reads the report again.
      if (href === buildStockReportHref(params)) {
        router.refresh()
      } else {
        router.push(href)
      }
    })
  }

  /**
   * The 검색어 and 조회기간 as typed in the form (applied together with any
   * other change), or null after telling the user what is wrong.
   */
  function typedConditions(): Pick<
    StockReportParams,
    "q" | "from" | "to"
  > | null {
    const form = searchFormRef.current
    const q = form ? new FormData(form).get("q") : null
    const period = readPeriod(form, { from: shown.from, to: shown.to })
    if ("message" in period) {
      toast.error(period.message)
      return null
    }
    return {
      q: typeof q === "string" ? q.trim() : shown.q,
      from: period.from,
      to: period.to,
    }
  }

  /** Applies changed conditions, starting again at page 1. */
  function applyFilters(changes: Partial<StockReportParams>) {
    const typed = typedConditions()
    if (!typed) return
    openList({ ...shown, ...typed, ...changes, page: 1 })
  }

  const hasFilters =
    shown.from !== defaultFrom ||
    shown.to !== today ||
    shown.q !== "" ||
    shown.categoryId !== null ||
    shown.uncategorized ||
    shown.taxType !== null ||
    shown.storageType !== null ||
    shown.productStatus !== "all" ||
    shown.warehouseId !== null ||
    shown.zoneId !== null ||
    shown.withStock

  function resetFilters() {
    openList({
      from: defaultFrom,
      to: today,
      q: "",
      categoryId: null,
      uncategorized: false,
      taxType: null,
      storageType: null,
      productStatus: "all",
      warehouseId: null,
      zoneId: null,
      withStock: false,
      sort: shown.sort,
      page: 1,
      pageSize: shown.pageSize,
    })
  }

  function reloadCategories() {
    const from = categories
    // In a transition, so a redirect from the server (e.g. to the login page
    // when the session has expired) is carried out by Next.js.
    startReload(async () => {
      try {
        const tree = await loadProductCategories()
        startReload(() => setReloaded({ from, tree }))
      } catch (error) {
        unstable_rethrow(error)
        console.error(error)
        toast.error(
          "분류를 다시 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
        )
      }
    })
  }

  // ---- 거래수불 ---------------------------------------------------------------

  /** 상품별 거래수불 of a product, same 조회기간 and 창고/구역. */
  function ledgerHref(productId: string): string {
    return buildStockLedgerHref({
      productId,
      from: params.from,
      to: params.to,
      warehouseId: params.warehouseId,
      zoneId: params.zoneId,
    })
  }

  function openLedger(productId: string) {
    router.push(ledgerHref(productId))
  }

  // ---- 엑셀 -----------------------------------------------------------------

  async function downloadExcel() {
    if (isExporting) return
    if (report.total === 0) {
      toast.info("내려받을 상품이 없습니다. 조회 조건을 확인해 주세요.")
      return
    }
    if (
      report.total > INVENTORY_EXPORT_MAX_ROWS &&
      !window.confirm(
        `조회된 상품이 ${formatNumber(report.total, 0)}개입니다. 엑셀에는 앞의 ${formatNumber(INVENTORY_EXPORT_MAX_ROWS, 0)}개만 담깁니다. 계속할까요?`
      )
    ) {
      return
    }
    setIsExporting(true)
    try {
      await downloadInventoryCsv(
        buildStockReportExportHref(params),
        "상품별재고현황.csv"
      )
    } finally {
      setIsExporting(false)
    }
  }

  // ---- Keyboard ---------------------------------------------------------------

  // F4 = 조회, Ctrl+F9 = 엑셀 (F5 stays the browser's reload: nothing is
  // registered on this screen). Off while the 상품분류 picker is open.
  useHotkeys(
    {
      F4: () => searchFormRef.current?.requestSubmit(),
      "Ctrl+F9": () => void downloadExcel(),
    },
    { enabled: !categoryPickerOpen }
  )

  // ---- Screen ---------------------------------------------------------------

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
          form={STOCK_REPORT_SEARCH_FORM_ID}
          keyHint="F4"
        >
          조회
        </ActionButton>
        <Link
          href="/inventory/locations"
          className={actionButtonClassName({ variant: "secondary" })}
        >
          재고처별 재고현황
        </Link>
        <Link
          href={
            activeId
              ? ledgerHref(activeId)
              : buildStockLedgerHref({ from: params.from, to: params.to })
          }
          className={actionButtonClassName({ variant: "secondary" })}
        >
          상품별 거래수불
        </Link>
      </ActionBar>

      <StockReportSearchForm
        formRef={searchFormRef}
        shown={shown}
        categories={shownCategories}
        places={places}
        today={today}
        onSubmit={() => applyFilters({})}
        onChange={applyFilters}
        onOpenCategoryPicker={() => {
          setCategoryPickerOpen(true)
          reloadCategories()
        }}
      />

      {places.length === 0 && (
        <p className="border border-input bg-label px-3 py-2 text-[13px]">
          아직 창고가 없습니다. 먼저{" "}
          <Link
            href="/inventory/settings"
            className="font-bold text-brand underline underline-offset-4"
          >
            창고·로케이션 설정
          </Link>
          에서 창고·구역·선반을 만든 뒤,{" "}
          <Link
            href="/imports/opening-stock"
            className="font-bold text-brand underline underline-offset-4"
          >
            기초재고 일괄등록
          </Link>
          이나 입고 등록으로 재고를 넣어 주세요.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <DataGridCount shown={report.rows.length} total={report.total} />
          <span className="text-[13px] text-muted-foreground">
            조회기간 {report.dateFrom} ~ {report.dateTo}
          </span>
          {isPending && (
            <LoaderCircleIcon
              className="size-4 animate-spin text-muted-foreground"
              aria-label="불러오는 중"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ActionButton
            variant="neutral"
            disabled={columns.isDefault}
            onClick={() => {
              columns.reset()
              toast.success("열 순서를 처음 상태로 되돌렸습니다.")
            }}
          >
            열 순서 초기화
          </ActionButton>
          <PageSizeSelect
            value={shown.pageSize}
            onChange={(pageSize) => openList({ ...shown, pageSize, page: 1 })}
          />
        </div>
      </div>

      <div
        aria-busy={isPending}
        data-pending={isPending}
        className="flex min-w-0 flex-col gap-2.5 transition-opacity data-[pending=true]:opacity-60"
      >
        <StockReportGrid
          rows={report.rows}
          totals={report.totals}
          today={today}
          warningDays={warningDays}
          activeId={activeId}
          onActiveIdChange={setActiveId}
          ledgerHref={ledgerHref}
          onOpenLedger={openLedger}
          columnOrder={columns.order}
          onColumnOrderChange={columns.setOrder}
          sort={shown.sort}
          onSortChange={(sort) => applyFilters({ sort })}
          empty={
            <EmptyMessage hasFilters={hasFilters} onReset={resetFilters} />
          }
        />
        <StockPagination
          page={params.page}
          pageCount={report.pageCount}
          hrefFor={(page) => buildStockReportHref({ ...params, page })}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        상품명을 누르거나 줄을 두 번 누르면(또는 Enter) 그 상품의 거래수불이
        열립니다. 이월재고는 조회 시작일 전날까지의 재고이고, 기말재고 = 이월 +
        입고 − 출고 ± 조정 − 폐기 ± 이동입니다(입고에는 기초재고, 취소 전표는
        원래 칸에서 빠짐). 이동은 창고·구역을 고른 때만 0이 아닙니다. 재고단가는
        남은 로트 입고단가(부가세 포함)의 가중평균이고, * 표시는 입고단가가 없는
        로트를 상품의 기본 매입가로 계산한 값, ※ 표시는 단가를 알 수 없어
        0원으로 계산한 재고가 있다는 뜻입니다. 기한 배지는 오늘 기준(기한 임박{" "}
        {formatNumber(warningDays, 0)}일 이내 노랑, 경과 빨강)입니다. 재고는
        기준상품에만 있으며, 묶음상품은 구성 기준상품으로 나뉘어 입출고됩니다.
      </p>

      <CategoryPickerDialog
        open={categoryPickerOpen}
        onOpenChange={setCategoryPickerOpen}
        categories={shownCategories}
        value={shown.categoryId}
        purpose="filter"
        title="상품분류 선택 (조회 조건)"
        onConfirm={(category) =>
          applyFilters({ categoryId: category.id, uncategorized: false })
        }
        onReload={reloadCategories}
        reloading={isReloading}
      />
    </div>
  )
}

/** The message inside the empty grid, with the next step to take. */
function EmptyMessage({
  hasFilters,
  onReset,
}: {
  hasFilters: boolean
  onReset: () => void
}) {
  if (hasFilters) {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="font-bold text-foreground">
          조건에 맞는 상품이 없습니다.
        </p>
        <p>검색어나 조회 조건을 바꾸거나, 조건을 초기화해 보세요.</p>
        <ActionButton variant="neutral" onClick={onReset}>
          조건 초기화
        </ActionButton>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="font-bold text-foreground">
        사용 중인 기준상품이 없습니다.
      </p>
      <p>
        재고는 기준상품에만 있습니다. 상품관리에서 기준상품을 먼저 등록해
        주세요.
      </p>
      <Link href="/products" className={actionButtonClassName()}>
        상품관리 열기
      </Link>
    </div>
  )
}
