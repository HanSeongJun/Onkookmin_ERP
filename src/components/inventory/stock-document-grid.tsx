"use client"

import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridEmpty,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import type { StockDocumentRow } from "@/lib/inventory/queries"
import { todayInKorea } from "@/lib/inventory/schema"
import { formatDateTime, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

import {
  stockDocumentKindLabel,
  stockDocumentProductsLabel,
  type StockDocumentAmountColumns,
} from "./document-screens"
import { ScheduledBadge } from "./scheduled-badge"

/** 정상 / 취소됨 / 취소 전표 of a row. */
export function StockDocumentStatus({
  row,
}: {
  row: Pick<StockDocumentRow, "docType" | "reversedByDocNo" | "reversesDocNo">
}) {
  if (row.reversedByDocNo) {
    return (
      <span
        className="font-bold text-destructive"
        title={`${row.reversedByDocNo} 로 취소되었습니다`}
      >
        취소됨
      </span>
    )
  }
  if (row.docType === "reversal") {
    return (
      <span
        className="text-muted-foreground"
        title={`${row.reversesDocNo ?? ""} 전표를 취소한 전표입니다`}
      >
        취소 전표
      </span>
    )
  }
  return <span>정상</span>
}

/**
 * The 전표 list of a 재고 screen: 전표일자, 전표번호 (opens the 전표),
 * 구분, 거래처 (when `partnerLabel`), 상품 ("… 외 N건"), 줄 수, 금액
 * (부가세 포함; in / out / both by `amount`), 상태, 메모, 등록일시.
 * A row opens with a click on its 전표번호, a double-click, or Enter.
 * 취소된 전표 and 취소 전표 are greyed.
 */
export function StockDocumentGrid({
  rows,
  partnerLabel,
  amount,
  activeId,
  onActiveIdChange,
  onOpen,
  empty,
}: {
  rows: StockDocumentRow[]
  partnerLabel: string | null
  amount: StockDocumentAmountColumns
  activeId: string | null
  onActiveIdChange: (id: string) => void
  onOpen: (id: string) => void
  empty: React.ReactNode
}) {
  const columnCount =
    8 +
    (partnerLabel ? 1 : 0) +
    (amount === "both" ? 2 : amount === "none" ? 0 : 1)
  const focusId =
    activeId && rows.some((row) => row.id === activeId)
      ? activeId
      : (rows[0]?.id ?? null)
  const today = todayInKorea()

  return (
    <DataGrid
      aria-label="전표 목록"
      containerClassName="max-h-[max(20rem,calc(100svh-22rem))]"
      className={rows.length > 0 ? "min-w-[64rem]" : undefined}
    >
      <DataGridHeader>
        <tr>
          <DataGridHead className="w-32">전표일자</DataGridHead>
          <DataGridHead className="w-40">전표번호</DataGridHead>
          <DataGridHead className="w-20">구분</DataGridHead>
          {partnerLabel && (
            <DataGridHead className="min-w-32">{partnerLabel}</DataGridHead>
          )}
          <DataGridHead className="min-w-56">상품</DataGridHead>
          <DataGridHead className="w-14">줄 수</DataGridHead>
          {amount === "in" && (
            <DataGridHead className="w-32">금액(부가세포함)</DataGridHead>
          )}
          {amount === "out" && (
            <DataGridHead className="w-32">금액(부가세포함)</DataGridHead>
          )}
          {amount === "both" && (
            <>
              <DataGridHead className="w-28">증가 금액</DataGridHead>
              <DataGridHead className="w-28">감소 금액</DataGridHead>
            </>
          )}
          <DataGridHead className="w-20">상태</DataGridHead>
          <DataGridHead className="min-w-40">메모</DataGridHead>
          <DataGridHead className="w-32">등록일시</DataGridHead>
        </tr>
      </DataGridHeader>
      <DataGridBody>
        {rows.length === 0 ? (
          <DataGridEmpty colSpan={columnCount}>{empty}</DataGridEmpty>
        ) : (
          rows.map((row) => {
            const greyed =
              row.reversedById !== null || row.docType === "reversal"
            const value =
              amount === "in"
                ? row.valueInInclVat
                : amount === "out"
                  ? row.valueOutInclVat
                  : null
            return (
              <DataGridRow
                key={row.id}
                selected={row.id === activeId}
                tabIndex={row.id === focusId ? 0 : -1}
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
                    const next = event.currentTarget.nextElementSibling
                    if (next instanceof HTMLElement) next.focus()
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault()
                    const previous = event.currentTarget.previousElementSibling
                    if (previous instanceof HTMLElement) previous.focus()
                  }
                }}
                className={cn(
                  "cursor-default outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                  greyed && "text-muted-foreground"
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
                    className={cn(
                      "font-bold tabular-nums underline-offset-2 outline-none hover:underline focus-visible:underline",
                      greyed ? "text-muted-foreground" : "text-brand"
                    )}
                  >
                    {row.docNo}
                  </button>
                </DataGridCell>
                <DataGridCell align="center">
                  {stockDocumentKindLabel(row)}
                </DataGridCell>
                {partnerLabel && (
                  <DataGridCell
                    className="max-w-48 truncate"
                    title={row.partnerName ?? undefined}
                  >
                    {row.partnerName ?? "-"}
                  </DataGridCell>
                )}
                <DataGridCell
                  className="max-w-80 truncate"
                  title={stockDocumentProductsLabel(row)}
                >
                  {stockDocumentProductsLabel(row)}
                </DataGridCell>
                <DataGridCell numeric>
                  {formatNumber(row.lineCount, 0)}
                </DataGridCell>
                {value !== null && (
                  <DataGridCell numeric>
                    <AmountText value={value} costUnknown={row.costUnknown} />
                  </DataGridCell>
                )}
                {amount === "both" && (
                  <>
                    <DataGridCell numeric>
                      <AmountText
                        value={row.valueInInclVat}
                        costUnknown={row.costUnknown}
                      />
                    </DataGridCell>
                    <DataGridCell numeric>
                      <AmountText
                        value={row.valueOutInclVat}
                        costUnknown={row.costUnknown}
                      />
                    </DataGridCell>
                  </>
                )}
                <DataGridCell align="center">
                  <StockDocumentStatus row={row} />
                </DataGridCell>
                <DataGridCell
                  className="max-w-64 truncate"
                  title={row.memo ?? undefined}
                >
                  {row.memo ?? ""}
                </DataGridCell>
                <DataGridCell align="center" className="tabular-nums">
                  {formatDateTime(row.createdAt)}
                </DataGridCell>
              </DataGridRow>
            )
          })
        )}
      </DataGridBody>
    </DataGrid>
  )
}

/** An amount; "*" when lots without 입고 단가 were left out of it. */
function AmountText({
  value,
  costUnknown,
}: {
  value: number
  costUnknown: boolean
}) {
  return (
    <span
      title={
        costUnknown
          ? "입고 단가를 모르는 로트가 있어 그 금액은 빠졌습니다."
          : undefined
      }
    >
      {formatNumber(value, 0)}
      {costUnknown && <span className="ml-0.5 text-muted-foreground">*</span>}
    </span>
  )
}
