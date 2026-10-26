import Link from "next/link"

import { stockDocumentHref } from "@/components/inventory/document-screens"
import { ScheduledBadge } from "@/components/inventory/scheduled-badge"
import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridEmpty,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { EMPTY_VALUE, formatNumber } from "@/lib/format"
import {
  disposalReasonLabel,
  expiryKindLabel,
  movementLabel,
  type StockDocumentType,
} from "@/lib/inventory/constants"
import type { StockLedger, StockLedgerLine } from "@/lib/inventory/queries"
import { todayInKorea } from "@/lib/inventory/schema"
import { cn } from "@/lib/utils"

/** Number of columns (for the full-width empty row). */
const COLUMN_COUNT = 12

/** Tooltip of a line whose 전표 was undone on its own date. */
const SAME_DAY_CANCELLED_TITLE =
  "같은 날 취소된 전표의 줄입니다. 그날 재고에 영향이 없어 잔량이 바뀌지 않습니다 (예: 고객이 취소한 내일 새벽배송 출고)."

/** Badge colors of the 구분 column. */
const TYPE_CLASSES: Record<StockDocumentType, string> = {
  opening: "bg-brand-tint text-brand-active",
  receipt: "bg-brand-tint text-brand-active",
  issue: "bg-label text-foreground",
  disposal: "bg-destructive/10 text-destructive",
  transfer: "bg-label text-muted-foreground",
  count: "bg-chart-4/30 text-foreground",
  reversal: "bg-destructive/10 text-destructive",
}

/**
 * 상품별 거래수불 as a dense grid: the 이월 line (stock at the end of the
 * day before the 조회기간), every ledger line in date order with its 잔량,
 * and a 합계 line (sticky at the bottom). The 전표번호 opens that 전표 on
 * its screen (보기 window with [취소]). Lines dated after today (예정
 * 전표, e.g. tomorrow's 새벽배송 출고) carry an "예정" badge. Lines of a
 * 전표 undone on its own date (and its 취소 lines) are marked "당일취소"
 * and leave the 잔량 unchanged (the database's rule, see
 * stock_history_lines).
 */
export function LedgerGrid({ ledger }: { ledger: StockLedger }) {
  const unit = ledger.product.unit
  const today = todayInKorea()
  const totalClass =
    "sticky bottom-0 z-[5] border-t-2 border-t-foreground/70 bg-label font-bold"

  return (
    <DataGrid
      aria-label={`${ledger.product.name} 거래수불`}
      containerClassName="max-h-[max(22rem,calc(100svh-27rem))]"
      className="min-w-[92rem]"
    >
      <DataGridHeader>
        <tr>
          <DataGridHead className="w-32">일자</DataGridHead>
          <DataGridHead className="w-40">전표번호</DataGridHead>
          <DataGridHead className="w-24">구분</DataGridHead>
          <DataGridHead className="min-w-32">거래처</DataGridHead>
          <DataGridHead className="w-32">로트번호</DataGridHead>
          <DataGridHead className="w-36">기한</DataGridHead>
          <DataGridHead className="min-w-52">위치</DataGridHead>
          <DataGridHead className="w-24">입고</DataGridHead>
          <DataGridHead className="w-24">출고</DataGridHead>
          <DataGridHead className="w-28">잔량</DataGridHead>
          <DataGridHead className="w-28">단가(부가세포함)</DataGridHead>
          <DataGridHead className="min-w-56">메모</DataGridHead>
        </tr>
      </DataGridHeader>
      <DataGridBody>
        <DataGridRow className="bg-label even:bg-label hover:bg-label">
          <DataGridCell align="center" className="tabular-nums">
            {ledger.dateFrom}
          </DataGridCell>
          <DataGridCell />
          <DataGridCell align="center" className="font-bold">
            이월
          </DataGridCell>
          <DataGridCell />
          <DataGridCell />
          <DataGridCell />
          <DataGridCell className="text-muted-foreground">
            조회 시작일 전날까지의 재고
          </DataGridCell>
          <DataGridCell />
          <DataGridCell />
          <DataGridCell numeric className="font-bold">
            {formatNumber(ledger.openingQty, 3)}
          </DataGridCell>
          <DataGridCell />
          <DataGridCell />
        </DataGridRow>
        {ledger.lines.length === 0 && (
          <DataGridEmpty colSpan={COLUMN_COUNT}>
            조회기간에 입출고가 없습니다.
          </DataGridEmpty>
        )}
        {ledger.lines.map((line) => (
          <LedgerRow key={line.movementId} line={line} today={today} />
        ))}
      </DataGridBody>
      <tfoot>
        <tr>
          <DataGridCell align="center" className={totalClass}>
            {ledger.dateTo}
          </DataGridCell>
          <DataGridCell className={totalClass} />
          <DataGridCell align="center" className={totalClass}>
            합계
          </DataGridCell>
          <DataGridCell className={totalClass} colSpan={4}>
            <span className="text-xs font-normal text-muted-foreground">
              입고·출고는 조회기간 합계, 잔량은 기말재고 ({unit})
            </span>
          </DataGridCell>
          <DataGridCell numeric className={totalClass}>
            {formatNumber(ledger.inQty, 3)}
          </DataGridCell>
          <DataGridCell numeric className={totalClass}>
            {formatNumber(ledger.outQty, 3)}
          </DataGridCell>
          <DataGridCell numeric className={totalClass}>
            {formatNumber(ledger.closingQty, 3)}
          </DataGridCell>
          <DataGridCell className={totalClass} colSpan={2} />
        </tr>
      </tfoot>
    </DataGrid>
  )
}

/** One ledger line. */
function LedgerRow({ line, today }: { line: StockLedgerLine; today: string }) {
  const kind = movementLabel(line.movementType, line.isReversal)
  const memo = [
    line.reason ? `사유: ${disposalReasonLabel(line.reason)}` : null,
    line.bundleName ? `묶음상품: ${line.bundleName}` : null,
    line.memo,
  ]
    .filter(Boolean)
    .join(" / ")
  const place = `${line.warehouseName} > ${line.zoneName} > ${line.locationCode}`
  // movementType: the kind it counts as (a 취소 line: the kind it undoes),
  // so a 취소 전표 opens on the screen of the 전표 it undid.
  const documentHref = stockDocumentHref(line.movementType, line.documentId)
  return (
    <DataGridRow>
      <DataGridCell align="center" className="tabular-nums">
        <span className="inline-flex items-center gap-1">
          {line.docDate}
          <ScheduledBadge date={line.docDate} today={today} />
        </span>
      </DataGridCell>
      <DataGridCell align="center" className="tabular-nums">
        {documentHref ? (
          <Link
            href={documentHref}
            prefetch={false}
            title="전표 보기"
            className="rounded-sm underline underline-offset-4 outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
          >
            {line.docNo}
          </Link>
        ) : (
          line.docNo
        )}
      </DataGridCell>
      <DataGridCell align="center">
        <span className="inline-flex items-center gap-1">
          <span
            className={cn(
              "inline-flex h-5 items-center rounded-sm px-1.5 text-xs font-bold",
              TYPE_CLASSES[line.isReversal ? "reversal" : line.movementType]
            )}
          >
            {kind}
          </span>
          {line.sameDayCancelled && (
            <span
              title={SAME_DAY_CANCELLED_TITLE}
              className="text-[11px] whitespace-nowrap text-muted-foreground"
            >
              당일취소
            </span>
          )}
        </span>
      </DataGridCell>
      <DataGridCell
        className="max-w-48 truncate"
        title={
          line.partnerName
            ? `${line.partnerCode ?? ""} ${line.partnerName}`.trim()
            : undefined
        }
      >
        {line.partnerName ?? EMPTY_VALUE}
      </DataGridCell>
      <DataGridCell className="max-w-40 truncate tabular-nums">
        {line.lotNo}
      </DataGridCell>
      <DataGridCell align="center" className="tabular-nums">
        {line.expiryDate
          ? `${expiryKindLabel(line.expiryKind)} ${line.expiryDate}`
          : "기한 없음"}
      </DataGridCell>
      <DataGridCell
        className="max-w-72 truncate"
        title={line.locationName ? `${place} (${line.locationName})` : place}
      >
        {place}
      </DataGridCell>
      <DataGridCell
        numeric
        className={cn(line.sameDayCancelled && "text-muted-foreground")}
      >
        {line.inQty !== 0 ? formatNumber(line.inQty, 3) : ""}
      </DataGridCell>
      <DataGridCell
        numeric
        className={cn(line.sameDayCancelled && "text-muted-foreground")}
      >
        {line.outQty !== 0 ? formatNumber(line.outQty, 3) : ""}
      </DataGridCell>
      <DataGridCell
        numeric
        className="font-bold"
        title={line.sameDayCancelled ? SAME_DAY_CANCELLED_TITLE : undefined}
      >
        {formatNumber(line.balance, 3)}
      </DataGridCell>
      <DataGridCell numeric>
        {line.unitCostInclVat === null
          ? EMPTY_VALUE
          : formatNumber(line.unitCostInclVat, 0)}
      </DataGridCell>
      <DataGridCell className="max-w-96 truncate" title={memo || undefined}>
        {memo || EMPTY_VALUE}
      </DataGridCell>
    </DataGridRow>
  )
}
