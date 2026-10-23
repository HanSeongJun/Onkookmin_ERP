"use client"

import Link from "next/link"
import { useId, useLayoutEffect, useRef, useState } from "react"

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
import { moveColumn } from "@/hooks/use-column-order"
import type { EmployeeListRow } from "@/lib/employees/queries"
import {
  buildEmployeeModalHref,
  driverOperationTypeLabel,
  employeeColumnTitle,
  employeeSortState,
  employeeStatusLabel,
  employmentTypeLabel,
  nextEmployeeColumnSort,
  vehicleTypeLabel,
  yesNo,
  type EmployeeColumnId,
  type EmployeeListSort,
  type SortDirection,
} from "@/lib/employees/schema"
import { EMPTY_VALUE, formatNumber } from "@/lib/format"
import { formatPhone } from "@/lib/partners/phone"
import {
  buildPartnerListHref,
  defaultPartnerListParams,
} from "@/lib/partners/schema"
import { cn } from "@/lib/utils"

/** Width of each column (the column id is also its sort key). */
const COLUMN_CLASSES: Record<EmployeeColumnId, string> = {
  code: "w-24",
  name: "min-w-32",
  mobile: "w-32",
  address: "min-w-64",
  department: "w-28",
  job_title: "w-24",
  employment_type: "w-24",
  sales_rep: "w-20",
  delivery_driver: "w-20",
  operation_type: "w-20",
  vehicle_number: "w-24",
  status: "w-20",
  hire_date: "w-24",
  resignation_date: "w-24",
  salary: "w-20",
  partner_count: "w-32",
}

/** Number of columns (for the full-width empty row): checkbox + 16. */
const COLUMN_COUNT = 17

/** Data type of a column drag (not text, so it can't be dropped into a box). */
const DRAG_TYPE = "application/x-employee-grid-column"

/**
 * Where a dragged column would land: in front of `beforeId`, or at the end
 * (null). Undefined while it would not move (over its own place).
 */
type ColumnDrag = {
  id: EmployeeColumnId
  beforeId: EmployeeColumnId | null | undefined
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

type CellMarks = {
  "data-drop"?: "before" | "after"
  "data-dragging"?: "true"
}

/**
 * The 직원 list as a dense ERP grid (same behaviour as the 거래처 grid).
 *
 * - A click on a row makes it the current row (outlined); the checkbox (or
 *   Space on the current row) checks it for 선택 퇴사 / 선택 재직.
 * - Double-click, Enter on the current row, or a click on the 직원명 opens
 *   the 직원 수정 modal (Ctrl/⌘-click: in a new tab).
 * - ↑ / ↓ move the current row. The header checkbox checks all rows of the
 *   page. 퇴사 employees are grey.
 * - Column titles: a click sorts by that column (▲ 오름차순 → ▼ 내림차순 →
 *   back to 직원코드순; on the server, across all pages). Dragging a title
 *   (or Alt+← / Alt+→ on a focused title) moves the column; the order is
 *   `columnOrder`, kept by the list screen.
 */
export function EmployeeGrid({
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
  rows: EmployeeListRow[]
  checkedIds: Set<string>
  onCheckedIdsChange: (ids: Set<string>) => void
  /** The current (outlined) row, or null for none. */
  activeId: string | null
  onActiveIdChange: (id: string) => void
  /** Opens the 직원 수정 modal for this employee. */
  onOpen: (id: string) => void
  /** Shown in the grid when `rows` is empty. */
  empty: React.ReactNode
  /** Every column id in the order to show them. */
  columnOrder: EmployeeColumnId[]
  onColumnOrderChange: (order: EmployeeColumnId[]) => void
  /** The list's sort (shown on the column titles). */
  sort: EmployeeListSort
  onSortChange: (sort: EmployeeListSort) => void
}) {
  const hintId = useId()
  const tableRef = useRef<HTMLTableElement>(null)
  const [drag, setDrag] = useState<ColumnDrag | null>(null)
  // The dragged column, known right away (the state follows a moment later).
  const dragIdRef = useRef<EmployeeColumnId | null>(null)
  // The title to focus again after Alt+← / Alt+→ moved its column.
  const refocusIdRef = useRef<EmployeeColumnId | null>(null)
  // Read by screen readers after a column moved.
  const [announcement, setAnnouncement] = useState("")

  const sortState = employeeSortState(sort)
  const checkedCount = rows.filter((row) => checkedIds.has(row.id)).length
  const allChecked = rows.length > 0 && checkedCount === rows.length
  // The row reached with Tab: the current row, or the first one.
  const focusId =
    activeId && rows.some((row) => row.id === activeId)
      ? activeId
      : (rows[0]?.id ?? null)

  // A moved title may lose focus when its cell moves: focus it again.
  useLayoutEffect(() => {
    const id = refocusIdRef.current
    if (id === null) return
    refocusIdRef.current = null
    tableRef.current
      ?.querySelector<HTMLElement>(`[data-focus-key="${id}"]`)
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
    row: EmployeeListRow
  ) {
    // Only keys pressed on the row itself (not in its checkbox or links).
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

  // ---- Moving columns -------------------------------------------------------

  function moveTo(id: EmployeeColumnId, beforeId: EmployeeColumnId | null) {
    const next = moveColumn(columnOrder, id, beforeId)
    onColumnOrderChange(next)
    const place = next.indexOf(id) + 1
    setAnnouncement(
      `${employeeColumnTitle(id)} 열을 ${next.length}개 중 ${place}번째로 옮겼습니다.`
    )
  }

  /** Whether dropping `id` in front of `beforeId` changes the order. */
  function changesOrder(
    id: EmployeeColumnId,
    beforeId: EmployeeColumnId | null
  ) {
    const index = columnOrder.indexOf(id)
    const next =
      beforeId === null ? columnOrder.length : columnOrder.indexOf(beforeId)
    return next !== index && next !== index + 1
  }

  /** The column whose left half is under `clientX` (null = past the last). */
  function dropPositionAt(clientX: number): EmployeeColumnId | null {
    const heads =
      tableRef.current?.querySelectorAll<HTMLElement>(
        "thead [data-column-id]"
      ) ?? []
    for (const head of heads) {
      const box = head.getBoundingClientRect()
      if (clientX < box.left + box.width / 2) {
        return head.dataset.columnId as EmployeeColumnId
      }
    }
    return null
  }

  function startDrag(
    event: React.DragEvent<HTMLElement>,
    id: EmployeeColumnId
  ) {
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData(DRAG_TYPE, id)
    setLiftedDragImage(event, employeeColumnTitle(id))
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
    id: EmployeeColumnId
  ) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    // Also keeps the browser from going back a page (Alt+←).
    event.preventDefault()
    const index = columnOrder.indexOf(id)
    const title = employeeColumnTitle(id)
    if (event.key === "ArrowLeft") {
      if (index === 0) {
        setAnnouncement(`${title} 열은 이미 맨 앞입니다.`)
        return
      }
      refocusIdRef.current = id
      moveTo(id, columnOrder[index - 1])
    } else {
      if (index === columnOrder.length - 1) {
        setAnnouncement(`${title} 열은 이미 맨 뒤입니다.`)
        return
      }
      refocusIdRef.current = id
      moveTo(id, columnOrder[index + 2] ?? null)
    }
  }

  /** data-drop (the landing line) and data-dragging (faded) of a column. */
  function marks(id: EmployeeColumnId): CellMarks {
    let drop: "before" | "after" | undefined
    if (drag?.beforeId === id) {
      drop = "before"
    } else if (drag?.beforeId === null && id === columnOrder.at(-1)) {
      drop = "after"
    }
    return {
      "data-drop": drop,
      "data-dragging": drag?.id === id ? ("true" as const) : undefined,
    }
  }

  return (
    <>
      <DataGrid
        ref={tableRef}
        aria-label="직원 목록"
        // The grid fills the rest of the screen, so the page itself doesn't
        // scroll.
        containerClassName="max-h-[max(20rem,calc(100svh-25rem))]"
        // Wide enough for every column; an empty grid fits the box so its
        // message stays in view.
        className={cn(rows.length > 0 && "min-w-[104rem]", DRAG_STYLES)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <DataGridHeader>
          <tr>
            <DataGridHead className="w-9">
              <DataGridCheckbox
                inHeader
                aria-label="이 페이지의 직원 모두 선택"
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
            {columnOrder.map((id) => (
              <ColumnTitle
                key={id}
                columnId={id}
                direction={sortState.column === id ? sortState.direction : null}
                hintId={hintId}
                onSort={() => onSortChange(nextEmployeeColumnSort(sort, id))}
                onDragStart={(event) => startDrag(event, id)}
                onDragEnd={endDrag}
                onMoveKeyDown={(event) => handleTitleKeyDown(event, id)}
                {...marks(id)}
              />
            ))}
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
                  // Not when double-clicking the checkbox or a link.
                  const target = event.target as HTMLElement
                  if (target.closest('[role="checkbox"], button, a')) return
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
                  <EmployeeCell
                    key={id}
                    row={row}
                    column={id}
                    onOpen={onOpen}
                    {...marks(id)}
                  />
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
 * A column title: a click sorts by it (the button inside gives keyboard
 * focus and Enter/Space); dragging it (or Alt+← / Alt+→ on it) moves the
 * column.
 */
function ColumnTitle({
  columnId,
  direction,
  hintId,
  onSort,
  onDragStart,
  onDragEnd,
  onMoveKeyDown,
  ...marks
}: {
  columnId: EmployeeColumnId
  /** The list's sort on this column, null when it is sorted otherwise. */
  direction: SortDirection | null
  /** Id of the hidden text that explains clicking and moving. */
  hintId: string
  onSort: () => void
  onDragStart: (event: React.DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onMoveKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
} & CellMarks) {
  return (
    <DataGridHead
      data-column-id={columnId}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      title="누르면 정렬하고, 끌어서 놓으면 열 위치를 바꿉니다."
      aria-sort={
        direction === "asc"
          ? "ascending"
          : direction === "desc"
            ? "descending"
            : undefined
      }
      onClick={onSort}
      className={cn(
        COLUMN_CLASSES[columnId],
        "cursor-pointer select-none",
        direction && "bg-brand-active"
      )}
      {...marks}
    >
      <button
        type="button"
        data-focus-key={columnId}
        aria-describedby={hintId}
        onKeyDown={onMoveKeyDown}
        className="inline-flex cursor-pointer items-center gap-1 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        {employeeColumnTitle(columnId)}
        <SortIcon direction={direction} />
      </button>
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
 * ▲ / ▼ after a column title: the active direction, or both faint when the
 * list is not sorted by this column.
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

/** A Y/N cell: Y bold, N grey. */
function YesNoCell({ value, ...marks }: { value: boolean } & CellMarks) {
  return (
    <DataGridCell
      align="center"
      className={cn(value ? "font-bold" : "text-muted-foreground")}
      {...marks}
    >
      {yesNo(value)}
    </DataGridCell>
  )
}

/** One body cell (data-* attributes: drag marks). */
function EmployeeCell({
  row,
  column,
  onOpen,
  ...marks
}: {
  row: EmployeeListRow
  column: EmployeeColumnId
  onOpen: (id: string) => void
} & CellMarks) {
  switch (column) {
    case "code":
      return (
        <DataGridCell align="center" className="tabular-nums" {...marks}>
          {row.code}
        </DataGridCell>
      )
    case "name":
      return (
        <DataGridCell className="max-w-48 truncate" title={row.name} {...marks}>
          <a
            href={buildEmployeeModalHref("", { mode: "edit", id: row.id })}
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
    case "mobile":
      return (
        <DataGridCell
          align="center"
          className="tabular-nums"
          title={
            row.mobile2 ? `휴대폰번호2: ${formatPhone(row.mobile2)}` : undefined
          }
          {...marks}
        >
          {row.mobile ? formatPhone(row.mobile) : EMPTY_VALUE}
          {row.mobile2 && (
            <span className="ml-1 text-xs text-muted-foreground">외 1</span>
          )}
        </DataGridCell>
      )
    case "address":
      return (
        <DataGridCell
          className="max-w-96 truncate"
          title={
            row.address
              ? `${row.postalCode ? `(${row.postalCode}) ` : ""}${row.address}`
              : undefined
          }
          {...marks}
        >
          {row.address ?? EMPTY_VALUE}
        </DataGridCell>
      )
    case "department":
      return (
        <DataGridCell
          align="center"
          className="max-w-40 truncate"
          title={row.department ?? undefined}
          {...marks}
        >
          {row.department ?? EMPTY_VALUE}
        </DataGridCell>
      )
    case "job_title":
      return (
        <DataGridCell
          align="center"
          className="max-w-40 truncate"
          title={row.jobTitle ?? undefined}
          {...marks}
        >
          {row.jobTitle ?? EMPTY_VALUE}
        </DataGridCell>
      )
    case "employment_type":
      return (
        <DataGridCell align="center" {...marks}>
          {row.employmentType
            ? employmentTypeLabel(row.employmentType)
            : EMPTY_VALUE}
        </DataGridCell>
      )
    case "sales_rep":
      return <YesNoCell value={row.isSalesRep} {...marks} />
    case "delivery_driver":
      return <YesNoCell value={row.isDeliveryDriver} {...marks} />
    case "operation_type":
      return (
        <DataGridCell
          align="center"
          title={
            row.vehicleType
              ? `차량 종류: ${vehicleTypeLabel(row.vehicleType)}`
              : undefined
          }
          {...marks}
        >
          {row.driverOperationType
            ? driverOperationTypeLabel(row.driverOperationType)
            : EMPTY_VALUE}
        </DataGridCell>
      )
    case "vehicle_number":
      return (
        <DataGridCell
          align="center"
          title={
            row.vehicleType
              ? `차량 종류: ${vehicleTypeLabel(row.vehicleType)}`
              : undefined
          }
          {...marks}
        >
          {row.vehicleNumber ?? EMPTY_VALUE}
        </DataGridCell>
      )
    case "status":
      return (
        <DataGridCell
          align="center"
          className={cn(!row.isActive && "font-bold text-destructive")}
          {...marks}
        >
          {employeeStatusLabel(row.isActive)}
        </DataGridCell>
      )
    case "hire_date":
      return (
        <DataGridCell align="center" className="tabular-nums" {...marks}>
          {row.hireDate}
        </DataGridCell>
      )
    case "resignation_date":
      return (
        <DataGridCell align="center" className="tabular-nums" {...marks}>
          {row.resignationDate ?? EMPTY_VALUE}
        </DataGridCell>
      )
    case "salary":
      return <YesNoCell value={row.isSalaryPaid} {...marks} />
    case "partner_count":
      return <PartnerCountCell row={row} {...marks} />
  }
}

/**
 * 담당 거래처 수: partners with this employee as 영업담당 or 배송담당
 * (사용 and 미사용, each once). When the employee is only one kind of
 * 담당 for them, the number links to 거래처관리 filtered by that 담당.
 */
function PartnerCountCell({
  row,
  ...marks
}: { row: EmployeeListRow } & CellMarks) {
  const breakdown = `영업담당 ${formatNumber(row.salesPartnerCount, 0)}곳 · 배송담당 ${formatNumber(row.deliveryPartnerCount, 0)}곳 (미사용 거래처 포함)`
  let href: string | null = null
  let label = ""
  if (row.salesPartnerCount > 0 && row.deliveryPartnerCount === 0) {
    href = buildPartnerListHref({
      ...defaultPartnerListParams,
      salesRepId: row.id,
      status: "all",
    })
    label = `${row.name}이(가) 영업담당인 거래처 보기`
  } else if (row.deliveryPartnerCount > 0 && row.salesPartnerCount === 0) {
    href = buildPartnerListHref({
      ...defaultPartnerListParams,
      deliveryRepId: row.id,
      status: "all",
    })
    label = `${row.name}이(가) 배송담당인 거래처 보기`
  }

  return (
    <DataGridCell numeric title={breakdown} {...marks}>
      {href ? (
        <Link
          href={href}
          // Many of these links are on the page: load 거래처관리 on click only.
          prefetch={false}
          aria-label={`${label} (${formatNumber(row.partnerCount, 0)}곳)`}
          className="rounded-sm underline underline-offset-4 outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
        >
          {formatNumber(row.partnerCount, 0)}
        </Link>
      ) : (
        formatNumber(row.partnerCount, 0)
      )}
    </DataGridCell>
  )
}
