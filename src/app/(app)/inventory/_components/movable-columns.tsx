"use client"

import { useLayoutEffect, useRef, useState } from "react"

import { DataGridHead, DataGridHeadGroup } from "@/components/erp/data-grid"
import { moveColumn } from "@/hooks/use-column-order"
import type { SortDirection } from "@/lib/inventory/schema"
import { cn } from "@/lib/utils"

// Column titles of the 재고 grids that sort on a click and move by
// dragging (or Alt+← / Alt+→), the same behaviour as the 상품/거래처/직원
// grids. A column is either a single column (both header rows tall) or a
// group: a title over several parts, e.g. 재고금액 over [부가세 포함 |
// 부가세 별도]; a group moves as one. The order itself is kept by the screen
// with useColumnOrder (remembered in this browser).

/** One column, or one part of a group. `sort`: the sort a click sets. */
export type ColumnPartSpec<Sort extends string> = {
  title: string
  className?: string
  sort?: Sort
}

/** A column; with `parts` it is a group title over those columns. */
export type ColumnSpec<Sort extends string> = ColumnPartSpec<Sort> & {
  parts?: readonly ColumnPartSpec<Sort>[]
}

/** Number of table columns of these specs (a group counts its parts). */
export function columnCount<Sort extends string>(
  specs: readonly ColumnSpec<Sort>[]
): number {
  return specs.reduce((sum, spec) => sum + (spec.parts?.length ?? 1), 0)
}

/** Which cell of a group a body/header cell is (none for a single column). */
export type ColumnPart = "first" | "middle" | "last"

/** The part of the `index`-th of `length` cells (undefined when alone). */
export function columnPart(
  index: number,
  length: number
): ColumnPart | undefined {
  if (length <= 1) return undefined
  if (index === 0) return "first"
  if (index === length - 1) return "last"
  return "middle"
}

/** data-* attributes that draw the landing line and fade the dragged column. */
export type CellMarks = {
  "data-drop"?: "before" | "after"
  "data-dragging"?: "true"
}

/**
 * Classes for the <DataGrid>: while a column is dragged, a line where it
 * will land (white in the title rows, brand-colored down the rows) and the
 * dragged column faded.
 */
export const COLUMN_DRAG_STYLES = cn(
  "[&_th[data-drop=before]]:shadow-[inset_3px_0_0_var(--color-white)]",
  "[&_th[data-drop=after]]:shadow-[inset_-3px_0_0_var(--color-white)]",
  "[&_td[data-drop=before]]:shadow-[inset_3px_0_0_var(--color-brand)]",
  "[&_td[data-drop=after]]:shadow-[inset_-3px_0_0_var(--color-brand)]",
  "[&_th[data-dragging=true]]:bg-brand-active [&_th[data-dragging=true]]:opacity-60",
  "[&_td[data-dragging=true]]:opacity-40"
)

/**
 * Where a dragged column would land: in front of `beforeId`, or at the end
 * (null). Undefined while it would not move (over its own place).
 */
type ColumnDrag<Id extends string> = {
  id: Id
  beforeId: Id | null | undefined
}

/**
 * Drag-and-drop and Alt+← / Alt+→ for the column titles of one grid.
 * Give the <DataGrid> `ref={tableRef}` and the returned onDragOver /
 * onDragLeave / onDrop, render the titles with <MovableColumnHeader>, and
 * give every body cell `marks(id, part)`.
 */
export function useMovableColumns<Id extends string>({
  tableRef,
  order,
  onOrderChange,
  titleOf,
  dragType,
}: {
  /** The grid's <table> (to find the column under the mouse). */
  tableRef: React.RefObject<HTMLTableElement | null>
  order: readonly Id[]
  onOrderChange: (order: Id[]) => void
  /** The column's title for messages ("재고금액 열을 … 옮겼습니다"). */
  titleOf: (id: Id) => string
  /** Data type of the drag, e.g. "application/x-stock-report-column". */
  dragType: string
}) {
  const [drag, setDrag] = useState<ColumnDrag<Id> | null>(null)
  // The dragged column, known right away (the state follows a moment later).
  const dragIdRef = useRef<Id | null>(null)
  // The title to focus again after Alt+← / Alt+→ moved its column.
  const refocusKeyRef = useRef<string | null>(null)
  // Read by screen readers after a column moved.
  const [announcement, setAnnouncement] = useState("")

  // A moved title may lose focus when its cell moves: focus it again.
  useLayoutEffect(() => {
    const key = refocusKeyRef.current
    if (key === null) return
    refocusKeyRef.current = null
    tableRef.current
      ?.querySelector<HTMLElement>(`[data-focus-key="${key}"]`)
      ?.focus()
  }, [order, tableRef])

  function moveTo(id: Id, beforeId: Id | null) {
    const next = moveColumn(order, id, beforeId)
    onOrderChange(next)
    const place = next.indexOf(id) + 1
    setAnnouncement(
      `${titleOf(id)} 열을 ${next.length}개 중 ${place}번째로 옮겼습니다.`
    )
  }

  /** Whether dropping `id` in front of `beforeId` changes the order. */
  function changesOrder(id: Id, beforeId: Id | null) {
    const index = order.indexOf(id)
    const next = beforeId === null ? order.length : order.indexOf(beforeId)
    return next !== index && next !== index + 1
  }

  /** The column whose left half is under `clientX` (null = past the last). */
  function dropPositionAt(clientX: number): Id | null {
    const heads =
      tableRef.current?.querySelectorAll<HTMLElement>(
        "thead tr:first-child [data-column-id]"
      ) ?? []
    for (const head of heads) {
      const box = head.getBoundingClientRect()
      if (clientX < box.left + box.width / 2) {
        return head.dataset.columnId as Id
      }
    }
    return null
  }

  function startDrag(event: React.DragEvent<HTMLElement>, id: Id) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(dragType, id)
    setLiftedDragImage(event, titleOf(id))
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

  function onDragOver(event: React.DragEvent<HTMLTableElement>) {
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

  function onDragLeave(event: React.DragEvent<HTMLTableElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setDrag((current) =>
      current && current.beforeId !== undefined
        ? { ...current, beforeId: undefined }
        : current
    )
  }

  function onDrop(event: React.DragEvent<HTMLTableElement>) {
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
    id: Id,
    focusKey: string
  ) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    // Also keeps the browser from going back a page (Alt+←).
    event.preventDefault()
    const index = order.indexOf(id)
    if (event.key === "ArrowLeft") {
      if (index === 0) {
        setAnnouncement(`${titleOf(id)} 열은 이미 맨 앞입니다.`)
        return
      }
      refocusKeyRef.current = focusKey
      moveTo(id, order[index - 1])
    } else {
      if (index === order.length - 1) {
        setAnnouncement(`${titleOf(id)} 열은 이미 맨 뒤입니다.`)
        return
      }
      refocusKeyRef.current = focusKey
      moveTo(id, order[index + 2] ?? null)
    }
  }

  /**
   * data-drop (the landing line) and data-dragging (faded) for the cells of
   * a column; `part` for the cells of a group (the line goes before its
   * first and after its last cell).
   */
  function marks(id: Id, part?: ColumnPart): CellMarks {
    let drop: "before" | "after" | undefined
    if (drag?.beforeId === id && (part === undefined || part === "first")) {
      drop = "before"
    } else if (
      drag?.beforeId === null &&
      id === order.at(-1) &&
      (part === undefined || part === "last")
    ) {
      drop = "after"
    }
    return {
      "data-drop": drop,
      "data-dragging": drag?.id === id ? ("true" as const) : undefined,
    }
  }

  return {
    onDragOver,
    onDragLeave,
    onDrop,
    startDrag,
    endDrag,
    handleTitleKeyDown,
    marks,
    announcement,
  }
}

export type MovableColumns<Id extends string> = ReturnType<
  typeof useMovableColumns<Id>
>

/**
 * The two header rows of a grid with movable columns: `leading` cells
 * first (e.g. the select-all checkbox; give them rowSpan={2}), then the
 * columns in `order`; group parts go in the second row.
 */
export function MovableColumnHeader<Id extends string, Sort extends string>({
  order,
  columns,
  movable,
  hintId,
  directionOf,
  onSort,
  leading,
}: {
  order: readonly Id[]
  columns: Record<Id, ColumnSpec<Sort>>
  movable: MovableColumns<Id>
  /** Id of the hidden text that explains clicking and moving. */
  hintId: string
  /** The list's sort direction on this sort key, null when sorted otherwise. */
  directionOf: (sort: Sort) => SortDirection | null
  onSort: (sort: Sort) => void
  leading?: React.ReactNode
}) {
  return (
    <>
      <tr>
        {leading}
        {order.map((id) => {
          const spec = columns[id]
          const parts = spec.parts ?? []
          return (
            <ColumnTitle
              key={id}
              kind={parts.length > 0 ? "group" : "single"}
              colSpan={parts.length}
              columnId={id}
              spec={spec}
              focusKey={id}
              direction={spec.sort ? directionOf(spec.sort) : null}
              hintId={hintId}
              onSort={() => {
                if (spec.sort) onSort(spec.sort)
              }}
              onDragStart={(event) => movable.startDrag(event, id)}
              onDragEnd={movable.endDrag}
              onMoveKeyDown={(event) =>
                movable.handleTitleKeyDown(event, id, id)
              }
              {...movable.marks(id)}
            />
          )
        })}
      </tr>
      <tr>
        {order.flatMap((id) => {
          const parts = columns[id].parts ?? []
          return parts.map((part, index) => {
            const focusKey = `${id}-${index}`
            return (
              <ColumnTitle
                key={focusKey}
                kind="sub"
                colSpan={1}
                columnId={id}
                spec={part}
                focusKey={focusKey}
                direction={part.sort ? directionOf(part.sort) : null}
                hintId={hintId}
                onSort={() => {
                  if (part.sort) onSort(part.sort)
                }}
                onDragStart={(event) => movable.startDrag(event, id)}
                onDragEnd={movable.endDrag}
                onMoveKeyDown={(event) =>
                  movable.handleTitleKeyDown(event, id, focusKey)
                }
                {...movable.marks(id, columnPart(index, parts.length))}
              />
            )
          })
        })}
      </tr>
    </>
  )
}

/**
 * The hidden texts for screen readers: how the titles work (`hintId`) and
 * the last column move.
 */
export function MovableColumnHints({
  hintId,
  announcement,
}: {
  hintId: string
  announcement: string
}) {
  return (
    <>
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
 * - "group": a group's title over its parts;
 * - "sub": a part of a group; dragging it moves the whole group.
 * When `spec.sort` is set, a click sorts by it (the button inside gives
 * keyboard focus and Enter/Space); otherwise the title is a focusable label.
 */
function ColumnTitle<Id extends string, Sort extends string>({
  kind,
  colSpan,
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
  colSpan: number
  columnId: Id
  spec: ColumnPartSpec<Sort>
  /** Finds the title again after it moved (data-focus-key). */
  focusKey: string
  direction: SortDirection | null
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
      <DataGridHeadGroup
        colSpan={colSpan}
        data-column-id={columnId}
        {...cellProps}
      >
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
