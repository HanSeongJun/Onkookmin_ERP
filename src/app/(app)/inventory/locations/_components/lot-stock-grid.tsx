"use client"

import Link from "next/link"
import { Fragment, useId, useRef } from "react"

import { ExpiryBadge } from "@/components/inventory/expiry-badge"
import { StorageFitIcon } from "@/components/inventory/storage-fit"
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
import { EMPTY_VALUE, formatNumber } from "@/lib/format"
import { expiryKindLabel, formatStockQuantity } from "@/lib/inventory/constants"
import type { LotStockRow } from "@/lib/inventory/queries"
import {
  nextColumnSort,
  sortState,
  type LotStockColumnId,
  type LotStockSort,
} from "@/lib/inventory/schema"
import { storageTypeLabel } from "@/lib/products/constants"
import { cn } from "@/lib/utils"

import {
  COLUMN_DRAG_STYLES,
  columnCount,
  columnPart,
  MovableColumnHeader,
  MovableColumnHints,
  useMovableColumns,
  type CellMarks,
  type ColumnSpec,
} from "../../_components/movable-columns"

/**
 * The grid's columns in the default order (the user can move them; the
 * order is remembered in this browser). Groups move as one: "expiry" = 기한
 * over [종류 | 기한일 | D-day], "value" = 금액 over [부가세 포함 | 부가세
 * 별도]. "place" (위치) is one column: the 선반 code, then its 구역 and 창고
 * (the whole path in its tooltip), so 수량 and D-day fit on a laptop screen.
 */
export const LOT_STOCK_GRID_COLUMN_IDS = [
  "place",
  "product_code",
  "product_name",
  "lot_no",
  "expiry",
  "quantity",
  "unit_cost",
  "value",
  "storage",
  "received_date",
  "supplier",
] as const

export type LotStockGridColumnId = (typeof LOT_STOCK_GRID_COLUMN_IDS)[number]

/** localStorage key of the column order (raise the version if ids change). */
export const LOT_STOCK_GRID_ORDER_KEY = "inventory.lots.gridColumns.v1"

const COLUMNS: Record<LotStockGridColumnId, ColumnSpec<LotStockColumnId>> = {
  place: { title: "위치", className: "w-32", sort: "location" },
  product_code: { title: "상품코드", className: "w-24", sort: "product_code" },
  product_name: {
    title: "상품명",
    className: "min-w-36",
    sort: "product_name",
  },
  lot_no: { title: "로트번호", className: "w-28", sort: "lot_no" },
  expiry: {
    title: "기한",
    parts: [
      { title: "종류", className: "w-16", sort: "expiry_kind" },
      { title: "기한일", className: "w-24", sort: "expiry_date" },
      { title: "D-day", className: "w-14", sort: "days_left" },
    ],
  },
  quantity: { title: "수량", className: "w-24", sort: "quantity" },
  unit_cost: {
    title: "단가(부가세포함)",
    className: "w-28",
    sort: "unit_cost",
  },
  value: {
    title: "금액",
    parts: [
      { title: "부가세 포함", className: "w-28", sort: "value_incl" },
      { title: "부가세 별도", className: "w-28", sort: "value_excl" },
    ],
  },
  storage: { title: "보관온도", className: "w-20", sort: "storage" },
  received_date: { title: "입고일", className: "w-24", sort: "received_date" },
  supplier: { title: "매입처", className: "min-w-32", sort: "supplier" },
}

/** Checkbox + every column. */
const COLUMN_COUNT = 1 + columnCount(Object.values(COLUMNS))

/**
 * While 위치, 상품코드 and 상품명 are the first three columns (the
 * default), they stay pinned on the left (with the checkbox) when the grid
 * scrolls sideways, so 단가, 금액 and 보관온도 keep their row's place and
 * product in view. Offsets: checkbox 2.25rem, 위치 8rem, 상품코드 6rem (the
 * texts are cut to fit, so the columns keep these widths).
 */
const PINNED_COLUMNS: Record<
  LotStockGridColumnId,
  ColumnSpec<LotStockColumnId>
> = {
  ...COLUMNS,
  place: { ...COLUMNS.place, className: "w-32 sticky left-9 z-20" },
  product_code: {
    ...COLUMNS.product_code,
    className: "w-24 sticky left-41 z-20",
  },
  product_name: {
    ...COLUMNS.product_name,
    className: "min-w-36 sticky left-65 z-20",
  },
}
const PINNED_CELL_CLASSES: Partial<Record<LotStockGridColumnId, string>> = {
  place: "sticky left-9 z-[1] bg-inherit",
  product_code: "sticky left-41 z-[1] bg-inherit",
  product_name: "sticky left-65 z-[1] bg-inherit",
}

function placeAndProductPinned(
  order: readonly LotStockGridColumnId[]
): boolean {
  return (
    order[0] === "place" &&
    order[1] === "product_code" &&
    order[2] === "product_name"
  )
}

function columnTitle(id: LotStockGridColumnId): string {
  return COLUMNS[id].title
}

/**
 * 재고처별 재고현황 as a dense ERP grid: one row per (로트 × 위치) with stock.
 *
 * - The checkbox (or Space on the current row) checks a row for [이동] /
 *   [폐기]; the header checkbox checks the whole page.
 * - A click on the 상품명 (or Enter / double-click on the row) opens that
 *   product's 거래수불.
 * - D-day: 기한 임박 amber, 기한 경과 red. 보관온도: a warning icon when
 *   the 구역 has another 보관온도 (red: the 구역 is warmer than needed).
 * - 단가 / 금액: the lot's 입고단가 (부가세 포함); "*" = no 입고단가, the
 *   product's 기본 매입가 is used; "-" = no cost known.
 * - Column titles sort (▲ → ▼ → 위치순, on the server) and move by dragging.
 */
export function LotStockGrid({
  rows,
  checkedIds,
  onCheckedIdsChange,
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
  rows: LotStockRow[]
  /** Checked rows by balanceId. */
  checkedIds: Set<string>
  onCheckedIdsChange: (ids: Set<string>) => void
  activeId: string | null
  onActiveIdChange: (id: string) => void
  ledgerHref: (row: LotStockRow) => string
  onOpenLedger: (row: LotStockRow) => void
  columnOrder: LotStockGridColumnId[]
  onColumnOrderChange: (order: LotStockGridColumnId[]) => void
  sort: LotStockSort
  onSortChange: (sort: LotStockSort) => void
  empty: React.ReactNode
}) {
  const hintId = useId()
  const tableRef = useRef<HTMLTableElement>(null)
  const movable = useMovableColumns({
    tableRef,
    order: columnOrder,
    onOrderChange: onColumnOrderChange,
    titleOf: columnTitle,
    dragType: "application/x-lot-stock-column",
  })
  const current = sortState<LotStockColumnId>(sort)
  const pinned = placeAndProductPinned(columnOrder)
  const checkedCount = rows.filter((row) =>
    checkedIds.has(row.balanceId)
  ).length
  const allChecked = rows.length > 0 && checkedCount === rows.length
  const focusId =
    activeId && rows.some((row) => row.balanceId === activeId)
      ? activeId
      : (rows[0]?.balanceId ?? null)

  function toggle(id: string, checked: boolean) {
    const next = new Set(checkedIds)
    if (checked) {
      next.add(id)
    } else {
      next.delete(id)
    }
    onCheckedIdsChange(next)
  }

  function handleRowKeyDown(
    event: React.KeyboardEvent<HTMLTableRowElement>,
    row: LotStockRow
  ) {
    // Only keys pressed on the row itself (not in its checkbox or link).
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter") {
      event.preventDefault()
      onOpenLedger(row)
    } else if (event.key === " ") {
      event.preventDefault()
      toggle(row.balanceId, !checkedIds.has(row.balanceId))
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
        aria-label="재고처별 재고 목록"
        containerClassName="max-h-[max(22rem,calc(100svh-24rem))]"
        // About the sum of the column widths: no spare width is handed to
        // the 상품명 column, so 수량 and D-day fit on a 1366px screen.
        className={cn(rows.length > 0 && "min-w-[92rem]", COLUMN_DRAG_STYLES)}
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
              onSortChange(nextColumnSort(sort, column, "location"))
            }
            leading={
              <DataGridHead
                rowSpan={2}
                className={cn("w-9", pinned && "left-0 z-20")}
              >
                <DataGridCheckbox
                  inHeader
                  aria-label="이 페이지의 재고 모두 선택"
                  checked={allChecked}
                  indeterminate={checkedCount > 0 && !allChecked}
                  disabled={rows.length === 0}
                  onCheckedChange={(checked) =>
                    onCheckedIdsChange(
                      checked
                        ? new Set(rows.map((row) => row.balanceId))
                        : new Set()
                    )
                  }
                />
              </DataGridHead>
            }
          />
        </DataGridHeader>
        <DataGridBody>
          {rows.length === 0 && (
            <DataGridEmpty colSpan={COLUMN_COUNT}>{empty}</DataGridEmpty>
          )}
          {rows.map((row) => {
            const isChecked = checkedIds.has(row.balanceId)
            return (
              <DataGridRow
                key={row.balanceId}
                selected={isChecked}
                tabIndex={row.balanceId === focusId ? 0 : -1}
                data-active={row.balanceId === activeId ? "true" : undefined}
                onClick={() => onActiveIdChange(row.balanceId)}
                onFocus={(event) => {
                  if (event.target === event.currentTarget) {
                    onActiveIdChange(row.balanceId)
                  }
                }}
                onDoubleClick={(event) => {
                  const target = event.target as HTMLElement
                  if (target.closest('[role="checkbox"], button, a')) return
                  onOpenLedger(row)
                }}
                onKeyDown={(event) => handleRowKeyDown(event, row)}
                className="cursor-default outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[active=true]:outline-2 data-[active=true]:-outline-offset-2 data-[active=true]:outline-brand"
              >
                <DataGridCell
                  align="center"
                  className={cn(
                    "px-0",
                    pinned && "sticky left-0 z-[1] bg-inherit"
                  )}
                >
                  {/* A fixed-width box: the pinned columns' offsets count on it. */}
                  <span className="flex w-9 justify-center">
                    <DataGridCheckbox
                      aria-label={`${row.productName} ${row.lotNo} 선택`}
                      checked={isChecked}
                      onCheckedChange={(checked) =>
                        toggle(row.balanceId, checked)
                      }
                    />
                  </span>
                </DataGridCell>
                {columnOrder.map((id) => (
                  <Fragment key={id}>
                    <LotCells
                      row={row}
                      column={id}
                      ledgerHref={ledgerHref}
                      pinnedClassName={
                        pinned ? PINNED_CELL_CLASSES[id] : undefined
                      }
                      marks={(index, length) =>
                        movable.marks(id, columnPart(index, length))
                      }
                    />
                  </Fragment>
                ))}
              </DataGridRow>
            )
          })}
        </DataGridBody>
      </DataGrid>
      <MovableColumnHints hintId={hintId} announcement={movable.announcement} />
    </>
  )
}

/** "(사용중지)" after a place or product that is switched off. */
function InactiveMark({ show }: { show: boolean }) {
  if (!show) return null
  return <span className="ml-1 text-xs text-muted-foreground">(사용중지)</span>
}

/**
 * The cell(s) of one column for a row. `marks(index, length)`: the drag
 * marks of the index-th of the column's `length` cells.
 */
function LotCells({
  row,
  column,
  ledgerHref,
  pinnedClassName,
  marks,
}: {
  row: LotStockRow
  column: LotStockGridColumnId
  ledgerHref: (row: LotStockRow) => string
  /** Classes of a pinned column (see PINNED_COLUMNS). */
  pinnedClassName?: string
  marks: (index: number, length: number) => CellMarks
}) {
  switch (column) {
    case "place": {
      const inactive =
        !row.warehouseIsActive || !row.zoneIsActive || !row.locationIsActive
      return (
        <DataGridCell
          className={pinnedClassName}
          title={[
            `${row.warehouseName} > ${row.zoneName} (${storageTypeLabel(row.zoneStorageType)} 구역) > ${row.locationCode}`,
            row.locationName,
            inactive ? "사용중지된 곳이 있습니다" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          {...marks(0, 1)}
        >
          {/* 선반 first; 구역 · 창고 after it in small grey text. Cut to the
              column's width so a pinned column never covers it. */}
          <span className="block w-28 truncate">
            <span className="font-bold tabular-nums">{row.locationCode}</span>
            <span className="ml-1 text-xs text-muted-foreground">
              {row.zoneName} · {row.warehouseName}
            </span>
            <InactiveMark show={inactive} />
          </span>
        </DataGridCell>
      )
    }
    case "product_code":
      return (
        <DataGridCell
          align="center"
          className={cn("tabular-nums", pinnedClassName)}
          title={row.productCode}
          {...marks(0, 1)}
        >
          <span className="block w-20 truncate">{row.productCode}</span>
        </DataGridCell>
      )
    case "product_name":
      return (
        <DataGridCell
          className={pinnedClassName}
          title={[row.productName, row.productSpec].filter(Boolean).join(" · ")}
          {...marks(0, 1)}
        >
          {/* Cut to 8rem (the whole name is the tooltip): a long name never
              widens the column and pushes 수량 off the screen. */}
          <span className="block max-w-32 truncate">
            <Link
              href={ledgerHref(row)}
              prefetch={false}
              className="rounded-sm underline-offset-4 outline-none hover:text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {row.productName}
            </Link>
            {row.productSpec && (
              <span className="ml-1 text-xs text-muted-foreground">
                {row.productSpec}
              </span>
            )}
            {!row.productIsActive && (
              <span className="ml-1.5 rounded-sm bg-label px-1 text-xs font-bold text-muted-foreground">
                사용중지
              </span>
            )}
          </span>
        </DataGridCell>
      )
    case "lot_no":
      return (
        <DataGridCell
          className="tabular-nums"
          title={[
            `로트 ${row.lotNo}`,
            row.supplierLotNo ? `공급처 로트 ${row.supplierLotNo}` : null,
            row.manufacturedDate ? `제조일자 ${row.manufacturedDate}` : null,
            row.lotOrigin ? `원산지 ${row.lotOrigin}` : null,
            row.lotMemo ? `메모 ${row.lotMemo}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          {...marks(0, 1)}
        >
          <span className="block max-w-24 truncate">{row.lotNo}</span>
        </DataGridCell>
      )
    case "expiry":
      return (
        <>
          <DataGridCell align="center" {...marks(0, 3)}>
            {expiryKindLabel(row.expiryKind)}
          </DataGridCell>
          <DataGridCell
            align="center"
            className="tabular-nums"
            {...marks(1, 3)}
          >
            {row.expiryDate ?? EMPTY_VALUE}
          </DataGridCell>
          <DataGridCell align="center" {...marks(2, 3)}>
            <ExpiryBadge daysLeft={row.daysLeft} status={row.expiryStatus} />
          </DataGridCell>
        </>
      )
    case "quantity":
      return (
        <DataGridCell numeric className="font-bold" {...marks(0, 1)}>
          {formatStockQuantity(row.quantity, row.productUnit)}
        </DataGridCell>
      )
    case "unit_cost":
      return (
        <MoneyCell
          value={row.effectiveUnitCostInclVat}
          estimated={row.costEstimated}
          {...marks(0, 1)}
        />
      )
    case "value":
      return (
        <>
          <MoneyCell
            value={row.valueInclVat}
            estimated={row.costEstimated}
            {...marks(0, 2)}
          />
          <MoneyCell
            value={row.valueExclVat}
            estimated={row.costEstimated}
            {...marks(1, 2)}
          />
        </>
      )
    case "storage":
      return (
        <DataGridCell
          align="center"
          className={cn(
            row.storageTooWarm && "bg-destructive/10 font-bold text-destructive"
          )}
          {...marks(0, 1)}
        >
          <span className="inline-flex items-center gap-1">
            {storageTypeLabel(row.productStorageType)}
            <StorageFitIcon
              productStorage={row.productStorageType}
              zoneStorage={row.zoneStorageType}
            />
          </span>
        </DataGridCell>
      )
    case "received_date":
      return (
        <DataGridCell align="center" className="tabular-nums" {...marks(0, 1)}>
          {row.receivedDate}
        </DataGridCell>
      )
    case "supplier":
      return (
        <DataGridCell
          className="max-w-48 truncate"
          title={
            row.supplierName
              ? `${row.supplierCode ?? ""} ${row.supplierName}`.trim()
              : undefined
          }
          {...marks(0, 1)}
        >
          {row.supplierName ?? EMPTY_VALUE}
        </DataGridCell>
      )
  }
}

/** Won, "-" when unknown; "*" when the 기본 매입가 stands in for the 입고단가. */
function MoneyCell({
  value,
  estimated,
  ...marks
}: { value: number | null; estimated: boolean } & CellMarks) {
  const note = estimated
    ? "이 로트에 입고단가가 없어 상품의 기본 매입가로 계산했습니다."
    : undefined
  return (
    <DataGridCell numeric title={note} {...marks}>
      {value === null ? EMPTY_VALUE : formatNumber(value, 0)}
      {value !== null && estimated && (
        <sup aria-hidden="true" className="ml-0.5 text-muted-foreground">
          *
        </sup>
      )}
      {note && <span className="sr-only"> ({note})</span>}
    </DataGridCell>
  )
}
