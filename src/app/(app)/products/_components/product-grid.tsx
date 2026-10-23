"use client"

import { Fragment, useId, useLayoutEffect, useRef, useState } from "react"

import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridCheckbox,
  DataGridEmpty,
  DataGridHead,
  DataGridHeadGroup,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { moveColumn } from "@/hooks/use-column-order"
import { EMPTY_VALUE, formatNumber } from "@/lib/format"
import { formatComposition } from "@/lib/products/bundle"
import {
  productTypeLabel,
  productTypeShortLabel,
  storageTypeLabel,
  taxTypeLabel,
  type ProductType,
} from "@/lib/products/constants"
import type { ProductListRow } from "@/lib/products/queries"
import {
  buildProductModalHref,
  nextColumnSort,
  productSortState,
  type ProductListSort,
  type ProductSortColumn,
  type SortDirection,
} from "@/lib/products/schema"
import { cn } from "@/lib/utils"

/**
 * The grid's columns after the checkbox, in the default order. The user can
 * move them (drag a title, or Alt+← / Alt+→ on a focused title); the
 * checkbox column always stays first. "purchase" and "sale" are the two
 * price groups (매입단가 / 판매단가 with [부가세 별도 | 부가세 포함]): they
 * move as one.
 */
export const PRODUCT_COLUMN_IDS = [
  "type",
  "code",
  "name",
  "spec",
  "unit",
  "composition",
  "tax",
  "storage",
  "purchase",
  "sale",
  "category",
  "origin",
  "status",
] as const

export type ProductColumnId = (typeof PRODUCT_COLUMN_IDS)[number]

/** localStorage key of the column order (raise the version if ids change). */
export const PRODUCT_COLUMN_ORDER_KEY = "products.grid.columnOrder.v1"

type PriceGroupId = "purchase" | "sale"

/** One column: its title, width, and the sort a click on it sets. */
type ColumnSpec = {
  title: string
  className: string
  /** Not set: the column cannot be sorted. */
  sort?: ProductSortColumn
}

/** Single columns (both header rows tall). */
const SINGLE_COLUMNS: Record<
  Exclude<ProductColumnId, PriceGroupId>,
  ColumnSpec
> = {
  type: { title: "구분", className: "w-12", sort: "type" },
  code: { title: "상품코드", className: "w-28", sort: "code" },
  name: { title: "상품명", className: "min-w-56", sort: "name" },
  spec: { title: "규격", className: "w-32", sort: "spec" },
  unit: { title: "단위", className: "w-16", sort: "unit" },
  composition: { title: "구성", className: "w-20" },
  tax: { title: "과세구분", className: "w-16", sort: "tax" },
  storage: { title: "보관온도", className: "w-16", sort: "storage" },
  category: { title: "상품분류", className: "min-w-44" },
  origin: { title: "원산지", className: "w-28", sort: "origin" },
  status: { title: "사용여부", className: "w-20", sort: "status" },
}

/** The price groups: a title over two columns [부가세 별도 | 부가세 포함]. */
const PRICE_GROUPS: Record<
  PriceGroupId,
  { title: string; parts: [ColumnSpec, ColumnSpec] }
> = {
  purchase: {
    title: "매입단가",
    parts: [
      { title: "부가세 별도", className: "w-24", sort: "purchase_excl" },
      { title: "부가세 포함", className: "w-24", sort: "purchase_incl" },
    ],
  },
  sale: {
    title: "판매단가",
    parts: [
      { title: "부가세 별도", className: "w-24", sort: "sale_excl" },
      { title: "부가세 포함", className: "w-24", sort: "sale_incl" },
    ],
  },
}

function isPriceGroup(id: ProductColumnId): id is PriceGroupId {
  return id === "purchase" || id === "sale"
}

function columnTitle(id: ProductColumnId): string {
  return isPriceGroup(id) ? PRICE_GROUPS[id].title : SINGLE_COLUMNS[id].title
}

/** Number of columns (for the full-width empty row). */
const COLUMN_COUNT = 16

/** Data type of a column drag (not text, so it can't be dropped into a box). */
const DRAG_TYPE = "application/x-product-grid-column"

/**
 * Where a dragged column would land: in front of `beforeId`, or at the end
 * (null). Undefined while it would not move (over its own place).
 */
type ColumnDrag = {
  id: ProductColumnId
  beforeId: ProductColumnId | null | undefined
}

/**
 * While a column is dragged: a line where it will land (white in the
 * title row, brand-colored down the rows) and the dragged column faded.
 */
const DRAG_STYLES = cn(
  "[&_th[data-drop=before]]:shadow-[inset_3px_0_0_var(--color-white)]",
  "[&_th[data-drop=after]]:shadow-[inset_-3px_0_0_var(--color-white)]",
  "[&_td[data-drop=before]]:shadow-[inset_3px_0_0_var(--color-brand)]",
  "[&_td[data-drop=after]]:shadow-[inset_-3px_0_0_var(--color-brand)]",
  "[&_th[data-dragging=true]]:bg-brand-active [&_th[data-dragging=true]]:opacity-60",
  "[&_td[data-dragging=true]]:opacity-40"
)

/**
 * The product list as a dense ERP grid.
 *
 * - A click on a row makes it the current row (outlined); the checkbox (or
 *   Space on the current row) checks it for 선택 사용중지 / 선택 사용.
 * - Double-click, Enter on the current row, or a click on the 상품명 opens
 *   the 상품 수정 modal. (Ctrl/⌘-click on the 상품명 opens it in a new tab.)
 * - ↑ / ↓ move the current row. The header checkbox checks all rows of the
 *   page.
 * - Column titles: a click sorts by that column (▲ 오름차순 → ▼ 내림차순 →
 *   back to 상품코드순; on the server, across all pages). Dragging a title
 *   (or Alt+← / Alt+→ on a focused title) moves the column; the order is
 *   `columnOrder`, kept by the list screen. 상품분류 and 구성 can't be
 *   sorted.
 * - 구분: 기준 (기준상품) / 묶음 (묶음상품). 구성: "×6" (one kind of
 *   기준상품) or "혼합 2종". 과세구분 and 보관온도 are the values in effect
 *   (a 묶음상품's are worked out from its 기준상품; "혼합" = 과세 and 면세
 *   mixed).
 * - 매입단가 / 판매단가: two columns each, [부가세 별도 | 부가세 포함]. The
 *   포함 amount is the stored price; the 별도 amount comes from the view
 *   product_list_items ("-" when it cannot be worked out, e.g. a 혼합
 *   묶음상품 whose 기준상품 has no price). By default they come right after
 *   보관온도, before 상품분류 / 원산지, so the prices are on screen without
 *   scrolling sideways on a 1440px laptop screen with the sidebar open.
 */
export function ProductGrid({
  rows,
  checkedIds,
  onCheckedIdsChange,
  activeId,
  onActiveIdChange,
  onOpen,
  empty,
  columnOrder,
  onColumnOrderChange,
  sort,
  onSortChange,
}: {
  rows: ProductListRow[]
  checkedIds: Set<string>
  onCheckedIdsChange: (ids: Set<string>) => void
  /** The current (outlined) row, or null for none. */
  activeId: string | null
  onActiveIdChange: (id: string) => void
  /** Opens the 상품 수정 modal for this product. */
  onOpen: (id: string) => void
  /** Shown in the grid when `rows` is empty. */
  empty: React.ReactNode
  /** Every column id (PRODUCT_COLUMN_IDS) in the order to show them. */
  columnOrder: ProductColumnId[]
  onColumnOrderChange: (order: ProductColumnId[]) => void
  /** The list's sort (shown on the column titles). */
  sort: ProductListSort
  onSortChange: (sort: ProductListSort) => void
}) {
  const hintId = useId()
  const tableRef = useRef<HTMLTableElement>(null)
  const [drag, setDrag] = useState<ColumnDrag | null>(null)
  // The dragged column, known right away (the state follows a moment later).
  const dragIdRef = useRef<ProductColumnId | null>(null)
  // The title to focus again after Alt+← / Alt+→ moved its column.
  const refocusKeyRef = useRef<string | null>(null)
  // Read by screen readers after a column moved.
  const [announcement, setAnnouncement] = useState("")

  const sortState = productSortState(sort)
  const checkedCount = rows.filter((row) => checkedIds.has(row.id)).length
  const allChecked = rows.length > 0 && checkedCount === rows.length
  // The row reached with Tab: the current row, or the first one.
  const focusId =
    activeId && rows.some((row) => row.id === activeId)
      ? activeId
      : (rows[0]?.id ?? null)

  // A moved title may lose focus when its cell moves: focus it again.
  useLayoutEffect(() => {
    const key = refocusKeyRef.current
    if (key === null) return
    refocusKeyRef.current = null
    tableRef.current
      ?.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)
      ?.focus()
  }, [columnOrder])

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
    row: ProductListRow
  ) {
    // Only keys pressed on the row itself (not in its checkbox or link).
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter") {
      event.preventDefault()
      onOpen(row.id)
    } else if (event.key === " ") {
      event.preventDefault()
      toggle(row.id, !checkedIds.has(row.id))
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const sibling =
        event.key === "ArrowDown"
          ? event.currentTarget.nextElementSibling
          : event.currentTarget.previousElementSibling
      if (sibling instanceof HTMLElement) sibling.focus()
    }
  }

  // ---- Sorting --------------------------------------------------------------

  function sortDirectionOf(column: ProductSortColumn): SortDirection | null {
    return sortState?.column === column ? sortState.direction : null
  }

  // (A drag never sorts: the browser sends no click after a drag.)
  function clickSort(column: ProductSortColumn) {
    onSortChange(nextColumnSort(sort, column))
  }

  // ---- Moving columns -------------------------------------------------------

  function moveTo(id: ProductColumnId, beforeId: ProductColumnId | null) {
    const next = moveColumn(columnOrder, id, beforeId)
    onColumnOrderChange(next)
    const place = next.indexOf(id) + 1
    setAnnouncement(
      `${columnTitle(id)} 열을 ${next.length}개 중 ${place}번째로 옮겼습니다.`
    )
  }

  /** Whether dropping `id` in front of `beforeId` changes the order. */
  function changesOrder(id: ProductColumnId, beforeId: ProductColumnId | null) {
    const index = columnOrder.indexOf(id)
    const next =
      beforeId === null ? columnOrder.length : columnOrder.indexOf(beforeId)
    return next !== index && next !== index + 1
  }

  /** The column whose left half is under `clientX` (null = past the last). */
  function dropPositionAt(clientX: number): ProductColumnId | null {
    const heads =
      tableRef.current?.querySelectorAll<HTMLElement>(
        "thead tr:first-child [data-column-id]"
      ) ?? []
    for (const head of heads) {
      const box = head.getBoundingClientRect()
      if (clientX < box.left + box.width / 2) {
        return head.dataset.columnId as ProductColumnId
      }
    }
    return null
  }

  function startDrag(event: React.DragEvent<HTMLElement>, id: ProductColumnId) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(DRAG_TYPE, id)
    setLiftedDragImage(event, columnTitle(id))
    dragIdRef.current = id
    // After the browser has started the drag: changing the dragged cell in
    // the same moment can cancel the drag in some browsers.
    setTimeout(() => {
      if (dragIdRef.current === id) setDrag({ id, beforeId: undefined })
    }, 0)
  }

  function endDrag() {
    dragIdRef.current = null
    setDrag(null)
  }

  function handleDragOver(event: React.DragEvent<HTMLTableElement>) {
    const id = dragIdRef.current
    if (id === null) return // not a column (e.g. a file)
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    const position = dropPositionAt(event.clientX)
    const beforeId = changesOrder(id, position) ? position : undefined
    setDrag((current) =>
      current?.id === id && current.beforeId === beforeId
        ? current
        : { id, beforeId }
    )
  }

  function handleDragLeave(event: React.DragEvent<HTMLTableElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDrag((current) =>
      current && current.beforeId !== undefined
        ? { ...current, beforeId: undefined }
        : current
    )
  }

  function handleDrop(event: React.DragEvent<HTMLTableElement>) {
    const id = dragIdRef.current
    if (id === null) return
    event.preventDefault()
    const position = dropPositionAt(event.clientX)
    if (changesOrder(id, position)) moveTo(id, position)
    endDrag()
  }

  /** Alt+← / Alt+→ on a focused column title: one place left or right. */
  function handleTitleKeyDown(
    event: React.KeyboardEvent<HTMLElement>,
    id: ProductColumnId,
    focusKey: string
  ) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    // Also keeps the browser from going back a page (Alt+←).
    event.preventDefault()
    const index = columnOrder.indexOf(id)
    if (event.key === "ArrowLeft") {
      if (index === 0) {
        setAnnouncement(`${columnTitle(id)} 열은 이미 맨 앞입니다.`)
        return
      }
      refocusKeyRef.current = focusKey
      moveTo(id, columnOrder[index - 1])
    } else {
      if (index === columnOrder.length - 1) {
        setAnnouncement(`${columnTitle(id)} 열은 이미 맨 뒤입니다.`)
        return
      }
      refocusKeyRef.current = focusKey
      moveTo(id, columnOrder[index + 2] ?? null)
    }
  }

  /**
   * data-drop (the landing line) and data-dragging (faded) for the cells of
   * a column. `part`: which cell of a price group ("first" = 부가세 별도,
   * "last" = 부가세 포함); none for a whole column or a group's title.
   */
  function marks(id: ProductColumnId, part?: "first" | "last"): CellMarks {
    let drop: "before" | "after" | undefined
    if (drag?.beforeId === id && part !== "last") {
      drop = "before"
    } else if (
      drag?.beforeId === null &&
      id === columnOrder.at(-1) &&
      part !== "first"
    ) {
      drop = "after"
    }
    return {
      "data-drop": drop,
      "data-dragging": drag?.id === id ? ("true" as const) : undefined,
    }
  }

  const priceGroups = columnOrder.filter(isPriceGroup)

  return (
    <>
      <DataGrid
        ref={tableRef}
        aria-label="상품 목록"
        // The grid fills the rest of the screen, so the page itself doesn't
        // scroll (the search form has 3 rows on laptop and wide screens).
        containerClassName="max-h-[max(20rem,calc(100svh-26.5rem))]"
        // Wide enough for every column; an empty grid fits the box so its
        // message stays in view.
        className={cn(rows.length > 0 && "min-w-[90rem]", DRAG_STYLES)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <DataGridHeader>
          <tr>
            <DataGridHead rowSpan={2} className="w-9">
              <DataGridCheckbox
                inHeader
                aria-label="이 페이지의 상품 모두 선택"
                checked={allChecked}
                indeterminate={checkedCount > 0 && !allChecked}
                disabled={rows.length === 0}
                onCheckedChange={(checked) =>
                  onCheckedIdsChange(
                    checked ? new Set(rows.map((row) => row.id)) : new Set()
                  )
                }
              />
            </DataGridHead>
            {columnOrder.map((id) => {
              const spec = isPriceGroup(id)
                ? { title: PRICE_GROUPS[id].title, className: "" }
                : SINGLE_COLUMNS[id]
              return (
                <ColumnTitle
                  key={id}
                  kind={isPriceGroup(id) ? "group" : "single"}
                  columnId={id}
                  spec={spec}
                  focusKey={id}
                  direction={spec.sort ? sortDirectionOf(spec.sort) : null}
                  hintId={hintId}
                  onSort={() => {
                    if (spec.sort) clickSort(spec.sort)
                  }}
                  onDragStart={(event) => startDrag(event, id)}
                  onDragEnd={endDrag}
                  onMoveKeyDown={(event) => handleTitleKeyDown(event, id, id)}
                  {...marks(id)}
                />
              )
            })}
          </tr>
          <tr>
            {priceGroups.map((id) =>
              PRICE_GROUPS[id].parts.map((part, index) => {
                const focusKey = `${id}-${index}`
                return (
                  <ColumnTitle
                    key={focusKey}
                    kind="sub"
                    columnId={id}
                    spec={part}
                    focusKey={focusKey}
                    direction={part.sort ? sortDirectionOf(part.sort) : null}
                    hintId={hintId}
                    onSort={() => {
                      if (part.sort) clickSort(part.sort)
                    }}
                    onDragStart={(event) => startDrag(event, id)}
                    onDragEnd={endDrag}
                    onMoveKeyDown={(event) =>
                      handleTitleKeyDown(event, id, focusKey)
                    }
                    {...marks(id, index === 0 ? "first" : "last")}
                  />
                )
              })
            )}
          </tr>
        </DataGridHeader>
        <DataGridBody>
          {rows.length === 0 && (
            <DataGridEmpty colSpan={COLUMN_COUNT}>{empty}</DataGridEmpty>
          )}
          {rows.map((row) => {
            const isActive = row.id === activeId
            const isChecked = checkedIds.has(row.id)
            return (
              <DataGridRow
                key={row.id}
                selected={isChecked}
                tabIndex={row.id === focusId ? 0 : -1}
                data-active={isActive ? "true" : undefined}
                onClick={() => onActiveIdChange(row.id)}
                onFocus={(event) => {
                  if (event.target === event.currentTarget) {
                    onActiveIdChange(row.id)
                  }
                }}
                onDoubleClick={(event) => {
                  // Not when double-clicking the checkbox.
                  const target = event.target as HTMLElement
                  if (target.closest('[role="checkbox"], button')) return
                  onOpen(row.id)
                }}
                onKeyDown={(event) => handleRowKeyDown(event, row)}
                className={cn(
                  "cursor-default outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring data-[active=true]:outline-2 data-[active=true]:-outline-offset-2 data-[active=true]:outline-brand",
                  !row.isActive && "text-muted-foreground"
                )}
              >
                <DataGridCell align="center" className="px-0">
                  <DataGridCheckbox
                    aria-label={`${row.name} 선택`}
                    checked={isChecked}
                    onCheckedChange={(checked) => toggle(row.id, checked)}
                  />
                </DataGridCell>
                {columnOrder.map((id) => (
                  <Fragment key={id}>
                    {isPriceGroup(id) ? (
                      <PriceCells
                        row={row}
                        group={id}
                        excludedMarks={marks(id, "first")}
                        includedMarks={marks(id, "last")}
                      />
                    ) : (
                      <ProductCell
                        row={row}
                        column={id}
                        onOpen={onOpen}
                        {...marks(id)}
                      />
                    )}
                  </Fragment>
                ))}
              </DataGridRow>
            )
          })}
        </DataGridBody>
      </DataGrid>
      <p id={hintId} className="sr-only">
        열 제목을 누르면 그 열로 정렬합니다. 열 제목을 끌어 놓거나 Alt+왼쪽,
        Alt+오른쪽 화살표로 열 위치를 바꿀 수 있습니다.
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  )
}

/**
 * A column title that can be dragged (and moved with Alt+← / Alt+→):
 * - "single": a column of its own (both header rows tall);
 * - "group": a price group's title (매입단가 / 판매단가) over its two parts;
 * - "sub": a part of a price group (부가세 별도 / 부가세 포함); dragging it
 *   moves the whole group.
 * When `spec.sort` is set, a click sorts by it (the button inside gives
 * keyboard focus and Enter/Space); otherwise the title is a focusable label.
 */
function ColumnTitle({
  kind,
  columnId,
  spec,
  focusKey,
  direction,
  hintId,
  onSort,
  onDragStart,
  onDragEnd,
  onMoveKeyDown,
  ...marks
}: {
  kind: "single" | "group" | "sub"
  columnId: ProductColumnId
  spec: ColumnSpec
  /** Finds the title again after it moved (data-focus-key). */
  focusKey: string
  /** The list's sort on this column, null when it is sorted otherwise. */
  direction: SortDirection | null
  /** Id of the hidden text that explains clicking and moving. */
  hintId: string
  onSort: () => void
  onDragStart: (event: React.DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onMoveKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
} & CellMarks) {
  const sortable = spec.sort !== undefined
  const label = sortable ? (
    <button
      type="button"
      data-focus-key={focusKey}
      aria-describedby={hintId}
      onKeyDown={onMoveKeyDown}
      className="inline-flex cursor-pointer items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      {spec.title}
      <SortIcon direction={direction} />
    </button>
  ) : (
    <span
      tabIndex={0}
      data-focus-key={focusKey}
      aria-describedby={hintId}
      onKeyDown={onMoveKeyDown}
      className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      {spec.title}
    </span>
  )
  const cellProps = {
    draggable: true,
    onDragStart,
    onDragEnd,
    title: sortable
      ? "누르면 정렬하고, 끌어서 놓으면 열 위치를 바꿉니다."
      : "끌어서 놓으면 열 위치를 바꿉니다.",
    className: cn(
      spec.className,
      "select-none",
      sortable ? "cursor-pointer" : "cursor-grab",
      direction && "bg-brand-active"
    ),
    ...marks,
  }
  const sortProps = sortable
    ? {
        "aria-sort": direction
          ? direction === "asc"
            ? ("ascending" as const)
            : ("descending" as const)
          : undefined,
        onClick: onSort,
      }
    : {}

  if (kind === "group") {
    return (
      <DataGridHeadGroup colSpan={2} data-column-id={columnId} {...cellProps}>
        {label}
      </DataGridHeadGroup>
    )
  }
  if (kind === "sub") {
    return (
      <DataGridHead subHead {...cellProps} {...sortProps}>
        {label}
      </DataGridHead>
    )
  }
  return (
    <DataGridHead
      rowSpan={2}
      data-column-id={columnId}
      {...cellProps}
      {...sortProps}
    >
      {label}
    </DataGridHead>
  )
}

/**
 * The browser's picture of a dragged column title: the title on a brand
 * chip with a shadow, so it looks lifted off the grid.
 */
function setLiftedDragImage(event: React.DragEvent<HTMLElement>, text: string) {
  const chip = document.createElement("div")
  chip.textContent = text
  chip.className =
    "fixed top-0 -left-[1000px] rounded-sm bg-brand px-3 py-1.5 text-[13px] font-bold whitespace-nowrap text-brand-foreground shadow-lg"
  document.body.append(chip)
  event.dataTransfer.setDragImage(chip, 16, 14)
  // The browser has taken its picture once this event is over.
  setTimeout(() => chip.remove(), 0)
}

/**
 * ▲ / ▼ after a sortable column title: the active direction, or both faint
 * when the list is not sorted by this column.
 */
function SortIcon({ direction }: { direction: SortDirection | null }) {
  return (
    <svg
      viewBox="0 0 8 12"
      aria-hidden="true"
      className="h-3 w-2 shrink-0"
      fill="currentColor"
    >
      <path
        d="M4 0 8 5H0z"
        opacity={direction === "asc" ? 1 : direction === null ? 0.4 : 0}
      />
      <path
        d="M4 12 0 7h8z"
        opacity={direction === "desc" ? 1 : direction === null ? 0.4 : 0}
      />
    </svg>
  )
}

/** One body cell of a single column (data-* attributes: drag marks). */
function ProductCell({
  row,
  column,
  onOpen,
  ...marks
}: {
  row: ProductListRow
  column: Exclude<ProductColumnId, PriceGroupId>
  onOpen: (id: string) => void
} & CellMarks) {
  switch (column) {
    case "type":
      return (
        <DataGridCell align="center" className="px-1" {...marks}>
          <ProductTypeBadge productType={row.productType} />
        </DataGridCell>
      )
    case "code":
      return (
        <DataGridCell align="center" className="tabular-nums" {...marks}>
          {row.code}
        </DataGridCell>
      )
    case "name":
      return (
        <DataGridCell className="max-w-64 truncate" title={row.name} {...marks}>
          <a
            href={buildProductModalHref("", { mode: "edit", id: row.id })}
            onClick={(event) => {
              // Ctrl/⌘/Shift-click: the browser opens a new tab/window.
              if (
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return
              }
              event.preventDefault()
              onOpen(row.id)
            }}
            className="rounded-sm underline-offset-4 outline-none hover:text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {row.name}
          </a>
        </DataGridCell>
      )
    case "spec":
      return (
        <DataGridCell
          align="center"
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
    case "composition":
      return (
        <DataGridCell
          align="center"
          className="tabular-nums"
          title={compositionTitle(row)}
          {...marks}
        >
          {row.productType === "bundle" ? formatComposition(row) : EMPTY_VALUE}
        </DataGridCell>
      )
    case "tax":
      return (
        <DataGridCell
          align="center"
          className={cn(row.taxType === "mixed" && "font-bold")}
          title={
            row.taxType === "mixed"
              ? "구성상품의 과세구분이 섞여 있습니다."
              : undefined
          }
          {...marks}
        >
          {row.taxType ? taxTypeLabel(row.taxType) : EMPTY_VALUE}
        </DataGridCell>
      )
    case "storage":
      return (
        <DataGridCell align="center" {...marks}>
          {row.storageType ? storageTypeLabel(row.storageType) : EMPTY_VALUE}
        </DataGridCell>
      )
    case "category":
      return (
        <DataGridCell
          className={cn(
            "max-w-64 truncate",
            row.isUncategorized && "text-muted-foreground"
          )}
          title={row.categoryPath}
          {...marks}
        >
          {row.categoryPath}
        </DataGridCell>
      )
    case "origin":
      return (
        <DataGridCell
          className="max-w-36 truncate"
          title={row.origin ?? undefined}
          {...marks}
        >
          {row.origin ?? EMPTY_VALUE}
        </DataGridCell>
      )
    case "status":
      return (
        <DataGridCell
          align="center"
          className={cn(!row.isActive && "font-bold text-destructive")}
          {...marks}
        >
          {row.isActive ? "사용" : "사용중지"}
        </DataGridCell>
      )
  }
}

/** 구분 cell: "기준" (기준상품) or "묶음" (묶음상품). */
function ProductTypeBadge({ productType }: { productType: ProductType }) {
  return (
    <span
      title={productTypeLabel(productType)}
      className={cn(
        "inline-flex h-5 items-center rounded-sm border px-1.5 text-xs",
        productType === "bundle"
          ? "border-brand-border bg-brand-tint font-bold text-brand-active"
          : "border-grid-line bg-background text-muted-foreground"
      )}
    >
      {productTypeShortLabel(productType)}
    </span>
  )
}

/** Tooltip of the 구성 cell, e.g. "기준상품 PRC-010 × 6". */
function compositionTitle(row: ProductListRow): string | undefined {
  if (row.productType !== "bundle") return undefined
  if (row.componentCount === 1 && row.singleComponentCode !== null) {
    return `기준상품 ${row.singleComponentCode} × ${formatNumber(row.singleComponentQuantity, 0)}`
  }
  return `기준상품 ${formatNumber(row.componentCount, 0)}종이 들어간 묶음상품`
}

type CellMarks = {
  "data-drop"?: "before" | "after"
  "data-dragging"?: "true"
}

/**
 * The two cells of one price: [부가세 별도 | 부가세 포함]. "-" when there is
 * no price, or (부가세 별도) when it cannot be worked out. The 별도 cell's
 * tooltip shows the 부가세, or why there is no 별도 amount.
 */
function PriceCells({
  row,
  group,
  excludedMarks,
  includedMarks,
}: {
  row: ProductListRow
  group: PriceGroupId
  excludedMarks: CellMarks
  includedMarks: CellMarks
}) {
  const isPurchase = group === "purchase"
  /** The stored price, 부가세 포함. */
  const included = isPurchase ? row.purchasePriceInclVat : row.salePriceInclVat
  /** 부가세 별도 (from the view), null when it cannot be worked out. */
  const excluded = isPurchase ? row.purchasePriceExclVat : row.salePriceExclVat
  const vat = isPurchase ? row.purchaseVat : row.saleVat
  const priceName = isPurchase ? "매입가" : "판매가"
  const taxType = row.taxType

  let excludedTitle: string | undefined
  if (included !== null && excluded === null) {
    excludedTitle =
      taxType === "mixed"
        ? `혼합 묶음상품은 구성상품(기준상품)의 기본 ${priceName} 비율로 부가세를 나눕니다. 기본 ${priceName}가 비어 있는 구성상품이 있거나 모두 0원이라 계산할 수 없습니다.`
        : "과세구분을 알 수 없어 계산할 수 없습니다."
  } else if (excluded !== null && vat !== null) {
    excludedTitle =
      vat === 0 && taxType === "exempt"
        ? "면세 상품이라 부가세가 없습니다."
        : `부가세 ${formatNumber(vat, 0)}원`
  }
  return (
    <>
      <DataGridCell numeric title={excludedTitle} {...excludedMarks}>
        {formatNumber(excluded, 0)}
      </DataGridCell>
      <DataGridCell numeric {...includedMarks}>
        {formatNumber(included, 0)}
      </DataGridCell>
    </>
  )
}
