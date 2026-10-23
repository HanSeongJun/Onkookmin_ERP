/**
 * Calendar-date helpers for the 재고 screens ("YYYY-MM-DD", Korea dates).
 * Client-safe.
 */

import { todayInKorea } from "@/lib/inventory/schema"

/**
 * The date `days` days after (or before, when negative) `date`.
 * @example addDays("2026-10-23", -30) // "2026-09-23"
 */
export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/**
 * Classes of the date boxes of every 재고 search form (조회기간, 전표일자):
 * one width everywhere, wide enough for the whole date with the calendar
 * icon at a phone's 16px text.
 */
export const DATE_FILTER_INPUT_CLASS = "h-8 w-38 rounded-sm tabular-nums"

/** A quick choice of a period ([오늘], [최근 7일] …). */
export type QuickRange = { label: string; from: string; to: string }

/**
 * 오늘, 최근 7일, 최근 30일, 이번 달, 지난 달 (ending today, or last
 * month's end). "최근 N일" counts today: 최근 7일 = today − 6 … today.
 */
export function quickRanges(today: string = todayInKorea()): QuickRange[] {
  const firstOfMonth = `${today.slice(0, 8)}01`
  const lastMonthEnd = addDays(firstOfMonth, -1)
  return [
    { label: "오늘", from: today, to: today },
    { label: "최근 7일", from: addDays(today, -6), to: today },
    { label: "최근 30일", from: addDays(today, -29), to: today },
    { label: "이번 달", from: firstOfMonth, to: today },
    {
      label: "지난 달",
      from: `${lastMonthEnd.slice(0, 8)}01`,
      to: lastMonthEnd,
    },
  ]
}
