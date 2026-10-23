"use client"

import { cn } from "@/lib/utils"

import { quickRanges } from "./date-range"

/**
 * The quick period buttons of every 재고 search form: 오늘, 최근 7일,
 * 최근 30일, 이번 달, 지난 달 (quickRanges). The one matching the shown
 * period is pressed (aria-pressed).
 */
export function QuickRangeButtons({
  today,
  from,
  to,
  onPick,
}: {
  /** Today in Korea ("YYYY-MM-DD"). */
  today: string
  /** The period shown now. */
  from: string
  to: string
  onPick: (from: string, to: string) => void
}) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      {quickRanges(today).map((choice) => {
        const active = choice.from === from && choice.to === to
        return (
          <button
            key={choice.label}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(choice.from, choice.to)}
            className={cn(
              "h-7 rounded-sm border px-2 text-xs font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "border-brand bg-brand-tint text-brand-active"
                : "border-input bg-background hover:bg-muted"
            )}
          >
            {choice.label}
          </button>
        )
      })}
    </span>
  )
}
