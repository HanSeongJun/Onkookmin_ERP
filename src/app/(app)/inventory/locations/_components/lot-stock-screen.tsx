"use client"

import { LoaderCircleIcon, XIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useOptimistic, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import {
  ActionBar,
  ActionButton,
  actionButtonClassName,
} from "@/components/erp/action-bar"
import { DataGridCount } from "@/components/erp/data-grid"
import { SearchField, SearchPanel } from "@/components/erp/search-panel"
import { Checkbox } from "@/components/ui/checkbox"
import { useColumnOrder } from "@/hooks/use-column-order"
import {
  buildStockDocumentNewHref,
  STOCK_LINK_BALANCES_MAX,
} from "@/components/inventory/document-screens"
import { downloadInventoryCsv } from "@/components/inventory/download-csv"
import { StockPagination } from "@/components/inventory/stock-pagination"
import { StockProductPickerDialog } from "@/components/inventory/stock-product-picker-dialog"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { formatNumber } from "@/lib/format"
import type {
  InventoryList,
  LotStockRow,
  StockWarehouseNode,
} from "@/lib/inventory/queries"
import {
  buildLotStockExportHref,
  buildLotStockHref,
  buildStockLedgerHref,
  defaultLotStockParams,
  INVENTORY_EXPORT_MAX_ROWS,
  LOT_EXPIRY_FILTERS,
  type LotExpiryFilter,
  type LotStockParams,
} from "@/lib/inventory/schema"
import { STORAGE_TYPES, type StorageType } from "@/lib/products/constants"

import { placeLabel, type PlaceIds } from "../../_components/place-filter"
import {
  ALL,
  FilterSelect,
  PageSizeSelect,
  SearchTextBox,
} from "../../_components/search-controls"
import {
  LOT_STOCK_GRID_COLUMN_IDS,
  LOT_STOCK_GRID_ORDER_KEY,
  LotStockGrid,
} from "./lot-stock-grid"
import { PlaceTree } from "./place-tree"

/** Id of the search <form>; the 조회 button submits it with form="…". */
const SEARCH_FORM_ID = "lot-stock-search"

/** The product of the 상품 condition, as the screen shows it. */
export type LotStockProductFilter = {
  id: string
  code: string
  name: string
}

/**
 * The 재고처별 재고현황 screen: the 창고 > 구역 > 위치 tree on the left, the
 * 조회 conditions, "N건 / 총 M건" and the (로트 × 위치) grid on the right.
 * Checked rows can be passed to [이동] (재고처간 이동등록) or [폐기] (폐기
 * 등록), which open their 등록 window with these lots filled in.
 *
 * Everything that should survive a refresh or the back button is in the
 * URL (?warehouse=…&zone=…&location=…&expiry=imminent&mismatch=1&page=2).
 */
export function LotStockScreen({
  params,
  list,
  places,
  product,
}: {
  /** Conditions of the loaded list (from the URL; page clamped). */
  params: LotStockParams
  list: InventoryList<LotStockRow>
  places: StockWarehouseNode[]
  /** The product of params.productId (null = all products). */
  product: LotStockProductFilter | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [shown, setShown] = useOptimistic(params)
  const searchFormRef = useRef<HTMLFormElement>(null)
  const columns = useColumnOrder(
    LOT_STOCK_GRID_ORDER_KEY,
    LOT_STOCK_GRID_COLUMN_IDS
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  // A product picked in the dialog, shown until the server's answer arrives.
  const [pickedProduct, setPickedProduct] =
    useState<LotStockProductFilter | null>(null)
  const shownProduct =
    shown.productId === null
      ? null
      : pickedProduct?.id === shown.productId
        ? pickedProduct
        : product

  // Checked rows (by balanceId). When a new list arrives, only the checks
  // of rows that are still shown are kept.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set())
  const [shownRows, setShownRows] = useState(list.rows)
  if (list.rows !== shownRows) {
    setShownRows(list.rows)
    setCheckedIds(
      (current) =>
        new Set(
          list.rows
            .filter((row) => current.has(row.balanceId))
            .map((row) => row.balanceId)
        )
    )
  }
  const checkedRows = list.rows.filter((row) => checkedIds.has(row.balanceId))

  // ---- 조회 -----------------------------------------------------------------

  function openList(next: LotStockParams) {
    const href = buildLotStockHref(next)
    startTransition(() => {
      setShown(next)
      if (href === buildLotStockHref(params)) {
        router.refresh()
      } else {
        router.push(href)
      }
    })
  }

  function typedSearch(): string {
    const form = searchFormRef.current
    const q = form ? new FormData(form).get("q") : null
    return typeof q === "string" ? q.trim() : shown.q
  }

  /** Applies changed conditions, starting again at page 1. */
  function applyFilters(changes: Partial<LotStockParams>) {
    openList({ ...shown, q: typedSearch(), ...changes, page: 1 })
  }

  const hasFilters =
    shown.warehouseId !== null ||
    shown.zoneId !== null ||
    shown.locationId !== null ||
    shown.productId !== null ||
    shown.q !== "" ||
    shown.expiry !== "all" ||
    shown.mismatch ||
    shown.storageType !== null

  function resetFilters() {
    openList({
      ...defaultLotStockParams,
      sort: shown.sort,
      pageSize: shown.pageSize,
    })
  }

  function selectPlace(place: PlaceIds) {
    applyFilters(place)
  }

  // ---- 거래수불 ---------------------------------------------------------------

  function ledgerHref(row: LotStockRow): string {
    return buildStockLedgerHref({ productId: row.productId })
  }

  function openLedger(row: LotStockRow) {
    router.push(ledgerHref(row))
  }

  // ---- 이동 / 폐기 ------------------------------------------------------------

  /** Opens the 이동 or 폐기 등록 window with the checked lots filled in. */
  function handOff(screen: "transfer" | "disposal") {
    const label = screen === "transfer" ? "이동" : "폐기"
    if (checkedRows.length === 0) {
      toast.info(`${label}할 재고를 목록에서 먼저 체크해 주세요.`)
      return
    }
    if (checkedRows.length > STOCK_LINK_BALANCES_MAX) {
      toast.error(
        `한 번에 ${formatNumber(STOCK_LINK_BALANCES_MAX, 0)}줄까지 ${label}할 수 있습니다. 체크를 줄여 주세요.`
      )
      return
    }
    // e.g. /inventory/transfers?modal=new&balances=<id>,<id>: the 등록
    // window reads the rows again (fresh quantities).
    router.push(
      buildStockDocumentNewHref(screen, {
        balanceIds: checkedRows.map((row) => row.balanceId),
      })
    )
  }

  // ---- 엑셀 -----------------------------------------------------------------

  async function downloadExcel() {
    if (isExporting) return
    if (list.total === 0) {
      toast.info("내려받을 재고가 없습니다. 조회 조건을 확인해 주세요.")
      return
    }
    if (
      list.total > INVENTORY_EXPORT_MAX_ROWS &&
      !window.confirm(
        `조회된 재고가 ${formatNumber(list.total, 0)}줄입니다. 엑셀에는 앞의 ${formatNumber(INVENTORY_EXPORT_MAX_ROWS, 0)}줄만 담깁니다. 계속할까요?`
      )
    ) {
      return
    }
    setIsExporting(true)
    try {
      await downloadInventoryCsv(
        buildLotStockExportHref(params),
        "재고처별재고현황.csv"
      )
    } finally {
      setIsExporting(false)
    }
  }

  // ---- Keyboard ---------------------------------------------------------------

  // F4 = 조회, Ctrl+F9 = 엑셀. Off while the 상품 picker is open.
  useHotkeys(
    {
      F4: () => searchFormRef.current?.requestSubmit(),
      "Ctrl+F9": () => void downloadExcel(),
    },
    { enabled: !pickerOpen }
  )

  // ---- Screen ---------------------------------------------------------------

  const place: PlaceIds = {
    warehouseId: shown.warehouseId,
    zoneId: shown.zoneId,
    locationId: shown.locationId,
  }

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
        <ActionButton variant="secondary" onClick={() => handOff("transfer")}>
          선택 이동
        </ActionButton>
        <ActionButton variant="secondary" onClick={() => handOff("disposal")}>
          선택 폐기
        </ActionButton>
        <Link
          href="/inventory"
          className={actionButtonClassName({ variant: "neutral" })}
        >
          상품별 재고현황
        </Link>
      </ActionBar>

      <div className="flex min-w-0 flex-col gap-2.5 lg:flex-row lg:items-start">
        <aside className="max-h-64 shrink-0 overflow-y-auto border border-input lg:sticky lg:top-2 lg:max-h-[calc(100svh-12rem)] lg:w-56 2xl:w-64">
          <h2 className="border-b border-input bg-label px-2.5 py-2 text-[13px] font-bold">
            창고 · 구역 · 위치
          </h2>
          <PlaceTree places={places} selected={place} onSelect={selectPlace} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <form
            ref={searchFormRef}
            id={SEARCH_FORM_ID}
            role="search"
            aria-label="재고처별 재고 조회 조건"
            onSubmit={(event) => {
              event.preventDefault()
              applyFilters({})
            }}
          >
            <SearchPanel className="xl:grid-cols-2 2xl:grid-cols-2">
              <SearchField label="검색어" htmlFor="lot-stock-q" span={2}>
                <SearchTextBox
                  key={shown.q}
                  id="lot-stock-q"
                  initialValue={shown.q}
                  placeholder="상품코드, 상품명, 바코드, 로트번호, 공급처 로트"
                />
              </SearchField>
              <SearchField label="기한 상태" htmlFor="lot-stock-expiry">
                <FilterSelect
                  id="lot-stock-expiry"
                  value={shown.expiry}
                  options={LOT_EXPIRY_FILTERS.map(({ value, label }) => ({
                    value,
                    label,
                  }))}
                  onChange={(value) =>
                    applyFilters({ expiry: value as LotExpiryFilter })
                  }
                />
              </SearchField>
              <SearchField label="보관온도" htmlFor="lot-stock-storage">
                <FilterSelect
                  id="lot-stock-storage"
                  value={shown.storageType ?? ALL}
                  options={[
                    { value: ALL, label: "전체" },
                    ...STORAGE_TYPES.map(({ value, label }) => ({
                      value,
                      label,
                    })),
                  ]}
                  onChange={(value) =>
                    applyFilters({
                      storageType:
                        value === ALL ? null : (value as StorageType),
                    })
                  }
                />
              </SearchField>
              <SearchField label="상품">
                {shownProduct ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <span className="truncate text-[13px]">
                      <span className="mr-1 text-muted-foreground tabular-nums">
                        {shownProduct.code}
                      </span>
                      {shownProduct.name}
                    </span>
                    <button
                      type="button"
                      aria-label="상품 조건 지우기"
                      onClick={() => applyFilters({ productId: null })}
                      className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <XIcon aria-hidden="true" className="size-4" />
                    </button>
                  </span>
                ) : (
                  <span className="text-[13px]">전체</span>
                )}
                <ActionButton
                  size="sm"
                  variant="secondary"
                  aria-haspopup="dialog"
                  onClick={() => setPickerOpen(true)}
                >
                  상품 선택
                </ActionButton>
              </SearchField>
              <SearchField label="보관온도 확인">
                <label className="flex min-h-7 cursor-pointer items-center gap-1.5 text-[13px]">
                  <Checkbox
                    checked={shown.mismatch}
                    onCheckedChange={(checked) =>
                      applyFilters({ mismatch: checked })
                    }
                  />
                  구역과 보관온도가 다른 재고만
                </label>
              </SearchField>
            </SearchPanel>
          </form>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              <DataGridCount shown={list.rows.length} total={list.total} />
              <span className="text-[13px] text-muted-foreground">
                위치: {placeLabel(places, place)}
              </span>
              {checkedRows.length > 0 && (
                <span className="text-[13px] text-muted-foreground">
                  (체크 {formatNumber(checkedRows.length, 0)}줄)
                </span>
              )}
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
                noun="줄"
                onChange={(pageSize) =>
                  openList({ ...shown, pageSize, page: 1 })
                }
              />
            </div>
          </div>

          <div
            aria-busy={isPending}
            data-pending={isPending}
            className="flex min-w-0 flex-col gap-2.5 transition-opacity data-[pending=true]:opacity-60"
          >
            <LotStockGrid
              rows={list.rows}
              checkedIds={checkedIds}
              onCheckedIdsChange={setCheckedIds}
              activeId={activeId}
              onActiveIdChange={setActiveId}
              ledgerHref={ledgerHref}
              onOpenLedger={openLedger}
              columnOrder={columns.order}
              onColumnOrderChange={columns.setOrder}
              sort={shown.sort}
              onSortChange={(sort) => applyFilters({ sort })}
              empty={
                <EmptyMessage
                  hasFilters={hasFilters}
                  hasPlaces={places.length > 0}
                  onReset={resetFilters}
                />
              }
            />
            <StockPagination
              page={params.page}
              pageCount={list.pageCount}
              hrefFor={(page) => buildLotStockHref({ ...params, page })}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            재고가 있는 로트·위치만 보입니다. 왼쪽에서 창고·구역·위치를 누르면
            그 아래 재고만 봅니다. 줄을 체크한 뒤 [선택 이동]·[선택 폐기]를
            누르면 등록 창이 그 로트로 열립니다. 상품명을 누르면(또는 줄을 두 번
            누르거나 Enter) 그 상품의 거래수불이 열립니다. D-day는 오늘
            기준(기한 임박 노랑, 경과 빨강)이고, 보관온도의 경고 표시는 구역과
            상품의 보관온도가 다르다는 뜻입니다(빨강: 구역이 더 따뜻함).
            단가·금액은 로트 입고단가(부가세 포함) 기준이며, * 표시는 입고단가가
            없어 상품의 기본 매입가로 계산한 값입니다.
          </p>
        </div>
      </div>

      {pickerOpen && (
        <StockProductPickerDialog
          includeBundles={false}
          includeInactiveWithStock
          multiple={false}
          title="기준상품 선택"
          onClose={() => setPickerOpen(false)}
          onPick={([picked]) => {
            if (!picked) return
            setPickedProduct({
              id: picked.id,
              code: picked.code,
              name: picked.name,
            })
            applyFilters({ productId: picked.id })
          }}
        />
      )}
    </div>
  )
}

/** The message inside the empty grid, with the next step to take. */
function EmptyMessage({
  hasFilters,
  hasPlaces,
  onReset,
}: {
  hasFilters: boolean
  hasPlaces: boolean
  onReset: () => void
}) {
  if (hasFilters) {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="font-bold text-foreground">
          조건에 맞는 재고가 없습니다.
        </p>
        <p>위치나 조회 조건을 바꾸거나, 조건을 초기화해 보세요.</p>
        <ActionButton variant="neutral" onClick={onReset}>
          조건 초기화
        </ActionButton>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="font-bold text-foreground">아직 재고가 없습니다.</p>
      <p>
        {hasPlaces
          ? "입고 등록이나 기초재고 일괄등록으로 재고를 넣어 주세요."
          : "창고·로케이션 설정에서 창고·구역·선반을 먼저 만들어 주세요."}
      </p>
      <Link
        href={hasPlaces ? "/inventory/receipts" : "/inventory/settings"}
        className={actionButtonClassName()}
      >
        {hasPlaces ? "입고 등록 열기" : "창고·로케이션 설정 열기"}
      </Link>
    </div>
  )
}
