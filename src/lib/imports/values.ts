/**
 * 자료일괄등록: turning Excel / CSV cells into the text the 등록 forms
 * expect, so the forms' own zod rules (`@/lib/products/schema`,
 * `@/lib/partners/schema`, `@/lib/employees/schema`) can check them.
 *
 * Excel hands over numbers, dates and TRUE/FALSE as well as text, and people
 * write the same thing in many ways ("12,000원", "₩12000", "2026.10.22",
 * "예", "매출/매입"). The helpers here accept those ways; anything they do
 * not understand is passed on as it was typed, so the form rule shows its
 * usual message.
 *
 * No imports from server code: the browser and the server both use it.
 */

import { isValidPhone } from "@/lib/partners/phone"
import {
  ALLERGENS,
  UNITS,
  type Allergen,
  type Unit,
} from "@/lib/products/constants"
import type { ImportCell } from "@/lib/imports/types"

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * A whole number as plain digits, without exponent or separators
 * (1e21 and above, and fractions, as JavaScript writes them).
 * @example numberText(8801234567890) // "8801234567890"
 */
export function numberText(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e21) {
    return BigInt(value).toString()
  }
  return String(value)
}

/**
 * A cell as text: trimmed, in Unicode NFC (decomposed Hangul pasted from
 * macOS becomes the usual form), line breaks as "\n", zero-width spaces
 * dropped. Numbers become plain digits ("8801234567890"), TRUE/FALSE
 * "TRUE"/"FALSE", an empty cell "".
 * A CSV value written as ="…" (how our own 엑셀 downloads keep codes as
 * text) is unwrapped.
 * @example cellText("  양파 ") // "양파"
 * @example cellText('="00123"') // "00123"
 */
export function cellText(cell: ImportCell | undefined): string {
  if (cell === null || cell === undefined) return ""
  if (typeof cell === "number") return numberText(cell)
  if (typeof cell === "boolean") return cell ? "TRUE" : "FALSE"
  let text = cell
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[​-‍﻿]/g, "")
    .replace(/ /g, " ")
    .trim()
  const formula = /^="([\s\S]*)"$/.exec(text)
  if (formula) text = formula[1].replace(/""/g, '"').trim()
  return text
}

/** Whether a cell is empty (nothing, or only spaces). */
export function isEmptyCell(cell: ImportCell | undefined): boolean {
  return cellText(cell) === ""
}

/**
 * The form of a label or column title used to compare them: NFC, lower
 * case, without spaces, "*" and separators (· / , . - _ brackets : ' ").
 * So "매출·매입", "매출/매입" and "매출 매입" are the same, and so are
 * "기본 매입가(부가세 포함)*" and "기본매입가（부가세포함）".
 * @example matchKey("기본 매입가（부가세 포함）*") // "기본매입가부가세포함"
 */
export function matchKey(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s*＊·ㆍ•・/／\\,，.。\-－_()（）[\]［］{}<>:：'"`‘’“”]/g, "")
}

// ---------------------------------------------------------------------------
// Fixed choices (구분, 보관온도, 고용형태, 사용여부 …)
// ---------------------------------------------------------------------------

/**
 * One allowed value of a column: the database value, the Korean label the
 * screens show (what the template lists), and other ways to write it.
 */
export type ImportChoice<Value> = {
  value: Value
  label: string
  aliases?: readonly string[]
}

/** Ways to write "yes" (Y/N columns), compared with matchKey. */
export const YES_WORDS = ["y", "yes", "예", "네", "o", "○", "◯", "1", "true"]

/** Ways to write "no" (Y/N columns), compared with matchKey. */
export const NO_WORDS = [
  "n",
  "no",
  "아니오",
  "아니요",
  "아니",
  "x",
  "×",
  "0",
  "false",
]

/**
 * The value of the choice a cell names (its label or one of its aliases,
 * compared with matchKey), `null` for an empty cell, or `undefined` when
 * the cell names none of them. TRUE/FALSE cells and the numbers 1/0 are
 * compared as "true"/"false" and "1"/"0".
 */
export function matchChoice<Value>(
  cell: ImportCell | undefined,
  choices: readonly ImportChoice<Value>[]
): Value | null | undefined {
  const text = cellText(cell)
  if (text === "") return null
  const key = matchKey(text)
  for (const choice of choices) {
    if (matchKey(choice.label) === key) return choice.value
    if (choice.aliases?.some((alias) => matchKey(alias) === key)) {
      return choice.value
    }
  }
  return undefined
}

/** The labels of the choices as the template lists them: "상온, 냉장, 냉동". */
export function choiceLabels(
  choices: readonly ImportChoice<unknown>[]
): string {
  return choices.map((choice) => choice.label).join(", ")
}

/** Y / N (also 예/아니오, O/X, 1/0, TRUE/FALSE). */
export const YES_NO_CHOICES: readonly ImportChoice<boolean>[] = [
  { value: true, label: "Y", aliases: YES_WORDS },
  { value: false, label: "N", aliases: NO_WORDS },
]

// ---------------------------------------------------------------------------
// Numbers, money, dates
// ---------------------------------------------------------------------------

/**
 * An amount of money as digits for the forms' price rules: "₩12,000원",
 * "12,000", "12000원", "KRW 12000" and the number 12000 all become
 * "12000"; "12000.00" becomes "12000". Anything else (a minus sign,
 * decimals, words) is returned as it is, and the form rule reports it.
 * @example amountText("₩12,000원") // "12000"
 */
export function amountText(cell: ImportCell | undefined): string {
  if (typeof cell === "number") return numberText(cell)
  let text = cellText(cell)
  text = text
    .replace(/^(₩|￦|KRW)\s*/i, "")
    .replace(/\s*(원|KRW)$/i, "")
    .replace(/[,\s]/g, "")
  if (/^\d+\.0+$/.test(text)) text = text.replace(/\.0+$/, "")
  return text
}

/**
 * A whole number as digits: the number 30, "30" and "30일" (with one of
 * `suffixes`) become "30". Anything else is returned as it is.
 * @example integerText("1,095일", ["일"]) // "1095"
 */
export function integerText(
  cell: ImportCell | undefined,
  suffixes: readonly string[] = []
): string {
  if (typeof cell === "number") return numberText(cell)
  let text = cellText(cell)
  for (const suffix of suffixes) {
    if (text.endsWith(suffix)) {
      text = text.slice(0, -suffix.length).trim()
      break
    }
  }
  const digits = text.replace(/,/g, "")
  return /^\d+$/.test(digits) ? digits : text
}

/**
 * The days since 1899-12-30 that Excel stores for a date (the "1900 date
 * system"), as "YYYY-MM-DD".
 */
function excelSerialDate(serial: number): string {
  const date = new Date(
    Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000
  )
  return date.toISOString().slice(0, 10)
}

/**
 * A date as "YYYY-MM-DD" for the forms' date rules. Accepts Excel date
 * cells (the file reader turns them into "YYYY-MM-DD"), "2026-10-22",
 * "2026.10.22", "2026. 10. 22.", "2026/10/22", "2026년 10월 22일",
 * "20261022" (text or number), "2026-10-22 09:00" and Excel's day numbers
 * in a plain number cell (e.g. 46317). Anything else is returned as it is,
 * and the form rule reports it. Whether the day exists (2026-02-30) is
 * checked by the form rule.
 * @example dateText("2026.3.2") // "2026-03-02"
 */
export function dateText(cell: ImportCell | undefined): string {
  if (typeof cell === "number") {
    if (Number.isInteger(cell) && cell >= 19000101 && cell <= 21001231) {
      return dateText(String(cell))
    }
    if (cell >= 1 && cell < 100_000) return excelSerialDate(cell)
    return numberText(cell)
  }
  const text = cellText(cell)
  const parts =
    /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*[.일]?(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.exec(
      text
    ) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(text)
  if (!parts) return text
  const [, year, month, day] = parts
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
}

// ---------------------------------------------------------------------------
// Phone numbers, 우편번호, codes
// ---------------------------------------------------------------------------

/**
 * A phone number for the forms' phone rules (they accept hyphens). A
 * NUMBER cell has lost its leading 0 in Excel (010-1234-5678 typed into a
 * number cell is 1012345678): the 0 is put back when that makes a valid
 * phone number.
 * @example phoneText(1012345678) // "01012345678"
 */
export function phoneText(cell: ImportCell | undefined): string {
  if (typeof cell === "number" && Number.isInteger(cell) && cell > 0) {
    const digits = numberText(cell)
    if (!isValidPhone(digits) && isValidPhone(`0${digits}`)) return `0${digits}`
    return digits
  }
  return cellText(cell)
}

/**
 * A 우편번호 (5 digits). A NUMBER cell has lost its leading 0 in Excel
 * (06236 → 6236): it is put back.
 * @example postalCodeText(6236) // "06236"
 */
export function postalCodeText(cell: ImportCell | undefined): string {
  if (typeof cell === "number" && Number.isInteger(cell) && cell >= 0) {
    const digits = numberText(cell)
    return digits.length < 5 ? digits.padStart(5, "0") : digits
  }
  return cellText(cell)
}

// ---------------------------------------------------------------------------
// 상품: 단위, 알레르기, 구성상품
// ---------------------------------------------------------------------------

/**
 * The 단위 from the UNITS list a cell names, ignoring upper/lower case
 * ("KG" → "kg", "ml" → "mL", "ea" → "EA"); null for an empty cell,
 * undefined when it is not in the list.
 */
export function matchUnit(
  cell: ImportCell | undefined
): Unit | null | undefined {
  const text = cellText(cell)
  if (text === "") return null
  const lower = text.toLowerCase()
  return UNITS.find((unit) => unit.toLowerCase() === lower)
}

/**
 * Other names people use for the allergens (compared with matchKey). The
 * labels themselves, the labels without their bracket ("알류", "조개류")
 * and the stored keys ("egg") are accepted too.
 */
const ALLERGEN_ALIASES: Partial<Record<Allergen, readonly string[]>> = {
  egg: ["계란", "달걀", "난류", "알류"],
  milk: ["우유류", "유제품"],
  soybean: ["콩", "대두류"],
  wheat: ["소맥", "밀가루"],
  sulfites: ["아황산", "아황산염", "아황산류포함"],
  beef: ["소고기"],
  pork: ["돼지"],
  chicken: ["닭"],
  shellfish: ["조개", "굴", "전복", "홍합"],
}

function allergenKeys(allergen: (typeof ALLERGENS)[number]): string[] {
  return [
    allergen.label,
    allergen.label.replace(/\(.*\)$/, ""),
    allergen.value,
    ...(ALLERGEN_ALIASES[allergen.value] ?? []),
  ].map(matchKey)
}

/**
 * 알레르기 유발물질 written as Korean names separated by commas (also
 * "/", ";", "、" or line breaks), e.g. "우유, 대두, 밀". Words in brackets
 * are ignored ("조개류(굴·전복·홍합 포함)" = "조개류"). "없음" or "-" means
 * none. Returns the keys in the order the law lists them, or the names
 * that are not allergens.
 * @example parseAllergens("밀, 우유, 계란") // { ok: true, value: ["egg", "milk", "wheat"] }
 */
export function parseAllergens(
  cell: ImportCell | undefined
): { ok: true; value: Allergen[] } | { ok: false; unknown: string[] } {
  const text = cellText(cell)
    .replace(/\([^)]*\)/g, "")
    .replace(/（[^）]*）/g, "")
  if (text === "" || ["없음", "-", "해당없음", "무"].includes(text.trim())) {
    return { ok: true, value: [] }
  }
  const found = new Set<Allergen>()
  const unknown: string[] = []
  for (const part of text.split(/[,，、;；/\n]+/)) {
    const name = part.trim()
    if (name === "") continue
    const key = matchKey(name)
    const allergen = ALLERGENS.find((item) => allergenKeys(item).includes(key))
    if (allergen) found.add(allergen.value)
    else unknown.push(name)
  }
  if (unknown.length > 0) return { ok: false, unknown }
  return {
    ok: true,
    value: ALLERGENS.map((item) => item.value).filter((value) =>
      found.has(value)
    ),
  }
}

/** One 구성상품 of a 묶음상품 row: a 기준상품코드 and how many. */
export type ComponentEntry = { code: string; quantity: string }

/**
 * The 구성상품 cell of a 묶음상품 row: "기준상품코드*수량" entries
 * separated by commas, "+", ";" or line breaks, e.g. "PRC-010*6, PRC-005*2".
 * Between code and quantity "*", "x", "X", "×" or "＊" (spaces allowed);
 * the quantity may have thousands separators and "개". The quantity is
 * returned as text for the 구성표 rule (1–100,000).
 * Returns the entries, or the parts that could not be read.
 * @example parseComponents("PRC-010*6 + PRC-005 x 2") // ok: [{ code: "PRC-010", quantity: "6" }, { code: "PRC-005", quantity: "2" }]
 */
export function parseComponents(
  cell: ImportCell | undefined
): { ok: true; value: ComponentEntry[] } | { ok: false; invalid: string[] } {
  // A comma between digits that ends an entry is a thousands separator
  // ("PRC-010*1,000"), not the start of the next entry.
  const text = cellText(cell).replace(
    /(\d),(\d{3})(?=\s*(?:$|[,，;；+\n]))/g,
    "$1$2"
  )
  const entries: ComponentEntry[] = []
  const invalid: string[] = []
  for (const part of text.split(/[,，;；+\n]+/)) {
    const item = part.trim()
    if (item === "") continue
    const match =
      /^([A-Za-z0-9._-]+?)\s*[*xX×＊]\s*([\d,]+)\s*(?:개|ea)?$/i.exec(item)
    if (match) {
      entries.push({ code: match[1], quantity: match[2].replace(/,/g, "") })
    } else {
      invalid.push(item)
    }
  }
  if (invalid.length > 0) return { ok: false, invalid }
  return { ok: true, value: entries }
}
