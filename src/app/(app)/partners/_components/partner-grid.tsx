"use client"

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
import { EMPTY_VALUE, formatNumber } from "@/lib/format"
import { UNCATEGORIZED_PARTNER_LABEL } from "@/lib/partner-categories/schema"
import { formatBusinessNumber } from "@/lib/partners/business-number"
import {
  formatCreditLimit,
  formatPaymentTerm,
  partnerIndustryLabel,
  partnerTypeLabel,
  type PartnerType,
} from "@/lib/partners/constants"
import { formatPhone } from "@/lib/partners/phone"
import type { PartnerListRow } from "@/lib/partners/queries"
import {
  buildPartnerModalHref,
  nextPartnerColumnSort,
  partnerColumnTitle,
  partnerSortState,
  type PartnerColumnId,
  type PartnerListSort,
  type SortDirection,
} from "@/lib/partners/schema"
import { cn } from "@/lib/utils"

/** Width of each column (the column id is also its sort key). */
const COLUMN_CLASSES: Record<PartnerColumnId, string> = {
  type: "w-20",
  code: "w-28",
  name: "min-w-48",
  representative: "w-24",
  business_number: "w-28",
  phone: "w-32",
  sales_rep: "w-24",
  delivery_rep: "w-24",
  industry: "w-28",
  category: "min-w-40",
  address: "min-w-72",
  payment: "w-24",
  credit: "w-28",
  status: "w-20",
}

/** Data type of a column drag (not text, so it can't be dropped into a box). */
const DRAG_TYPE = "application/x-partner-grid-column"

/**
 * Where a dragged column would land: in front of `beforeId`, or at the end
 * (null). Undefined while it would not move (over its own place).
 */
type ColumnDrag = {
  id: PartnerColumnId
  beforeId: PartnerColumnId | null | undefined
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
 * The partner list as a dense ERP grid (same behaviour as the 상품 grid).
 *
 * - A click on a row makes it the current row (outlined); the checkbox (or
 *   Space on the current row) checks it for 선택 사용 / 선택 미사용.
 * - Double-click, Enter on the current row, or a click on the 거래처명
 *   opens the 거래처 수정 modal (Ctrl/⌘-click: in a new tab). Without
 *   `onOpen` (the 거래처분류설정 screen), the 거래처명 opens it in a new
 *   tab instead.
 * - ↑ / ↓ move the current row. The header checkbox checks all rows of the
 *   page.
 * - Column titles: a click sorts by that column (▲ 오름차순 → ▼ 내림차순 →
 *   back to 거래처코드순; on the server, across all pages). Dragging a
 *   title (or Alt+← / Alt+→ on a focused title) moves the column; the
 *   order is `columnOrder`, kept by the list screen. `columnOrder` may
 *   hold only some of the columns (the 거래처분류설정 screen shows 7).
 */
export function PartnerGrid({
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
  columnTitle = partnerColumnTitle,
  ariaLabel = "거래처 목록",
  className,
  containerClassName = "max-h-[max(20rem,calc(100svh-29rem))]",
}: {
  rows: PartnerListRow[]
  checkedIds: Set<string>
  onCheckedIdsChange: (ids: Set<string>) => void
  /** The current (outlined) row, or null for none. */
  activeId: string | null
  onActiveIdChange: (id: string) => void
  /**
   * Opens the 거래처 수정 modal for this partner. Without it, the 거래처명
   * is a link that opens the modal on 거래처관리 in a new tab.
   */
  onOpen?: (id: string) => void
  /** Shown in the grid when `rows` is empty. */
  empty: React.ReactNode
  /** Every column id in the order to show them. */
  columnOrder: PartnerColumnId[]
  onColumnOrderChange: (order: PartnerColumnId[]) => void
  /** The list's sort (shown on the column titles). */
  sort: PartnerListSort
  onSortChange: (sort: PartnerListSort) => void
  /** Title of a column (e.g. "적용분류" instead of "거래처분류"). */
  columnTitle?: (id: PartnerColumnId) => string
  ariaLabel?: string
  /** Classes of the table, e.g. its minimum width. */
  className?: string
  /** Classes of the scrolling box (its height). */
  containerClassName?: string
}) {
  const hintId = useId()
  const tableRef = useRef<HTMLTableElement>(null)
  const [drag, setDrag] = useState<ColumnDrag | null>(null)
  // The dragged column, known right away (the state follows a moment later).
  const dragIdRef = useRef<PartnerColumnId | null>(null)
  // The title to focus again after Alt+← / Alt+→ moved its column.
  const refocusIdRef = useRef<PartnerColumnId | null>(null)
  // Read by screen readers after a column moved.
  const [announcement, setAnnouncement] = useState("")

  const sortState = partnerSortState(sort)
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
    row: PartnerListRow
  ) {
    // Only keys pressed on the row itself (not in its checkbox or link).
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter") {
      if (!onOpen) return
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

  function moveTo(id: PartnerColumnId, beforeId: PartnerColumnId | null) {
    const next = moveColumn(columnOrder, id, beforeId)
    onColumnOrderChange(next)
    const place = next.indexOf(id) + 1
    setAnnouncement(
      `${columnTitle(id)} 열을 ${next.length}개 중 ${place}번째로 옮겼습니다.`
    )
  }

  /** Whether dropping `id` in front of `beforeId` changes the order. */
  function changesOrder(id: PartnerColumnId, beforeId: PartnerColumnId | null) {
    const index = columnOrder.indexOf(id)
    const next =
      beforeId === null ? columnOrder.length : columnOrder.indexOf(beforeId)
    return next !== index && next !== index + 1
  }

  /** The column whose left half is under `clientX` (null = past the last). */
  function dropPositionAt(clientX: number): PartnerColumnId | null {
    const heads =
      tableRef.current?.querySelectorAll<HTMLElement>(
        "thead [data-column-id]"
      ) ?? []
    for (const head of heads) {
      const box = head.getBoundingClientRect()
      if (clientX < box.left + box.width / 2) {
        return head.dataset.columnId as PartnerColumnId
      }
    }
    return null
  }

  function startDrag(event: React.DragEvent<HTMLElement>, id: PartnerColumnId) {
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
    id: PartnerColumnId
  ) {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    // Also keeps the browser from going back a page (Alt+←).
    event.preventDefault()
    const index = columnOrder.indexOf(id)
    const title = columnTitle(id)
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
  function marks(id: PartnerColumnId): CellMarks {
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
        aria-label={ariaLabel}
        // The grid fills the rest of the screen, so the page itself doesn't
        // scroll (the search form has up to 4 rows on laptop screens).
        containerClassName={containerClassName}
        // Wide enough for every column; an empty grid fits the box so its
        // message stays in view.
        className={cn(
          rows.length > 0 && (className ?? "min-w-[110rem]"),
          DRAG_STYLES
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <DataGridHeader>
          <tr>
            <DataGridHead className="w-9">
              <DataGridCheckbox
                inHeader
                aria-label="이 페이지의 거래처 모두 선택"
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
                title={columnTitle(id)}
                direction={
                  sortState?.column === id ? sortState.direction : null
                }
                hintId={hintId}
                onSort={() => onSortChange(nextPartnerColumnSort(sort, id))}
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
            // +1: the checkbox column.
            <DataGridEmpty colSpan={columnOrder.length + 1}>
              {empty}
            </DataGridEmpty>
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
                  if (!onOpen) return
                  // Not when double-clicking the checkbox.
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
                  <PartnerCell
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
  title,
  direction,
  hintId,
  onSort,
  onDragStart,
  onDragEnd,
  onMoveKeyDown,
  ...marks
}: {
  columnId: PartnerColumnId
  title: string
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
        {title}
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

/** 구분 cell: 매출처 / 매입처 / 매출·매입 as a small badge. */
function PartnerTypeBadge({ partnerType }: { partnerType: PartnerType }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm border px-1.5 text-xs",
        partnerType === "sales" &&
          "border-grid-line bg-background text-muted-foreground",
        partnerType === "purchase" &&
          "border-brand-border bg-brand-tint font-bold text-brand-active",
        partnerType === "both" &&
          "border-brand bg-brand font-bold text-brand-foreground"
      )}
    >
      {partnerTypeLabel(partnerType)}
    </span>
  )
}

/** " (퇴사)" after an employee or category that can't be newly chosen. */
function InactiveNote({ label }: { label: string }) {
  return <span className="ml-1 text-xs text-muted-foreground">({label})</span>
}

/**
 * 영업담당 / 배송담당 cell: the employee's name, plus "(퇴사)" or
 * "(영업담당 해제)" when the partner keeps an employee who can no longer be
 * newly chosen for it.
 */
function RepCell({
  name,
  isActive,
  hasDuty,
  dutyLabel,
  ...marks
}: {
  name: string | null
  isActive: boolean | null
  hasDuty: boolean | null
  /** "영업담당" or "배송담당". */
  dutyLabel: string
} & CellMarks) {
  const notes = [
    isActive === false ? "퇴사" : null,
    hasDuty === false ? `${dutyLabel} 해제` : null,
  ].filter((note) => note !== null)
  return (
    <DataGridCell
      align="center"
      className="max-w-40 truncate"
      title={
        notes.length > 0
          ? `${name} (${notes.join(", ")}): 거래처에 그대로 남아 있지만 새로 고를 수는 없는 직원입니다.`
          : (name ?? undefined)
      }
      {...marks}
    >
      {name ?? EMPTY_VALUE}
      {notes.length > 0 && <InactiveNote label={notes.join(", ")} />}
    </DataGridCell>
  )
}

/** One body cell (data-* attributes: drag marks). */
function PartnerCell({
  row,
  column,
  onOpen,
  ...marks
}: {
  row: PartnerListRow
  column: PartnerColumnId
  onOpen?: (id: string) => void
} & CellMarks) {
  switch (column) {
    case "type":
      return (
        <DataGridCell align="center" className="px-1" {...marks}>
          <PartnerTypeBadge partnerType={row.partnerType} />
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
        <DataGridCell
          className="max-w-64 truncate"
          title={
            row.companyName && row.companyName !== row.name
              ? `${row.name} (상호: ${row.companyName})`
              : row.name
          }
          {...marks}
        >
          <a
            href={buildPartnerModalHref("", { mode: "edit", id: row.id })}
            // Without onOpen (거래처분류설정): 거래처관리 in a new tab.
            target={onOpen ? undefined : "_blank"}
            rel={onOpen ? undefined : "noopener"}
            title={onOpen ? undefined : "거래처 수정 창이 새 탭에서 열립니다"}
            onClick={(event) => {
              if (!onOpen) return
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
    case "representative":
      return (
        <DataGridCell
          align="center"
          className="max-w-32 truncate"
          title={row.representative ?? undefined}
          {...marks}
        >
          {row.representative ?? EMPTY_VALUE}
        </DataGridCell>
      )
    case "business_number":
      return (
        <DataGridCell align="center" className="tabular-nums" {...marks}>
          {row.businessNumber
            ? formatBusinessNumber(row.businessNumber)
            : EMPTY_VALUE}
        </DataGridCell>
      )
    case "phone":
      return (
        <DataGridCell align="center" className="tabular-nums" {...marks}>
          {row.phone ? formatPhone(row.phone) : EMPTY_VALUE}
        </DataGridCell>
      )
    case "sales_rep":
      return (
        <RepCell
          name={row.salesRepName}
          isActive={row.salesRepIsActive}
          hasDuty={row.salesRepHasDuty}
          dutyLabel="영업담당"
          {...marks}
        />
      )
    case "delivery_rep":
      return (
        <RepCell
          name={row.deliveryRepName}
          isActive={row.deliveryRepIsActive}
          hasDuty={row.deliveryRepHasDuty}
          dutyLabel="배송담당"
          {...marks}
        />
      )
    case "industry":
      return (
        <DataGridCell align="center" {...marks}>
          {row.industry ? partnerIndustryLabel(row.industry) : EMPTY_VALUE}
        </DataGridCell>
      )
    case "category":
      // The whole path: "대분류 > 중분류 > 소분류" (or 미분류).
      return (
        <DataGridCell
          className={cn(
            "max-w-72 truncate",
            row.categoryId === null && "text-center text-muted-foreground"
          )}
          title={
            row.categoryId === null
              ? undefined
              : row.categoryIsActive === false
                ? `${row.categoryPath ?? row.categoryName ?? ""} (사용 중지된 분류: 이 거래처에는 남아 있지만 새로 고를 수는 없습니다)`
                : (row.categoryPath ?? row.categoryName ?? undefined)
          }
          {...marks}
        >
          {row.categoryId === null
            ? UNCATEGORIZED_PARTNER_LABEL
            : (row.categoryPath ?? row.categoryName ?? EMPTY_VALUE)}
          {row.categoryIsActive === false && <InactiveNote label="사용 중지" />}
        </DataGridCell>
      )
    case "address":
      return (
        <DataGridCell
          className="max-w-96 truncate"
          title={addressTitle(row)}
          {...marks}
        >
          {row.defaultAddress ?? EMPTY_VALUE}
          {row.addressCount > 1 && (
            <span className="ml-1 text-xs text-muted-foreground">
              외 {formatNumber(row.addressCount - 1, 0)}곳
            </span>
          )}
        </DataGridCell>
      )
    case "payment":
      return (
        <DataGridCell
          align="center"
          className={cn(
            row.paymentTerm === "unspecified" && "text-muted-foreground"
          )}
          {...marks}
        >
          {formatPaymentTerm(row.paymentTerm, row.paymentDay)}
        </DataGridCell>
      )
    case "credit":
      return (
        <DataGridCell
          numeric
          className={cn(row.creditLimitType === "none" && "font-bold")}
          {...marks}
        >
          {formatCreditLimit(row.creditLimitType, row.creditLimit)}
        </DataGridCell>
      )
    case "status":
      return (
        <DataGridCell
          align="center"
          className={cn(!row.isActive && "font-bold text-destructive")}
          {...marks}
        >
          {row.isActive ? "사용" : "미사용"}
        </DataGridCell>
      )
  }
}

/** Tooltip of the 기본 배송지 cell: "[본점] (04536) 서울 …". */
function addressTitle(row: PartnerListRow): string | undefined {
  if (!row.defaultAddress) return undefined
  const label = row.defaultAddressLabel ? `[${row.defaultAddressLabel}] ` : ""
  const postal = row.defaultPostalCode ? `(${row.defaultPostalCode}) ` : ""
  const more =
    row.addressCount > 1
      ? ` — 배송지 ${formatNumber(row.addressCount, 0)}곳 중 기본`
      : ""
  return `${label}${postal}${row.defaultAddress}${more}`
}
