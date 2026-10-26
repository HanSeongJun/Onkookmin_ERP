"use client"

import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridEmpty,
  DataGridHead,
  DataGridHeadGroup,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { EMPTY_VALUE, formatDateTime, formatNumber } from "@/lib/format"
import { ScheduledBadge } from "@/components/inventory/scheduled-badge"
import type { StockDocumentRow } from "@/lib/inventory/queries"
import { todayInKorea } from "@/lib/inventory/schema"
import { cn } from "@/lib/utils"

const COLUMN_COUNT = 10

/**
 * The 실사조정 전표 grid: one row per 전표 (newest first), 취소 전표 too.
 * A click marks the row; a double-click, Enter or the 전표번호 opens it.
 */
export function CountDocumentGrid({
  rows,
  activeId,
  onActiveIdChange,
  onOpen,
  empty,
}: {
  rows: StockDocumentRow[]
  activeId: string | null
  onActiveIdChange: (id: string) => void
  onOpen: (id: string) => void
  /** Shown inside the grid when there are no rows. */
  empty: React.ReactNode
}) {
  // The row reached with Tab: the current row, or the first one.
  const focusId =
    activeId && rows.some((row) => row.id === activeId)
      ? activeId
      : (rows[0]?.id ?? null)

  function focusRow(element: Element | null | undefined) {
    if (element instanceof HTMLElement) element.focus()
  }
  const today = todayInKorea()

  return (
    <DataGrid
      aria-label="실사조정 전표 목록"
      containerClassName="max-h-[calc(100svh-22rem)] min-h-48"
      className={rows.length > 0 ? "min-w-[64rem]" : undefined}
    >
      <DataGridHeader>
        <tr>
          <DataGridHead rowSpan={2} className="w-32">
            전표일자
          </DataGridHead>
          <DataGridHead rowSpan={2} className="w-36">
            전표번호
          </DataGridHead>
          <DataGridHead rowSpan={2} className="w-24">
            구분
          </DataGridHead>
          <DataGridHead rowSpan={2} className="min-w-44">
            상품
          </DataGridHead>
          <DataGridHead rowSpan={2} className="w-14">
            줄 수
          </DataGridHead>
          <DataGridHeadGroup colSpan={2}>
            조정 금액 (부가세 포함)
          </DataGridHeadGroup>
          <DataGridHead rowSpan={2} className="w-40">
            상태
          </DataGridHead>
          <DataGridHead rowSpan={2} className="min-w-40">
            사유
          </DataGridHead>
          <DataGridHead rowSpan={2} className="w-32">
            등록일시
          </DataGridHead>
        </tr>
        <tr>
          <DataGridHead subHead className="w-28">
            늘어남 (+)
          </DataGridHead>
          <DataGridHead subHead className="w-28">
            줄어듦 (−)
          </DataGridHead>
        </tr>
      </DataGridHeader>
      <DataGridBody>
        {rows.length === 0 && (
          <DataGridEmpty colSpan={COLUMN_COUNT}>{empty}</DataGridEmpty>
        )}
        {rows.map((row) => {
          const isReversal = row.docType === "reversal"
          const isActive = row.id === activeId
          return (
            <DataGridRow
              key={row.id}
              selected={isActive}
              tabIndex={row.id === focusId ? 0 : -1}
              aria-label={`${row.docNo} ${row.docDate}`}
              onClick={() => onActiveIdChange(row.id)}
              onFocus={(event) => {
                if (event.target === event.currentTarget) {
                  onActiveIdChange(row.id)
                }
              }}
              onDoubleClick={() => onOpen(row.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === "Enter") {
                  event.preventDefault()
                  onOpen(row.id)
                } else if (event.key === "ArrowDown") {
                  event.preventDefault()
                  focusRow(event.currentTarget.nextElementSibling)
                } else if (event.key === "ArrowUp") {
                  event.preventDefault()
                  focusRow(event.currentTarget.previousElementSibling)
                }
              }}
              className={cn(
                "cursor-default outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                (isReversal || row.reversedById) && "text-muted-foreground"
              )}
            >
              <DataGridCell align="center" className="tabular-nums">
                <span className="inline-flex items-center gap-1">
                  {row.docDate}
                  <ScheduledBadge date={row.docDate} today={today} />
                </span>
              </DataGridCell>
              <DataGridCell align="center">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => onOpen(row.id)}
                  className="rounded-sm font-bold text-brand tabular-nums underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {row.docNo}
                </button>
              </DataGridCell>
              <DataGridCell align="center">
                {isReversal ? (
                  <span className="rounded-sm border border-destructive px-1 text-xs font-bold text-destructive">
                    실사조정 취소
                  </span>
                ) : (
                  "실사조정"
                )}
              </DataGridCell>
              <DataGridCell
                className="max-w-64 truncate"
                title={productSummary(row) ?? undefined}
              >
                {productSummary(row) ?? EMPTY_VALUE}
              </DataGridCell>
              <DataGridCell numeric>
                {formatNumber(row.lineCount, 0)}
              </DataGridCell>
              <DataGridCell numeric>
                <Amount value={row.valueInInclVat} unknown={row.costUnknown} />
              </DataGridCell>
              <DataGridCell numeric>
                <Amount value={row.valueOutInclVat} unknown={row.costUnknown} />
              </DataGridCell>
              <DataGridCell align="center">
                <StatusText row={row} />
              </DataGridCell>
              <DataGridCell
                className="max-w-72 truncate"
                title={row.memo ?? ""}
              >
                {row.memo ?? EMPTY_VALUE}
              </DataGridCell>
              <DataGridCell align="center" className="tabular-nums">
                {formatDateTime(row.createdAt)}
              </DataGridCell>
            </DataGridRow>
          )
        })}
      </DataGridBody>
    </DataGrid>
  )
}

/** "양배추 외 2건". */
function productSummary(row: StockDocumentRow): string | null {
  if (!row.firstProductName) return null
  return row.productCount > 1
    ? `${row.firstProductName} 외 ${formatNumber(row.productCount - 1, 0)}건`
    : row.firstProductName
}

/** An amount; "*" when lots without a 입고 단가 were left out of it. */
function Amount({ value, unknown }: { value: number; unknown: boolean }) {
  return (
    <span
      title={
        unknown ? "입고 단가가 없는 로트는 금액에서 빠졌습니다." : undefined
      }
    >
      {value === 0 ? EMPTY_VALUE : formatNumber(value, 0)}
      {unknown && <span className="ml-0.5 text-muted-foreground">*</span>}
    </span>
  )
}

/** 정상 / 취소됨 (취소 전표번호) / "<원 전표번호> 취소". */
function StatusText({ row }: { row: StockDocumentRow }) {
  if (row.reversedByDocNo) {
    return (
      <span className="font-bold text-destructive">
        취소됨{" "}
        <span className="font-normal tabular-nums">
          ({row.reversedByDocNo})
        </span>
      </span>
    )
  }
  if (row.reversesDocNo) {
    return <span className="tabular-nums">{row.reversesDocNo} 취소</span>
  }
  return <span>정상</span>
}
