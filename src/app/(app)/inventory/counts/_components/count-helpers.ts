/**
 * Small helpers of the 실사재고조정 screen (no server imports, no React).
 *
 * Quantities are compared in thousandths (정수, "milli") so a difference
 * such as 12.3 − 12.1 never shows a float leftover like 0.1999999.
 */

import { STOCK_LIMITS } from "@/lib/inventory/constants"

/** The key of a 실사 line: one lot at one 위치. */
export function lineKey(lotId: string, locationId: string): string {
  return `${lotId}:${locationId}`
}

/**
 * A quantity from the database as form text: 12 → "12", 2.5 → "2.5"
 * (at most 3 decimals, never "1e-7").
 */
export function quantityText(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  return rounded.toFixed(STOCK_LIMITS.quantityDecimals).replace(/\.?0+$/, "")
}

/**
 * Typed quantity text ("1,234.5") in thousandths (1234500), or null when it
 * is empty or not a plain number with at most 3 decimals.
 */
export function toMilli(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim()
  const match = /^(\d+)(?:\.(\d+))?$/.exec(cleaned)
  if (!match) return null
  const fraction = (match[2] ?? "").replace(/0+$/, "")
  if (fraction.length > STOCK_LIMITS.quantityDecimals) return null
  return Number(match[1]) * 1000 + Number(fraction.padEnd(3, "0") || "0")
}

/**
 * The difference 실사 − 전산 in thousandths, or null when nothing (or
 * nothing valid) was typed as 실사 수량.
 */
export function differenceMilli(
  systemText: string,
  countedText: string
): number | null {
  if (countedText.trim() === "") return null
  const counted = toMilli(countedText)
  const system = toMilli(systemText)
  if (counted === null || system === null) return null
  return counted - system
}

/** Thousandths as a plain number (1234500 → 1234.5). */
export function fromMilli(milli: number): number {
  return milli / 1000
}

/**
 * The value of a difference (원, 부가세 포함): |차이| × 단가 rounded to whole
 * won, with the sign of the difference; null without a 단가.
 */
export function differenceValue(
  milli: number,
  unitCostInclVat: number | null
): number | null {
  if (unitCostInclVat === null) return null
  const amount = Math.round((Math.abs(milli) * unitCostInclVat) / 1000)
  return milli < 0 ? -amount : amount
}
