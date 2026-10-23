/**
 * 부가세 (VAT) arithmetic for prices, shared by the browser and the server
 * (no server imports, so Client Components may use it).
 *
 * Rules (decided by the owner, 2026-10-22):
 * - Every price is typed and stored VAT-INCLUSIVE (부가세 포함). The
 *   VAT-exclusive amount (부가세 별도) and the 부가세 are always worked out
 *   from it and never stored. (Storing 부가세 별도 and adding the 부가세 back
 *   would turn a typed 12,000 into 12,001.)
 * - 부가세 below 1 원 is cut off (버림). For a VAT-inclusive amount P:
 *     과세: 부가세 = floor(P ÷ 11), 부가세 별도 = P − 부가세
 *     면세: 부가세 = 0,            부가세 별도 = P
 * - 혼합 (a 묶음상품 with 과세 and 면세 기준상품): P is split by the price
 *   ratio of its 기준상품 (mixedWeights + allocateMixed).
 *
 * The database computes exactly the same numbers (functions
 * vat_excluded_amount, mixed_taxable_amount, mixed_vat_excluded_amount and
 * the view product_list_items in supabase/migrations/*_vat_inclusive_prices.sql):
 * change both together. The future 정산 module uses these rules too.
 *
 * Amounts are whole won. A negative amount (e.g. a refund) gives the same
 * numbers with a minus sign.
 */

/**
 * 부가세 is 10% of the 부가세 별도 amount, so a VAT-inclusive amount is 11
 * parts: 10 parts 별도 + 1 part 부가세.
 */
const VAT_PARTS = 11

// ---------------------------------------------------------------------------
// 과세 / 면세
// ---------------------------------------------------------------------------

/**
 * 부가세 inside a VAT-inclusive amount: 과세 (`taxable` true) →
 * floor(amount ÷ 11), the part below 1 원 cut off (버림); 면세 → 0.
 * @example vatOf(12000, true) // 1090
 * @example vatOf(1358, true) // 123
 * @example vatOf(12000, false) // 0 (면세)
 */
export function vatOf(amountInclVat: number, taxable: boolean): number {
  if (!taxable) return 0
  // The whole part of amount ÷ 11: taking the remainder off first keeps the
  // division exact (same as the database's whole-number division).
  return (amountInclVat - (amountInclVat % VAT_PARTS)) / VAT_PARTS
}

/**
 * 부가세 별도 amount of a VAT-inclusive amount: amount − vatOf(amount).
 * @example excludedOf(12000, true) // 10910
 * @example excludedOf(1358, true) // 1235
 * @example excludedOf(12000, false) // 12000 (면세: unchanged)
 */
export function excludedOf(amountInclVat: number, taxable: boolean): number {
  return amountInclVat - vatOf(amountInclVat, taxable)
}

// ---------------------------------------------------------------------------
// 혼합 (과세 and 면세 together)
// ---------------------------------------------------------------------------

/**
 * Weights for splitting a 혼합 amount: Σ (price × quantity) of the 과세
 * lines (`taxable`) and of all lines (`total`). Prices are VAT-inclusive.
 */
export type MixedWeights = { taxable: number; total: number }

/** One line for mixedWeights: e.g. a 기준상품 of a 묶음상품. */
export type MixedWeightLine = {
  /** 과세 (true) or 면세 (false). */
  taxable: boolean
  /** VAT-inclusive price, or null when it is not filled in. */
  price: number | null
  quantity: number
}

/**
 * The weights of a 혼합 split. For a 묶음상품 the lines are its 기준상품:
 * their 판매가 to split the 묶음상품's 판매가, their 매입가 to split its
 * 매입가. Null when a line has no price: then the amount cannot be split
 * (the screen shows "-" for 부가세 별도 and 부가세).
 * @example mixedWeights([
 *   { taxable: true, price: 28500, quantity: 2 },
 *   { taxable: false, price: 11000, quantity: 1 },
 * ]) // { taxable: 57000, total: 68000 }
 */
export function mixedWeights(
  lines: readonly MixedWeightLine[]
): MixedWeights | null {
  let taxable = 0
  let total = 0
  for (const line of lines) {
    if (line.price === null) return null
    const weight = line.price * line.quantity
    total += weight
    if (line.taxable) taxable += weight
  }
  // Larger sums are no longer exact in JavaScript numbers.
  if (!Number.isSafeInteger(total)) return null
  return { taxable, total }
}

/** A 혼합 VAT-inclusive amount split into its 과세 and 면세 parts. */
export type MixedAllocation = {
  /** 과세 part T of the VAT-inclusive amount. */
  taxable: number
  /** 면세 part: amount − T. */
  exempt: number
  /** 부가세: floor(T ÷ 11). The 면세 part has none. */
  vat: number
  /** 부가세 별도: amount − 부가세. */
  excluded: number
}

/**
 * Splits a 혼합 VAT-inclusive amount by the price ratio of its lines:
 *   과세 part T = round(amount × weights.taxable ÷ weights.total), 0.5 up
 *   면세 part   = amount − T
 *   부가세      = floor(T ÷ 11)
 *   부가세 별도 = amount − 부가세
 * Null when there are no weights or they cannot be used (total not above
 * 0, taxable below 0 or above total): the screen then shows "-".
 * @example allocateMixed(10000, { taxable: 6000, total: 8000 })
 * // { taxable: 7500, exempt: 2500, vat: 681, excluded: 9319 }
 * @example allocateMixed(145000, { taxable: 139500, total: 150500 })
 * // { taxable: 134402, exempt: 10598, vat: 12218, excluded: 132782 }
 */
export function allocateMixed(
  amountInclVat: number,
  weights: MixedWeights | null
): MixedAllocation | null {
  if (weights === null) return null
  if (
    !Number.isSafeInteger(amountInclVat) ||
    !Number.isSafeInteger(weights.taxable) ||
    !Number.isSafeInteger(weights.total) ||
    weights.total <= 0 ||
    weights.taxable < 0 ||
    weights.taxable > weights.total
  ) {
    return null
  }

  // round(|amount| × taxable ÷ total) with 0.5 rounded up, using whole
  // numbers only: floor((2 × |amount| × taxable + total) ÷ (2 × total)).
  // BigInt because amount × taxable can be larger than JavaScript numbers
  // hold exactly. (Same formula as the database's mixed_taxable_amount.)
  const two = BigInt(2)
  const total = BigInt(weights.total)
  const rounded =
    (two * BigInt(Math.abs(amountInclVat)) * BigInt(weights.taxable) + total) /
    (two * total)
  const taxable = Number(amountInclVat < 0 ? -rounded : rounded)

  const vat = vatOf(taxable, true)
  return {
    taxable,
    exempt: amountInclVat - taxable,
    vat,
    excluded: amountInclVat - vat,
  }
}

// ---------------------------------------------------------------------------
// One price by its 과세구분 in effect
// ---------------------------------------------------------------------------

/** A VAT-inclusive price with its 부가세 별도 amount and 부가세. */
export type VatSplit = {
  /** 부가세 포함 (as typed and stored). */
  included: number
  /** 부가세 별도. */
  excluded: number
  /** 부가세 (included − excluded). */
  vat: number
}

/**
 * A VAT-inclusive price split by the 과세구분 in effect (`taxType`, an
 * EffectiveTaxType value):
 * - "taxable" (과세) / "exempt" (면세): vatOf / excludedOf;
 * - "mixed" (혼합 묶음상품): allocateMixed with `weights` (mixedWeights).
 * Null when the price is empty, the 과세구분 is not known (null, or e.g. ""
 * while the form has none chosen yet), or a 혼합 price cannot be split.
 * The product list gets the same numbers from the view product_list_items
 * (purchase_price_excl_vat, purchase_vat, sale_price_excl_vat, sale_vat).
 * @example splitVat(12000, "taxable") // { included: 12000, excluded: 10910, vat: 1090 }
 * @example splitVat(35000, "exempt") // { included: 35000, excluded: 35000, vat: 0 }
 * @example splitVat(10000, "mixed", { taxable: 6000, total: 8000 })
 * // { included: 10000, excluded: 9319, vat: 681 }
 */
export function splitVat(
  amountInclVat: number | null,
  taxType: string | null,
  weights: MixedWeights | null = null
): VatSplit | null {
  if (amountInclVat === null) return null
  if (taxType === "taxable" || taxType === "exempt") {
    const vat = vatOf(amountInclVat, taxType === "taxable")
    return { included: amountInclVat, excluded: amountInclVat - vat, vat }
  }
  if (taxType === "mixed") {
    const split = allocateMixed(amountInclVat, weights)
    if (split === null) return null
    return {
      included: amountInclVat,
      excluded: split.excluded,
      vat: split.vat,
    }
  }
  return null
}
