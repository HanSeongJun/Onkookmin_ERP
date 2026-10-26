import { isScheduledDate } from "@/lib/inventory/constants"
import { cn } from "@/lib/utils"

/**
 * "예정" next to the date of a 전표 (or a ledger line, or a lot's 입고일)
 * dated after today, e.g. tomorrow's 새벽배송 출고. Its stock is already
 * counted in 재고처별 재고현황. Renders nothing for today or earlier.
 *
 * @example <ScheduledBadge date={row.docDate} today={today} />
 */
export function ScheduledBadge({
  date,
  today,
  title = "오늘 이후 날짜의 예정 전표입니다. 재고 수량(재고처별 재고현황)에는 이미 반영되어 있습니다.",
  className,
}: {
  date: string | null | undefined
  /** Today in Korea ("YYYY-MM-DD"). */
  today: string
  title?: string
  className?: string
}) {
  if (!isScheduledDate(date, today)) return null
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-4 shrink-0 items-center rounded-sm border border-dashed border-brand bg-background px-1 text-[11px] leading-none font-bold text-brand",
        className
      )}
    >
      예정
    </span>
  )
}
