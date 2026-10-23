/**
 * Display helpers for money, numbers, quantities, dates and expiry dates.
 *
 * Rules used everywhere in this file:
 * - Dates are always shown in Korea time (Asia/Seoul), no matter which
 *   timezone the server or the user's computer uses.
 * - A missing (null/undefined) or invalid value is shown as "-".
 * - Every function is pure: the same input always gives the same output.
 *   (Functions that need "today" accept it as an optional last argument.)
 */

const LOCALE = "ko-KR"
const TIME_ZONE = "Asia/Seoul"
const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Text shown when a value is missing or invalid. */
export const EMPTY_VALUE = "-"

/**
 * Anything accepted as a date:
 * - a Date object
 * - a date-only string such as "2026-10-21" (e.g. a Postgres `date` column)
 * - a date-time string such as "2026-10-21T05:30:00+00:00" (e.g. `timestamptz`)
 * - a timestamp in milliseconds
 */
export type DateInput = Date | string | number

// ---------------------------------------------------------------------------
// Money and numbers
// ---------------------------------------------------------------------------

/**
 * Korean won, rounded to the nearest won.
 * Halves round away from zero, so a charge and its refund show the same amount.
 * @example formatKRW(12300) // "12,300원"
 * @example formatKRW(-5000) // "-5,000원"
 * @example formatKRW(-2.5) // "-3원"
 */
export function formatKRW(amount: number | null | undefined): string {
  if (!isFiniteNumber(amount)) return EMPTY_VALUE
  return `${getNumberFormatter(0).format(amount)}원`
}

/**
 * A number with thousands separators.
 * @param maxFractionDigits most digits to keep after the decimal point (default 2)
 * @example formatNumber(1234567) // "1,234,567"
 * @example formatNumber(3.14159) // "3.14"
 * @example formatNumber(2.5, 0) // "3"
 */
export function formatNumber(
  value: number | null | undefined,
  maxFractionDigits = 2
): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE
  return getNumberFormatter(maxFractionDigits).format(value)
}

/**
 * A quantity with its unit, separated by a space.
 * @param maxFractionDigits most digits to keep after the decimal point (default 3, e.g. 0.125 kg)
 * @example formatQuantity(1.5, "kg") // "1.5 kg"
 * @example formatQuantity(20, "박스") // "20 박스"
 * @example formatQuantity(1200, "개") // "1,200 개"
 */
export function formatQuantity(
  value: number | null | undefined,
  unit: string,
  maxFractionDigits = 3
): string {
  if (!isFiniteNumber(value)) return EMPTY_VALUE
  const number = formatNumber(value, maxFractionDigits)
  const trimmedUnit = unit.trim()
  return trimmedUnit ? `${number} ${trimmedUnit}` : number
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * The date in Korea time, as YYYY-MM-DD.
 * @example formatDate("2026-10-21") // "2026-10-21"
 * @example formatDate("2026-10-21T15:30:00Z") // "2026-10-22" (00:30 the next day in Korea)
 */
export function formatDate(date: DateInput | null | undefined): string {
  const day = toSeoulCalendarDate(date)
  if (!day) return EMPTY_VALUE
  return `${day.year}-${pad2(day.month)}-${pad2(day.day)}`
}

/**
 * The date and time in Korea time, as "YYYY-MM-DD HH:mm" (24-hour clock).
 * A date-only input such as "2026-10-21" has no time, so only the date is shown.
 * @example formatDateTime("2026-10-21T05:05:00Z") // "2026-10-21 14:05"
 */
export function formatDateTime(date: DateInput | null | undefined): string {
  if (date === null || date === undefined) return EMPTY_VALUE
  if (typeof date === "string" && DATE_ONLY_PATTERN.test(date.trim())) {
    return formatDate(date)
  }

  const instant = toValidDate(date)
  if (!instant) return EMPTY_VALUE
  const parts = getSeoulParts(instant)
  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)} ${pad2(parts.hour)}:${pad2(parts.minute)}`
}

// ---------------------------------------------------------------------------
// Expiry dates (유통기한 / 소비기한)
// ---------------------------------------------------------------------------

/**
 * How many days are left until the expiry date, counted in Korean calendar
 * days (the time of day doesn't matter).
 * - positive: days left (1 = expires tomorrow)
 * - 0: expires today
 * - negative: days since it expired
 * - null: the date is missing or invalid
 *
 * @param today the reference date; defaults to now. Pass it explicitly in
 *   tests, or to show every row against the same "today".
 * @example daysUntil("2026-10-24", "2026-10-21") // 3
 * @example daysUntil("2026-10-19", "2026-10-21") // -2
 */
export function daysUntil(
  expiryDate: DateInput | null | undefined,
  today: DateInput = new Date()
): number | null {
  const expiry = toSeoulCalendarDate(expiryDate)
  const base = toSeoulCalendarDate(today)
  if (!expiry || !base) return null
  return (toEpochDay(expiry) - toEpochDay(base)) / MS_PER_DAY
}

/**
 * Expiry date as a short label: "D-3", "D-Day", or "기한 경과 2일".
 * @param today the reference date; defaults to now (see daysUntil).
 * @example formatExpiry("2026-10-24", "2026-10-21") // "D-3"
 * @example formatExpiry("2026-10-21", "2026-10-21") // "D-Day"
 * @example formatExpiry("2026-10-19", "2026-10-21") // "기한 경과 2일"
 */
export function formatExpiry(
  expiryDate: DateInput | null | undefined,
  today?: DateInput
): string {
  const days = daysUntil(expiryDate, today)
  if (days === null) return EMPTY_VALUE
  if (days > 0) return `D-${days}`
  if (days === 0) return "D-Day"
  return `기한 경과 ${-days}일`
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** A calendar day (no time, no timezone). `month` is 1–12. */
type CalendarDate = { year: number; month: number; day: number }

/** Matches a date-only string such as "2026-10-21". */
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

// Reads year/month/day/hour/minute of a moment as seen in Korea.
// "en-US" is used only because its output parts are plain digits.
const seoulPartsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
})

// Number formatters are slow to create, so keep one per fraction-digit setting.
const numberFormatters = new Map<number, Intl.NumberFormat>()

function getNumberFormatter(maxFractionDigits: number): Intl.NumberFormat {
  let formatter = numberFormatters.get(maxFractionDigits)
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: 0,
      maximumFractionDigits: maxFractionDigits,
      // Show a minus sign only for values that are still negative after
      // rounding. Without this, -0.0004 kg or a tiny leftover like
      // 0.3 - 0.1 - 0.2 would show as "-0", which looks like negative stock.
      signDisplay: "negative",
    })
    numberFormatters.set(maxFractionDigits, formatter)
  }
  return formatter
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function pad2(value: number): string {
  return String(value).padStart(2, "0")
}

/** Converts the input to a valid Date, or null. */
function toValidDate(input: DateInput): Date | null {
  const date = input instanceof Date ? input : new Date(input)
  return Number.isNaN(date.getTime()) ? null : date
}

function getSeoulParts(instant: Date) {
  const parts = seoulPartsFormatter.formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  }
}

/**
 * The calendar day in Korea for the given input, or null if missing/invalid.
 * A date-only string ("2026-10-21") is taken as that day as-is.
 */
function toSeoulCalendarDate(
  input: DateInput | null | undefined
): CalendarDate | null {
  if (input === null || input === undefined) return null

  if (typeof input === "string") {
    const match = DATE_ONLY_PATTERN.exec(input.trim())
    if (match) {
      const day = {
        year: Number(match[1]),
        month: Number(match[2]),
        day: Number(match[3]),
      }
      return isRealCalendarDate(day) ? day : null
    }
  }

  const instant = toValidDate(input)
  if (!instant) return null
  const { year, month, day } = getSeoulParts(instant)
  return { year, month, day }
}

/** Milliseconds at UTC midnight of the calendar day (used to count days). */
function toEpochDay({ year, month, day }: CalendarDate): number {
  return Date.UTC(year, month - 1, day)
}

/** Rejects impossible dates such as 2026-02-30. */
function isRealCalendarDate(date: CalendarDate): boolean {
  const check = new Date(toEpochDay(date))
  return (
    check.getUTCFullYear() === date.year &&
    check.getUTCMonth() === date.month - 1 &&
    check.getUTCDate() === date.day
  )
}
