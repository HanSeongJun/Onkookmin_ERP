import {
  DEFAULT_EXPIRY_WARNING_DAYS,
  EXPIRY_STATUS_LABELS,
  expiryKindLabel,
  formatDaysLeft,
  type ExpiryKind,
  type ExpiryStatus,
} from "@/lib/inventory/constants"
import { EMPTY_VALUE } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * 기한 상태 from the days left (same rule as expiryStatus /
 * lot_stock_items): < 0 기한 경과, 0..warningDays 기한 임박, more 정상,
 * null 기한 없음.
 */
export function expiryStatusOfDays(
  daysLeft: number | null | undefined,
  warningDays: number = DEFAULT_EXPIRY_WARNING_DAYS
): ExpiryStatus {
  if (daysLeft === null || daysLeft === undefined) return "none"
  if (daysLeft < 0) return "expired"
  if (daysLeft <= warningDays) return "imminent"
  return "ok"
}

const statusClasses: Record<ExpiryStatus, string> = {
  // White on --destructive: 5.62:1.
  expired: "border-destructive bg-destructive text-white",
  // Dark text on solid amber (#222 on #c9a227: 6.6:1), so it stands out
  // from the pale green 정상 badge (a pale amber looked almost the same).
  imminent: "border-chart-4 bg-chart-4 text-foreground",
  ok: "border-brand-border bg-brand-tint text-brand-active",
  none: "border-input bg-background text-muted-foreground",
}

/**
 * The D-day badge of a 기한일: "D-3" / "D-Day" / "D+2" (2 days past).
 * Colors: 기한 경과 solid red, 기한 임박 solid amber, 정상 light green; "-" without a
 * 기한. Pass `status` when the row has it (e.g. LotStockRow.expiryStatus);
 * otherwise it is worked out from `daysLeft` and `warningDays` (the 기한
 * 임박 기준일 setting).
 *
 * @example <ExpiryBadge daysLeft={row.daysLeft} status={row.expiryStatus} />
 * @example <ExpiryBadge daysLeft={allocation.daysLeft} warningDays={expiryWarningDays} />
 */
export function ExpiryBadge({
  daysLeft,
  status,
  warningDays,
  className,
}: {
  daysLeft: number | null | undefined
  status?: ExpiryStatus
  warningDays?: number
  className?: string
}) {
  const shown = status ?? expiryStatusOfDays(daysLeft, warningDays)
  if (shown === "none" || daysLeft === null || daysLeft === undefined) {
    return (
      <span className={cn("text-muted-foreground", className)}>
        {EMPTY_VALUE}
      </span>
    )
  }
  const label = formatDaysLeft(daysLeft)
  const title =
    shown === "expired"
      ? `기한 경과 ${-daysLeft}일`
      : daysLeft === 0
        ? "오늘이 기한일입니다"
        : `기한까지 ${daysLeft}일 남음`
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 min-w-12 items-center justify-center rounded-sm border px-1.5 text-xs font-bold tabular-nums",
        statusClasses[shown],
        className
      )}
    >
      {label}
      <span className="sr-only"> ({EXPIRY_STATUS_LABELS[shown]})</span>
    </span>
  )
}

/**
 * 기한 종류 + 기한일 + D-day badge in one cell: "소비기한 2026-10-30 D-7",
 * or "기한 없음".
 */
export function ExpiryText({
  kind,
  date,
  daysLeft,
  status,
  warningDays,
  className,
}: {
  kind: ExpiryKind
  date: string | null
  daysLeft: number | null | undefined
  status?: ExpiryStatus
  warningDays?: number
  className?: string
}) {
  if (kind === "none" || !date) {
    return (
      <span className={cn("text-muted-foreground", className)}>기한 없음</span>
    )
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="text-xs text-muted-foreground">
        {expiryKindLabel(kind)}
      </span>
      <span className="tabular-nums">{date}</span>
      <ExpiryBadge
        daysLeft={daysLeft}
        status={status}
        warningDays={warningDays}
      />
    </span>
  )
}
