/**
 * Search text → PostgREST `or` filter, for the 거래처 and 직원 lists.
 * Plain functions without the database (unit-testable).
 */

/**
 * Builds the `or` filter "name.ilike.<pattern>,code.ilike.<pattern>,…" for
 * the search text, safe for any characters the user types (same rules as
 * the 상품 list search):
 * 1. LIKE wildcards (% and _) and the LIKE escape character (\) are escaped,
 *    so they match themselves.
 * 2. PostgREST turns every "*" into "%" and has no way to escape it, so "*"
 *    becomes "_" (any one character). "1*2" still finds "1*2".
 * 3. The whole pattern is wrapped in double quotes (with " and \ escaped),
 *    so commas, dots, colons and parentheses are read as plain text.
 */
export function buildSearchFilter(
  search: string,
  columns: readonly string[]
): string {
  return columns
    .map((column) => `${column}.ilike.${likePattern(search)}`)
    .join(",")
}

/** The quoted `%…%` pattern of buildSearchFilter for one search text. */
function likePattern(search: string): string {
  const likeText = search
    .replace(/[\\%_]/g, (character) => `\\${character}`)
    .replaceAll("*", "_")
  return `"%${likeText.replace(/["\\]/g, (character) => `\\${character}`)}%"`
}

/**
 * The digits to look for in number columns (phone numbers and
 * 사업자등록번호 are stored as digits only), or null when the search text
 * is not a number: only digits, spaces and - . ( ) + are allowed, and at
 * least 2 digits. So "010-1234" finds 01012345678 and "123-45" finds
 * 1234567890, while "한빛 2호점" does not search the numbers for "2".
 * @example searchDigits("02) 123-45") // "0212345"
 * @example searchDigits("한빛 2호점") // null
 */
export function searchDigits(search: string): string | null {
  if (!/^[\d\s\-.()+]+$/.test(search)) return null
  const digits = search.replace(/\D/g, "")
  return digits.length >= 2 ? digits : null
}

/**
 * The 거래처 list search: 거래처명, 거래처코드, 상호, 대표자 (text, ignoring
 * case) and — when the search is a number (searchDigits) — 사업자번호 and
 * 대표연락처.
 */
export function buildPartnerSearchFilter(search: string): string {
  const textFilter = buildSearchFilter(search, [
    "name",
    "code",
    "company_name",
    "representative",
  ])
  const digits = searchDigits(search)
  if (digits === null) return textFilter
  return `${textFilter},${buildSearchFilter(digits, ["business_number", "phone"])}`
}

/**
 * The 직원 list search: 직원코드, 직원명, 차량번호 (text, ignoring case)
 * and — when the search is a number — 휴대폰번호1/2.
 */
export function buildEmployeeSearchFilter(search: string): string {
  const textFilter = buildSearchFilter(search, [
    "code",
    "name",
    "vehicle_number",
  ])
  const digits = searchDigits(search)
  if (digits === null) return textFilter
  return `${textFilter},${buildSearchFilter(digits, ["mobile", "mobile2"])}`
}
