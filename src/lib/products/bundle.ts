/**
 * 묶음상품 (bundle) helpers, shared by the browser and the server (no server
 * imports, so Client Components may use them):
 * - BaseProductOption / BundleComponent: a 기준상품 as the 구성상품 table and
 *   the 기준상품 picker show it.
 * - deriveBundleFoodInfo: a 묶음상품's food information from its 기준상품.
 * - suggestBundleCode / suggestBundleName / nextAvailableCode: the suggested
 *   상품코드 and 상품명 of a new 묶음상품.
 * - componentVatWeights / splitBundlePrice: the 부가세 별도 amount of a
 *   묶음상품's price (혼합 = split by its 기준상품's prices).
 * - perUnitPrice / componentPriceTotal: 개당 환산가 and 구성 기준가 합계,
 *   as 부가세 포함 and 부가세 별도.
 * - formatComposition: the list's 구성 column ("×6", "혼합 2종").
 *
 * Rules (decided by the owner): our ERP always counts single units (개입).
 * A 묶음상품 is one or more 기준상품 × quantity and has no food information
 * of its own; stock is kept only on 기준상품 (a 묶음상품 quantity is
 * converted through its 구성표).
 */

import {
  ALLERGENS,
  PRODUCT_LIMITS,
  STORAGE_TYPES,
  type EffectiveTaxType,
  type ProductType,
  type StorageType,
  type TaxType,
} from "@/lib/products/constants"
import {
  excludedOf,
  mixedWeights,
  splitVat,
  type MixedWeightLine,
  type MixedWeights,
  type VatSplit,
} from "@/lib/products/vat"

// ---------------------------------------------------------------------------
// 기준상품 as a 구성상품
// ---------------------------------------------------------------------------

/** A 기준상품, as the 구성상품 table and the 기준상품 picker show it. */
export type BaseProductOption = {
  id: string
  code: string
  name: string
  spec: string | null
  unit: string
  /** 사용 여부. Only 사용 기준상품 can go into a 사용 묶음상품. */
  isActive: boolean
  storageType: StorageType
  taxType: TaxType
  /** Allergen keys (see ALLERGENS). */
  allergens: string[]
  shelfLifeDays: number | null
  origin: string | null
  manufacturer: string | null
  barcode: string | null
  /**
   * 기본 매입가 in won, 부가세 포함 (as stored), or null. Its 부가세 별도
   * amount: excludedOf / splitVat in `@/lib/products/vat`.
   */
  purchasePriceInclVat: number | null
  /** 기본 판매가 in won, 부가세 포함 (as stored), or null. */
  salePriceInclVat: number | null
}

/**
 * One row of a 묶음상품's 구성표: the 기준상품 (`id` is the 기준상품's id)
 * and how many of it, in the 기준상품's own unit.
 */
export type BundleComponent = BaseProductOption & { quantity: number }

// ---------------------------------------------------------------------------
// Food information in effect
// ---------------------------------------------------------------------------

/**
 * Food information in effect: a 기준상품's own values, or a 묶음상품's values
 * worked out from its 기준상품 (deriveBundleFoodInfo). Empty (null / []) for a
 * 묶음상품 without 기준상품 yet.
 */
export type FoodInfo = {
  storageType: StorageType | null
  taxType: EffectiveTaxType | null
  /** Allergen keys, in the order the law lists them. */
  allergens: string[]
  shelfLifeDays: number | null
  /** Different values joined with ", " (묶음상품), or null. */
  origin: string | null
  /** Different values joined with ", " (묶음상품), or null. */
  manufacturer: string | null
}

type FoodSource = Pick<
  BaseProductOption,
  | "storageType"
  | "taxType"
  | "allergens"
  | "shelfLifeDays"
  | "origin"
  | "manufacturer"
>

/** A 기준상품's own food information. */
export function baseFoodInfo(product: FoodSource): FoodInfo {
  return {
    storageType: product.storageType,
    taxType: product.taxType,
    allergens: sortAllergens(product.allergens),
    shelfLifeDays: product.shelfLifeDays,
    origin: product.origin,
    manufacturer: product.manufacturer,
  }
}

/**
 * A 묶음상품's food information, worked out from its 기준상품 (never typed):
 * - 보관온도: the strictest (냉동 > 냉장 > 상온);
 * - 과세구분: 과세 if all are 과세, 면세 if all are 면세, otherwise "mixed"
 *   (혼합; its prices are split by the 기준상품's prices, see
 *   splitBundlePrice);
 * - 알레르기: every allergen of any 기준상품 (no duplicates);
 * - 유통기한 기준일수: the shortest one that is filled in;
 * - 원산지 / 제조사: the different values, sorted, joined with ", ".
 *
 * The database view product_list_items (effective_* columns) uses the same
 * rules for the list: change both together.
 */
export function deriveBundleFoodInfo(
  components: readonly FoodSource[]
): FoodInfo {
  if (components.length === 0) {
    return {
      storageType: null,
      taxType: null,
      allergens: [],
      shelfLifeDays: null,
      origin: null,
      manufacturer: null,
    }
  }

  // STORAGE_TYPES is ordered 상온 → 냉장 → 냉동, so the highest index wins.
  const storageOrder = STORAGE_TYPES.map((type) => type.value) as StorageType[]
  const storageType = components
    .map((component) => component.storageType)
    .reduce((strictest, value) =>
      storageOrder.indexOf(value) > storageOrder.indexOf(strictest)
        ? value
        : strictest
    )

  const taxTypes = new Set(components.map((component) => component.taxType))
  const taxType: EffectiveTaxType =
    taxTypes.size === 1 ? [...taxTypes][0] : "mixed"

  const shelfLives = components
    .map((component) => component.shelfLifeDays)
    .filter((days) => days !== null)

  return {
    storageType,
    taxType,
    allergens: sortAllergens(
      components.flatMap((component) => component.allergens)
    ),
    shelfLifeDays: shelfLives.length > 0 ? Math.min(...shelfLives) : null,
    origin: joinDistinct(components.map((component) => component.origin)),
    manufacturer: joinDistinct(
      components.map((component) => component.manufacturer)
    ),
  }
}

/**
 * Allergen keys without duplicates, in the order the law lists them
 * (unknown keys last, in their own order).
 */
export function sortAllergens(keys: readonly string[]): string[] {
  const known: string[] = ALLERGENS.map((allergen) => allergen.value).filter(
    (value) => keys.includes(value)
  )
  const unknown = keys.filter((key) => !known.includes(key))
  return [...known, ...new Set(unknown)]
}

/**
 * The different filled-in values, sorted by character code and joined with
 * ", " — the same order as the database view (collate "C") — or null.
 */
function joinDistinct(values: readonly (string | null)[]): string | null {
  const distinct = [...new Set(values.filter((value) => value !== null))]
  return distinct.length > 0 ? distinct.sort().join(", ") : null
}

// ---------------------------------------------------------------------------
// Suggested 상품코드 and 상품명 of a new 묶음상품
// (only suggestions: the form fills them while the user has not typed their
// own, and the database still checks that the code is unique)
// ---------------------------------------------------------------------------

/** A 기준상품 of the 구성표, for the suggestions. */
export type BundleSuggestionItem = {
  code: string
  name: string
  quantity: number
}

/** Code suffix of a 묶음상품 with more than one kind of 기준상품. */
export const MIXED_BUNDLE_CODE_SUFFIX = "-SET"

/**
 * Suggested 상품코드: "<기준코드>-<수량>" for one 기준상품 (e.g. "100123-6"),
 * "<first 기준코드>-SET" for several. The 기준코드 is shortened when the code
 * would be longer than 30 characters. "" when there are no 기준상품.
 * Use nextAvailableCode (or the Server Action suggestAvailableProductCode)
 * to add -2, -3 … when the code is already used (e.g. "100123-6-2" for a
 * second 6개입 of the same 기준상품).
 */
export function suggestBundleCode(
  items: readonly BundleSuggestionItem[]
): string {
  const first = items[0]
  if (!first) return ""
  const suffix =
    items.length === 1 ? `-${first.quantity}` : MIXED_BUNDLE_CODE_SUFFIX
  return withSuffix(first.code, suffix)
}

/** nextAvailableCode tries "-2" up to "-9999". */
const MAX_CODE_NUMBER = 9999

/**
 * The "-6" / "-SET" end of a suggested code (see suggestBundleCode), kept
 * whole when a number is added; "" for any other code.
 */
function suggestedCodeTail(code: string): string {
  return /-(?:SET|\d+)$/i.exec(code)?.[0] ?? ""
}

/**
 * `candidate` if no code in `takenCodes` equals it (ignoring upper/lower
 * case, like the database), otherwise "<candidate>-2", "<candidate>-3" …
 * When the code would be longer than 30 characters, the 기준코드 part is
 * shortened and the "-6" / "-SET" end is kept.
 * @example nextAvailableCode("100123-SET", ["100123-set"]) // "100123-SET-2"
 * @example nextAvailableCode("PRC-010-6", ["PRC-010-6"]) // "PRC-010-6-2"
 * @example nextAvailableCode("AB12-LONGCODE-0-XXXXXXXXXX-SET", ["AB12-LONGCODE-0-XXXXXXXXXX-SET"])
 * // "AB12-LONGCODE-0-XXXXXXXX-SET-2" (30 characters)
 */
export function nextAvailableCode(
  candidate: string,
  takenCodes: Iterable<string>
): string {
  const taken = new Set([...takenCodes].map((code) => code.toLowerCase()))
  if (!taken.has(candidate.toLowerCase())) return candidate
  const tail = suggestedCodeTail(candidate)
  const stem = candidate.slice(0, candidate.length - tail.length)
  for (let number = 2; number <= MAX_CODE_NUMBER; number++) {
    const code = withSuffix(stem, `${tail}-${number}`)
    if (!taken.has(code.toLowerCase())) return code
  }
  return candidate
}

/**
 * The start that every code nextAvailableCode(candidate, …) can return
 * shares, so the taken codes can be read with one "starts with" search.
 * @example availableCodePrefix("100123-SET") // "100123-SET"
 */
export function availableCodePrefix(candidate: string): string {
  const tail = suggestedCodeTail(candidate)
  return candidate.slice(
    0,
    PRODUCT_LIMITS.codeMaxLength - tail.length - `-${MAX_CODE_NUMBER}`.length
  )
}

/** `stem` + `suffix`, cutting the end of `stem` so it fits in a code. */
function withSuffix(stem: string, suffix: string): string {
  const room = PRODUCT_LIMITS.codeMaxLength - suffix.length
  return `${stem.slice(0, Math.max(room, 0))}${suffix}`
}

/** Prefix of a suggested 묶음상품 name. */
export const BUNDLE_NAME_PREFIX = "[묶음]"

/**
 * Suggested 상품명:
 * - one 기준상품: "[묶음] <기준상품명> X <수량>개입", e.g.
 *   "[묶음] 스팸 클래식 1.81kg X 6개입" (a long name is shortened with "…");
 * - several: "[묶음] <A명> <a>개 + <B명> <b>개 …"; when that is longer than
 *   100 characters, the last ones are replaced by " 외 N종".
 * "" when there are no 기준상품.
 */
export function suggestBundleName(
  items: readonly BundleSuggestionItem[]
): string {
  const max = PRODUCT_LIMITS.nameMaxLength
  const first = items[0]
  if (!first) return ""

  if (items.length === 1) {
    const prefix = `${BUNDLE_NAME_PREFIX} `
    const suffix = ` X ${formatCount(first.quantity)}개입`
    return `${prefix}${shorten(first.name, max - prefix.length - suffix.length)}${suffix}`
  }

  const parts = items.map(
    (item) => `${item.name} ${formatCount(item.quantity)}개`
  )
  const full = `${BUNDLE_NAME_PREFIX} ${parts.join(" + ")}`
  if (full.length <= max) return full

  // Keep as many parts as fit together with " 외 N종".
  for (let kept = parts.length - 1; kept >= 1; kept--) {
    const name = `${BUNDLE_NAME_PREFIX} ${parts.slice(0, kept).join(" + ")} 외 ${parts.length - kept}종`
    if (name.length <= max) return name
  }
  // Even the first part is too long: shorten it.
  const rest = ` 외 ${parts.length - 1}종`
  const prefix = `${BUNDLE_NAME_PREFIX} `
  return `${prefix}${shorten(parts[0], max - prefix.length - rest.length)}${rest}`
}

/** `text` cut to `max` characters, ending in "…" when it was cut. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(max - 1, 0)).trimEnd()}…`
}

/** 1000 → "1,000". */
function formatCount(value: number): string {
  return value.toLocaleString("ko-KR")
}

// ---------------------------------------------------------------------------
// Prices (whole won; stored 부가세 포함, the 부가세 별도 amount is worked out
// with `@/lib/products/vat`)
// ---------------------------------------------------------------------------

/** Which price: "purchase" = 기본 매입가, "sale" = 기본 판매가. */
export type PriceKind = "purchase" | "sale"

/** A 기준상품's VAT-inclusive price of this kind, or null. */
function priceOf(
  product: Pick<BaseProductOption, "purchasePriceInclVat" | "salePriceInclVat">,
  kind: PriceKind
): number | null {
  return kind === "sale"
    ? product.salePriceInclVat
    : product.purchasePriceInclVat
}

/**
 * A 기준상품 of a 묶음상품, as the price helpers below need it, with the 수량
 * typed for it (null while it is not valid). A BundleComponent fits.
 */
export type BundlePriceComponent = Pick<
  BaseProductOption,
  "taxType" | "purchasePriceInclVat" | "salePriceInclVat"
> & { quantity: number | null }

/**
 * Weights to split a 혼합 묶음상품's price into its 과세 and 면세 parts
 * (allocateMixed in `@/lib/products/vat`): each 기준상품's 판매가 (`kind`
 * "sale") or 매입가 ("purchase") × its quantity. Null when there are no
 * 기준상품, a quantity is not known yet, or a 기준상품 has no such price.
 */
export function componentVatWeights(
  components: readonly BundlePriceComponent[],
  kind: PriceKind
): MixedWeights | null {
  if (components.length === 0) return null
  const lines: MixedWeightLine[] = []
  for (const component of components) {
    if (component.quantity === null) return null
    lines.push({
      taxable: component.taxType === "taxable",
      price: priceOf(component, kind),
      quantity: component.quantity,
    })
  }
  return mixedWeights(lines)
}

/**
 * A 묶음상품's VAT-inclusive price (its 매입가 or 판매가, `kind`) with its
 * 부가세 별도 amount and 부가세, by its 과세구분 in effect (`taxType`, from
 * deriveBundleFoodInfo): 과세 / 면세 as for a 기준상품; 혼합 split by the
 * same price of its `components` (componentVatWeights). Null when the price
 * is empty, the 과세구분 is not known, or a 혼합 price cannot be split.
 * The view product_list_items computes the same for the list.
 */
export function splitBundlePrice(
  priceInclVat: number | null,
  taxType: EffectiveTaxType | null,
  components: readonly BundlePriceComponent[],
  kind: PriceKind
): VatSplit | null {
  const weights =
    taxType === "mixed" ? componentVatWeights(components, kind) : null
  return splitVat(priceInclVat, taxType, weights)
}

/**
 * A price as 부가세 포함 and 부가세 별도. `excluded` is null when it cannot
 * be worked out (e.g. 과세구분 not known yet, or a 혼합 price that cannot be
 * split). A VatSplit fits here too.
 */
export type PriceInclExcl = { included: number; excluded: number | null }

/**
 * 개당 환산가: the 묶음상품's price ÷ the quantity of its one 기준상품, for
 * the 부가세 포함 and the 부가세 별도 amount alike, each rounded to whole
 * won (0.5 up). Null when the price is empty or the quantity is not at
 * least 1. Shown for 묶음상품 of one kind of 기준상품 only.
 * @example perUnitPrice({ included: 168000, excluded: 152728 }, 6)
 * // { included: 28000, excluded: 25455 }
 */
export function perUnitPrice(
  price: PriceInclExcl | null,
  quantity: number
): PriceInclExcl | null {
  if (price === null || !(quantity >= 1)) return null
  return {
    included: Math.round(price.included / quantity),
    excluded:
      price.excluded === null ? null : Math.round(price.excluded / quantity),
  }
}

/**
 * 구성 기준가 합계 of a 묶음상품: Σ (기준상품's price × quantity), as
 * 부가세 포함 and as 부가세 별도 (each 기준상품's own 부가세 별도 amount by
 * its 과세구분, × quantity) — 판매가 by default, or 매입가 (`kind`).
 * Null when there are no 기준상품, a quantity is not known yet, or any of
 * them has no such price.
 * @example componentPriceTotal([
 *   { taxType: "taxable", salePriceInclVat: 28500, purchasePriceInclVat: null, quantity: 6 },
 * ]) // { included: 171000, excluded: 155460 }  (28,500 → 별도 25,910, × 6)
 */
export function componentPriceTotal(
  components: readonly BundlePriceComponent[],
  kind: PriceKind = "sale"
): { included: number; excluded: number } | null {
  if (components.length === 0) return null
  let included = 0
  let excluded = 0
  for (const component of components) {
    const price = priceOf(component, kind)
    if (price === null || component.quantity === null) return null
    included += price * component.quantity
    excluded +=
      excludedOf(price, component.taxType === "taxable") * component.quantity
  }
  return { included, excluded }
}

// ---------------------------------------------------------------------------
// The list's 구성 column
// ---------------------------------------------------------------------------

/**
 * 구성 summary of a product: "" for a 기준상품, "×6" for a 묶음상품 of one
 * kind of 기준상품 (6개입), "혼합 3종" for several kinds, "구성 없음" for a
 * 묶음상품 without 기준상품 (should not happen; the app always saves one).
 */
export function formatComposition(product: {
  productType: ProductType
  componentCount: number
  singleComponentQuantity: number | null
}): string {
  if (product.productType !== "bundle") return ""
  if (product.componentCount === 0) return "구성 없음"
  if (
    product.componentCount === 1 &&
    product.singleComponentQuantity !== null
  ) {
    return `×${formatCount(product.singleComponentQuantity)}`
  }
  return `혼합 ${product.componentCount}종`
}
