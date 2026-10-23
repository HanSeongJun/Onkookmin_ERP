/**
 * 사업자등록번호 (business registration number, also 고유번호).
 *
 * Stored as 10 digits ("1234567890"), shown as "123-45-67890". The last
 * digit is a check digit; the database checks the same formula (function
 * is_valid_business_number in supabase/migrations/*_partners.sql): change
 * both together.
 *
 * No imports: Client Components use this file too.
 */

/** Weights of the first nine digits in the check-digit formula. */
const CHECK_WEIGHTS = [1, 3, 7, 1, 3, 7, 1, 3, 5] as const

/**
 * The digits of what the user typed (hyphens and spaces dropped).
 * @example toBusinessNumberDigits("123-45-67890") // "1234567890"
 */
export function toBusinessNumberDigits(value: string): string {
  return value.replace(/\D/g, "")
}

/**
 * Whether `digits` is a valid 사업자등록번호: exactly 10 digits whose last
 * digit matches the official formula
 *   sum = d1×1 + d2×3 + d3×7 + d4×1 + d5×3 + d6×7 + d7×1 + d8×3 + d9×5
 *         + floor(d9 × 5 ÷ 10)
 *   d10 = (10 − sum mod 10) mod 10
 * It does not tell whether the business really exists (that needs the
 * 국세청 service).
 * @example isValidBusinessNumber("7078138080") // true
 * @example isValidBusinessNumber("7078138081") // false (wrong check digit)
 */
export function isValidBusinessNumber(digits: string): boolean {
  if (!/^[0-9]{10}$/.test(digits)) return false
  const numbers = [...digits].map(Number)
  let sum = 0
  for (let index = 0; index < CHECK_WEIGHTS.length; index++) {
    sum += numbers[index] * CHECK_WEIGHTS[index]
  }
  sum += Math.floor((numbers[8] * 5) / 10)
  return (10 - (sum % 10)) % 10 === numbers[9]
}

/**
 * "123-45-67890", for display and while typing (works on partly typed
 * numbers too). Anything that is not a digit is ignored. Empty → "".
 * @example formatBusinessNumber("1234567890") // "123-45-67890"
 * @example formatBusinessNumber("1234") // "123-4"
 */
export function formatBusinessNumber(value: string | null | undefined): string {
  if (!value) return ""
  const digits = toBusinessNumberDigits(value)
  if (digits.length <= 3) return digits
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`
}
