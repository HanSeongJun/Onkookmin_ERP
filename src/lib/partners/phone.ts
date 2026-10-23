/**
 * Korean phone numbers (대표연락처, 휴대폰, 전화, 배송지 연락처, 직원 휴대폰).
 *
 * Stored as digits only ("0212345678"), shown with hyphens ("02-1234-5678").
 * The database checks the same pattern (function is_valid_phone in
 * supabase/migrations/*_partners.sql): change both together.
 *
 * No imports: Client Components (and the 직원 module) use this file too.
 */

/**
 * A valid phone number, digits only:
 * - 02 (서울): 9–10 digits, 02-123-4567 / 02-1234-5678
 * - other area codes 031–033, 041–044, 051–055, 061–064: 10–11 digits
 * - mobile 010, 011, 016–019: 10–11 digits, 010-1234-5678
 * - 070 (internet phone): 11 digits, 070-1234-5678
 * - 0502–0508 (안심번호 etc.): 11–12 digits, 0505-123-4567
 * - 080 (toll-free): 10–11 digits, 080-123-4567
 * - 15xx, 16xx, 18xx (대표번호): 8 digits, 1588-1234
 */
export const PHONE_PATTERN =
  /^(02[0-9]{7,8}|0(3[1-3]|4[1-4]|5[1-5]|6[1-4])[0-9]{7,8}|01[016789][0-9]{7,8}|070[0-9]{8}|050[2-8][0-9]{7,8}|080[0-9]{7,8}|1[568][0-9]{6})$/

/** Example numbers for messages and placeholders. */
export const PHONE_EXAMPLES = "010-1234-5678, 02-123-4567, 1588-1234"

/**
 * The digits of what the user typed: hyphens, spaces, dots and brackets
 * are dropped. A number written with the country code (+82 10-1234-5678)
 * becomes the usual domestic form (01012345678).
 * @example toPhoneDigits("(02) 123-4567") // "021234567"
 * @example toPhoneDigits("+82 10-1234-5678") // "01012345678"
 */
export function toPhoneDigits(value: string): string {
  const trimmed = value.trim()
  let digits = trimmed.replace(/\D/g, "")
  if (trimmed.startsWith("+82") && digits.startsWith("82")) {
    digits = digits.slice(2)
    if (!digits.startsWith("0")) digits = `0${digits}`
  }
  return digits
}

/**
 * Whether `digits` (digits only, see toPhoneDigits) is a valid Korean phone
 * number.
 * @example isValidPhone("01012345678") // true
 * @example isValidPhone("0101234") // false
 */
export function isValidPhone(digits: string): boolean {
  return PHONE_PATTERN.test(digits)
}

/**
 * A phone number with hyphens, for display and while typing. Works on
 * partly typed numbers too, so an input box can format as the user types.
 * Anything that is not a digit is ignored. Empty → "".
 * - 대표번호 (15xx/16xx/18xx): 1588-1234
 * - 02: 02-123-4567 / 02-1234-5678
 * - 0502–0508: 0505-123-4567 / 0505-1234-5678
 * - others: 031-123-4567, 010-1234-5678
 * @example formatPhone("0212345678") // "02-1234-5678"
 * @example formatPhone("021234567") // "02-123-4567"
 * @example formatPhone("01012345678") // "010-1234-5678"
 * @example formatPhone("15881234") // "1588-1234"
 * @example formatPhone("0101") // "010-1"
 */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return ""
  const digits = value.replace(/\D/g, "")
  if (digits === "") return ""

  // 대표번호: two groups of four.
  if (/^1[568]/.test(digits)) {
    return digits.length <= 4
      ? digits
      : `${digits.slice(0, 4)}-${digits.slice(4)}`
  }

  const areaLength = digits.startsWith("02")
    ? 2
    : /^050[2-8]/.test(digits)
      ? 4
      : 3
  const area = digits.slice(0, areaLength)
  const rest = digits.slice(areaLength)
  if (rest === "") return area
  if (rest.length <= 3) return `${area}-${rest}`
  // The middle group has 3 digits until the number is long enough for 4.
  const middleLength = rest.length <= 7 ? 3 : 4
  return `${area}-${rest.slice(0, middleLength)}-${rest.slice(middleLength)}`
}
