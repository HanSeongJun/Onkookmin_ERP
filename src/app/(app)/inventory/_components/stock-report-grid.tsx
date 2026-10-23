"use client"

import Link from "next/link"
import { Fragment, useId, useRef } from "react"

import { ExpiryBadge } from "@/components/inventory/expiry-badge"
import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridEmpty,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { daysUntil, EMPTY_VALUE, formatNumber } from "@/lib/format"
import { expiryKindLabel } from "@/lib/inventory/constants"
import type { StockReportRow, StockReportTotals } from "@/lib/inventory/queries"
import {
  nextColumnSort,
  sortState,
  type StockReportColumnId,
  type StockReportSort,
} from "@/lib/inventory/schema"
import { storageTypeLabel } from "@/lib/products/constants"
import { cn } from "@/lib/utils"

import {
  COLUMN_DRAG_STYLES,
  columnCount,
  MovableColumnHeader,
  MovableColumnHints,
  useMovableColumns,
  type CellMarks,
  type ColumnSpec,
} from "./movable-columns"

/**
 * The grid's columns in the default order (the user can move them; the
 * order is remembered in this browser). "value" is the group 재고금액 over
 * [부가세 포함 | 부가세 별도]; it moves as one.
 */
export const STOCK_REPORT_GRID_COLUMN_IDS = [
  "code",
  "name",
  "spec",
  "unit",
  "opening",
  "receipt",
  "issue",
  "adjust",
  "disposal",
  "transfer",
  "closing",
  "unit_cost",
  "value",
  "expiry",
  "storage",
] as const

export type StockReportGridColumnId =
  (typeof STOCK_REPORT_GRID_COLUMN_IDS)[number]

/** localStorage key of the column order (raise the version if ids change). */
export const STOCK_REPORT_GRID_ORDER_KEY = "inventory.report.gridColumns.v1"

const COLUMNS: Record<
  StockReportGridColumnId,
  ColumnSpec<StockReportColumnId>
> = {
  code: { title: "상품코드", className: "w-28", sort: "code" },
  name: { title: "상품명", className: "min-w-48", sort: "name" },
  spec: { title: "규격", className: "w-24", sort: "spec" },
  unit: { title: "단위", className: "w-14", sort: "unit" },
  opening: { title: "이월재고", className: "w-[4.5rem]", sort: "opening" },
  receipt: { title: "입고", className: "w-[4.5rem]", sort: "receipt" },
  issue: { title: "출고", className: "w-[4.5rem]", sort: "issue" },
  adjust: { title: "조정", className: "w-[4.5rem]", sort: "adjust" },
  disposal: { title: "폐기", className: "w-[4.5rem]", sort: "disposal" },
  transfer: { title: "이동", className: "w-[4.5rem]", sort: "transfer" },
  closing: { title: "기말재고", className: "w-20", sort: "closing" },
  unit_cost: {
    title: "재고단가(부가세포함)",
    className: "w-28",
    sort: "unit_cost",
  },
  value: {
    title: "재고금액",
    parts: [
      { title: "부가세 포함", className: "w-24", sort: "value_incl" },
      { title: "부가세 별도", className: "w-24", sort: "value_excl" },
    ],
  },
  expiry: { title: "가장 빠른 기한", className: "w-36", sort: "expiry" },
  storage: { title: "보관온도", className: "w-16", sort: "storage" },
}

/**
 * While 상품코드 and 상품명 are the first two columns (the default), they
 * stay pinned on the left when the grid scrolls sideways, so the numbers
 * far to the right (재고금액, 가장 빠른 기한) keep their product in view.
 * 상품코드 is 7rem wide (its text is cut to fit), so 상품명 starts at left-28.
 */
const PINNED_COLUMNS: Record<
  StockReportGridColumnId,
  ColumnSpec<StockReportColumnId>
> = {
  ...COLUMNS,
  code: { ...COLUMNS.code, className: "w-28 sticky left-0 z-20" },
  name: { ...COLUMNS.name, className: "min-w-48 sticky left-28 z-20" },
}
const PINNED_CELL_CLASSES: Partial<Record<StockReportGridColumnId, string>> = {
  code: "sticky left-0 z-[1] bg-inherit",
  name: "sticky left-28 z-[1] bg-inherit",
}
const PINNED_TOTAL_CLASSES: Partial<Record<StockReportGridColumnId, string>> = {
  code: "left-0 z-[6]",
  name: "left-28 z-[6]",
}

/** Whether 상품코드 and 상품명 are pinned (see PINNED_COLUMNS). */
function codeAndNamePinned(order: readonly StockReportGridColumnId[]): boolean {
  return order[0] === "code" && order[1] === "name"
}

const COLUMN_COUNT = columnCount(Object.values(COLUMNS))

/** Title of a column for messages ("재고금액 열을 … 옮겼습니다"). */
function columnTitle(id: StockReportGridColumnId): string {
  return COLUMNS[id].title
}

/**
 * 상품별 재고현황 as a dense ERP grid, one row per 기준상품, with a 총계 row
 * at the bottom (all matching products, not only this page).
 *
 * - A click on a row makes it the current row; double-click, Enter, or a
 *   click on the 상품명 opens 상품별 거래수불 for that product (same
 *   조회기간 and 창고/구역).
 * - Column titles: a click sorts (▲ → ▼ → 상품코드순; on the server, across
 *   all pages); dragging a title (or Alt+← / Alt+→) moves the column.
 * - 조정 and 이동 are net amounts (+ in, − out). 재고단가 = the weighted
 *   average 입고단가 of the stock left at the end; "*" marks values that
 *   use the product's 기본 매입가 for lots without 입고단가, "※" stock
 *   without any cost (counted as 0).
 * - 가장 빠른 기한: the earliest 기한 of the stock left at the end, with a
 *   D-day badge (기한 임박 amber, 기한 경과 red) counted from today.
 */
export function StockReportGrid({
  rows,
  totals,
  today,
  warningDays,
  activeId,
  onActiveIdChange,
  ledgerHref,
  onOpenLedger,
  columnOrder,
  onColumnOrderChange,
  sort,
  onSortChange,
  empty,
}: {
  rows: StockReportRow[]
  /** 총계 of all matching rows (every page). */
  totals: StockReportTotals
  /** Today in Korea, for the D-day badges. */
  today: string
  /** 기한 임박 기준일 (재고 설정). */
  warningDays: number
  activeId: string | null
  onActiveIdChange: (id: string) => void
  /** URL of 상품별 거래수불 for a product. */
  ledgerHref: (productId: string) => string
  onOpenLedger: (productId: string) => void
  columnOrder: StockReportGridColumnId[]
  onColumnOrderChange: (order: StockReportGridColumnId[]) => void
  sort: StockReportSort
  onSortChange: (sort: StockReportSort) => void
  empty: React.ReactNode
}) {
  const hintId = useId()
  const tableRef = useRef<HTMLTableElement>(null)
  const movable = useMovableColumns({
    tableRef,
    order: columnOrder,
    onOrderChange: onColumnOrderChange,
    titleOf: columnTitle,
    dragType: "application/x-stock-report-column",
  })
  const current = sortState<StockReportColumnId>(sort)
  const pinned = codeAndNamePinned(columnOrder)
  // The row reached with Tab: the current row, or the first one.
  const focusId =
    activeId && rows.some((row) => row.productId === activeId)
      ? activeId
      : (rows[0]?.productId ?? null)

  function handleRowKeyDown(
    event: React.KeyboardEvent<HTMLTableRowElement>,
    row: StockReportRow
  ) {
    // Only keys pressed on the row itself (not in its link).
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter") {
      event.preventDefault()
      onOpenLedger(row.productId)
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const sibling =
        event.key === "ArrowDown"
          ? event.currentTarget.nextElementSibling
          : event.currentTarget.previousElementSibling
      if (sibling instanceof HTMLElement) sibling.focus()
    }
  }

  return (
    <>
      <DataGrid
        ref={tableRef}
        aria-label="상품별 재고현황"
        // The grid fills the rest of the screen, so the page itself doesn't
        // scroll (the search form has 4 rows on laptop screens).
        containerClassName="max-h-[max(22rem,calc(100svh-29rem))]"
        // Wide enough for every column; an empty grid fits the box so its
        // message stays in view.
        className={cn(rows.length > 0 && "min-w-[93rem]", COLUMN_DRAG_STYLES)}
        onDragOver={movable.onDragOver}
        onDragLeave={movable.onDragLeave}
        onDrop={movable.onDrop}
      >
        <DataGridHeader>
          <MovableColumnHeader
            order={columnOrder}
            columns={pinned ? PINNED_COLUMNS : COLUMNS}
            movable={movable}
            hintId={hintId}
            directionOf={(column) =>
              current.column === column ? current.direction : null
            }
            onSort={(column) =>
              onSortChange(nextColumnSort(sort, column, "code"))
            }
          />
        </DataGridHeader>
        <DataGridBody>
          {rows.length === 0 && (
            <DataGridEmpty colSpan={COLUMN_COUNT}>{empty}</DataGridEmpty>
          )}
          {rows.map((row) => (
            <DataGridRow
              key={row.productId}
              tabIndex={row.productId === focusId ? 0 : -1}
              data-active={row.productId === activeId ? "true" : undefined}
              onClick={() => onActiveIdChange(row.productId)}
              onFocus={(event) => {
                if (event.target === event.currentTarget) {
                  onActiveIdChange(row.productId)
                }
              }}
              onDoubleClick={(event) => {
                const target = event.target as HTMLElement
                if (target.closest("a, button")) return
                onOpenLedger(row.productId)
              }}
              onKeyDown={(event) => handleRowKeyDown(event, row)}
              className={cn(
                "cursor-default outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[active=true]:outline-2 data-[active=true]:-outline-offset-2 data-[active=true]:outline-brand",
                !row.isActive && "text-muted-foreground"
              )}
            >
              {columnOrder.map((id) => (
                <Fragment key={id}>
                  {id === "value" ? (
                    <>
                      <MoneyCell
                        value={row.closingValueInclVat}
                        estimated={row.costEstimated}
                        missing={row.costMissing}
                        {...movable.marks(id, "first")}
                      />
                      <MoneyCell
                        value={row.closingValueExclVat}
                        estimated={row.costEstimated}
                        missing={row.costMissing}
                        {...movable.marks(id, "last")}
                      />
                    </>
                  ) : (
                    <ReportCell
                      row={row}
                      column={id}
                      today={today}
                      warningDays={warningDays}
                      ledgerHref={ledgerHref}
                      pinnedClassName={
                        pinned ? PINNED_CELL_CLASSES[id] : undefined
                      }
                      {...movable.marks(id)}
                    />
                  )}
                </Fragment>
              ))}
            </DataGridRow>
          ))}
        </DataGridBody>
        {rows.length > 0 && (
          <tfoot>
            <tr>
              {columnOrder.map((id) => (
                <Fragment key={id}>
                  <TotalCells
                    column={id}
                    totals={totals}
                    pinnedClassName={
                      pinned ? PINNED_TOTAL_CLASSES[id] : undefined
                    }
                    marks={(part) => movable.marks(id, part)}
                  />
                </Fragment>
              ))}
            </tr>
          </tfoot>
        )}
      </DataGrid>
      <MovableColumnHints hintId={hintId} announcement={movable.announcement} />
    </>
  )
}

/** A quantity: up to 3 decimals; 0 grey; `signed` adds "+" (조정, 이동). */
function QuantityCell({
  value,
  signed = false,
  bold = false,
  ...marks
}: { value: number; signed?: boolean; bold?: boolean } & CellMarks) {
  const text = formatNumber(value, 3)
  return (
    <DataGridCell
      numeric
      className={cn(
        value === 0 && "text-muted-foreground",
        bold && value !== 0 && "font-bold"
      )}
      {...marks}
    >
      {signed && value > 0 ? `+${text}` : text}
    </DataGridCell>
  )
}

/**
 * Money in won ("-" when unknown). "*": part of it uses the 기본 매입가
 * (lots without 입고단가); "※": some stock has no cost at all (counted 0).
 */
function MoneyCell({
  value,
  estimated,
  missing,
  bold = false,
  className,
  ...marks
}: {
  value: number | null
  estimated: boolean
  missing: boolean
  bold?: boolean
  className?: string
} & CellMarks) {
  const notes = [
    estimated
      ? "일부 로트에 입고단가가 없어 상품의 기본 매입가로 계산했습니다."
      : null,
    missing
      ? "입고단가와 기본 매입가가 모두 없는 재고가 있어 0원으로 계산했습니다."
      : null,
  ].filter((note): note is string => note !== null)
  return (
    <DataGridCell
      numeric
      title={notes.length > 0 ? notes.join(" ") : undefined}
      className={cn(bold && "font-bold", className)}
      {...marks}
    >
      {value === null ? EMPTY_VALUE : formatNumber(value, 0)}
      {value !== null && (estimated || missing) && (
        <sup aria-hidden="true" className="ml-0.5 text-muted-foreground">
          {missing ? "※" : "*"}
        </sup>
      )}
      {notes.length > 0 && (
        <span className="sr-only"> ({notes.join(" ")})</span>
      )}
    </DataGridCell>
  )
}

/** One body cell of a single column (data-* attributes: drag marks). */
function ReportCell({
  row,
  column,
  today,
  warningDays,
  ledgerHref,
  pinnedClassName,
  ...marks
}: {
  row: StockReportRow
  column: Exclude<StockReportGridColumnId, "value">
  today: string
  warningDays: number
  ledgerHref: (productId: string) => string
  /** Classes of a pinned column (see PINNED_COLUMNS). */
  pinnedClassName?: string
} & CellMarks) {
  switch (column) {
    case "code":
      return (
        <DataGridCell
          align="center"
          className={cn("tabular-nums", pinnedClassName)}
          title={row.code}
          {...marks}
        >
          {/* Cut to the column's 7rem, so the pinned 상품명 never covers it. */}
          <span className="block w-24 truncate">{row.code}</span>
        </DataGridCell>
      )
    case "name":
      return (
        <DataGridCell
          className={cn("max-w-72 truncate", pinnedClassName)}
          title={`${row.name} · ${row.categoryPath}`}
          {...marks}
        >
          <Link
            href={ledgerHref(row.productId)}
            prefetch={false}
            className="rounded-sm underline-offset-4 outline-none hover:text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {row.name}
          </Link>
          {!row.isActive && (
            <span className="ml-1.5 rounded-sm bg-label px-1 text-xs font-bold text-muted-foreground">
              사용중지
            </span>
          )}
        </DataGridCell>
      )
    case "spec":
      return (
        <DataGridCell
          className="max-w-40 truncate"
          title={row.spec ?? undefined}
          {...marks}
        >
          {row.spec ?? EMPTY_VALUE}
        </DataGridCell>
      )
    case "unit":
      return (
        <DataGridCell align="center" {...marks}>
          {row.unit}
        </DataGridCell>
      )
    case "opening":
      return <QuantityCell value={row.openingQty} {...marks} />
    case "receipt":
      return <QuantityCell value={row.inboundQty} {...marks} />
    case "issue":
      return <QuantityCell value={row.issueQty} {...marks} />
    case "adjust":
      return <QuantityCell value={row.adjustNetQty} signed {...marks} />
    case "disposal":
      return <QuantityCell value={row.disposalQty} {...marks} />
    case "transfer":
      return <QuantityCell value={row.transferNetQty} signed {...marks} />
    case "closing":
      return <QuantityCell value={row.closingQty} bold {...marks} />
    case "unit_cost":
      return (
        <MoneyCell
          value={row.closingUnitCostInclVat}
          estimated={row.costEstimated}
          missing={false}
          {...marks}
        />
      )
    case "expiry": {
      if (!row.nearestExpiryDate) {
        return (
          <DataGridCell
            align="center"
            className="text-muted-foreground"
            {...marks}
          >
            {EMPTY_VALUE}
          </DataGridCell>
        )
      }
      const daysLeft = daysUntil(row.nearestExpiryDate, today)
      return (
        <DataGridCell
          title={
            row.nearestExpiryKind
              ? `${expiryKindLabel(row.nearestExpiryKind)} ${row.nearestExpiryDate}`
              : row.nearestExpiryDate
          }
          {...marks}
        >
          <span className="flex items-center justify-between gap-2">
            <span className="tabular-nums">{row.nearestExpiryDate}</span>
            <ExpiryBadge daysLeft={daysLeft} warningDays={warningDays} />
          </span>
        </DataGridCell>
      )
    }
    case "storage":
      return (
        <DataGridCell align="center" {...marks}>
          {storageTypeLabel(row.storageType)}
        </DataGridCell>
      )
  }
}

/** The 총계 row's cell(s) of one column (sticky at the bottom of the grid). */
function TotalCells({
  column,
  totals,
  pinnedClassName,
  marks,
}: {
  column: StockReportGridColumnId
  totals: StockReportTotals
  /** Classes of a pinned column (see PINNED_COLUMNS). */
  pinnedClassName?: string
  marks: (part?: "first" | "last") => CellMarks
}) {
  const className = cn(
    "sticky bottom-0 z-[5] border-t-2 border-t-foreground/70 bg-label font-bold",
    pinnedClassName
  )
  const quantity = (value: number, signed = false) => {
    const text = formatNumber(value, 3)
    return (
      <DataGridCell numeric className={className} {...marks()}>
        {signed && value > 0 ? `+${text}` : text}
      </DataGridCell>
    )
  }
  switch (column) {
    case "code":
      return (
        <DataGridCell align="center" className={className} {...marks()}>
          총계
        </DataGridCell>
      )
    case "name":
      return (
        <DataGridCell className={className} {...marks()}>
          상품 {formatNumber(totals.productCount, 0)}개
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            (수량은 단위 구분 없이 더한 값)
          </span>
        </DataGridCell>
      )
    case "opening":
      return quantity(totals.openingQty)
    case "receipt":
      return quantity(totals.inboundQty)
    case "issue":
      return quantity(totals.issueQty)
    case "adjust":
      return quantity(totals.adjustNetQty, true)
    case "disposal":
      return quantity(totals.disposalQty)
    case "transfer":
      return quantity(totals.transferNetQty, true)
    case "closing":
      return quantity(totals.closingQty)
    case "value":
      return (
        <>
          <MoneyCell
            value={totals.closingValueInclVat}
            estimated={totals.costEstimated}
            missing={totals.costMissing}
            bold
            className={className}
            {...marks("first")}
          />
          <MoneyCell
            value={totals.closingValueExclVat}
            estimated={totals.costEstimated}
            missing={totals.costMissing}
            bold
            className={className}
            {...marks("last")}
          />
        </>
      )
    default:
      return <DataGridCell className={className} {...marks()} />
  }
}
