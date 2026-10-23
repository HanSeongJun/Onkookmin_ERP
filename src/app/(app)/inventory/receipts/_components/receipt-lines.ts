/**
 * The 입고 preview of one line (client-safe): the 기준상품 it becomes
 * (itself, or a 묶음상품's 구성상품 × 수량), each one's share of the
 * 입고단가 (splitBundleUnitCost — the same rule as the database), its 기한일
 * and the amounts with and without 부가세.
 */

import {
  splitBundleUnitCost,
  suggestExpiryDate,
} from "@/lib/inventory/constants"
import type { StockProductOption } from "@/lib/inventory/queries"
import type { ReceiptLineInput } from "@/lib/inventory/schema"
import type { StorageType, TaxType } from "@/lib/products/constants"
import { excludedOf } from "@/lib/products/vat"

import {
  amountValue,
  quantityValue,
} from "@/components/inventory/number-inputs"

/** One 기준상품 a 입고 line becomes (one lot each). */
export type ReceiptLinePart = {
  productId: string
  code: string
  name: string
  unit: string
  storageType: StorageType | null
  /** 1 for a 기준상품; the 구성 수량 for a 묶음상품's 구성상품. */
  quantityPerUnit: number
  /** Line 수량 × quantityPerUnit (null while the 수량 is not a number). */
  quantity: number | null
  /** 입고단가 per unit of this 기준상품 (부가세 포함), or null. */
  unitCost: number | null
  /** The 기한일 the lot gets (typed, or from 제조일자); null = none / not known. */
  expiryDate: string | null
  taxType: TaxType | null
  amountInclVat: number | null
  amountExclVat: number | null
}

export type ReceiptLinePreview = {
  parts: ReceiptLinePart[]
  /** How the 단가 was shared ("direct" for a 기준상품). */
  rule: "direct" | "price_weight" | "quantity"
  /** 부가세 별도 per unit of the line's product (묶음상품: Σ of its parts). */
  unitCostExclVat: number | null
  /**
   * The line's amount (부가세 포함): 수량 × the typed 단가 — for a 묶음상품
   * too, exactly as typed (the 전표's value; its 기준상품 lots get whole-won
   * shares of the 단가, so their worth may differ a little).
   */
  amountInclVat: number | null
  amountExclVat: number | null
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function sumOrNull(values: (number | null)[]): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
}

/**
 * The preview of a 입고 line. `taxTypes`: 과세구분 by 기준상품 id (from
 * loadProductTaxTypes); a missing one leaves the 별도 amounts null ("-").
 */
export function receiptLineParts(
  product: StockProductOption,
  line: ReceiptLineInput,
  taxTypes: Readonly<Record<string, TaxType>>
): ReceiptLinePreview {
  const quantity = quantityValue(line.quantity)
  const cost = amountValue(line.unitCostInclVat)
  const hasExpiry = line.expiryKind !== "none"
  const typedExpiry = hasExpiry && line.expiryDate ? line.expiryDate : null

  if (product.productType === "base") {
    const taxType = taxTypes[product.id] ?? null
    const amountInclVat =
      quantity !== null && cost !== null ? Math.round(quantity * cost) : null
    const part: ReceiptLinePart = {
      productId: product.id,
      code: product.code,
      name: product.name,
      unit: product.unit,
      storageType: product.storageType,
      quantityPerUnit: 1,
      quantity,
      unitCost: cost,
      expiryDate: hasExpiry
        ? (typedExpiry ??
          suggestExpiryDate(line.manufacturedDate, product.shelfLifeDays))
        : null,
      taxType,
      amountInclVat,
      amountExclVat:
        amountInclVat !== null && taxType
          ? excludedOf(amountInclVat, taxType === "taxable")
          : null,
    }
    return {
      parts: [part],
      rule: "direct",
      unitCostExclVat:
        cost !== null && taxType
          ? excludedOf(cost, taxType === "taxable")
          : null,
      amountInclVat,
      amountExclVat: part.amountExclVat,
    }
  }

  const split = splitBundleUnitCost(
    cost,
    product.components.map((component) => ({
      quantityPerUnit: component.quantityPerUnit,
      purchasePriceInclVat: component.purchasePriceInclVat,
    }))
  )
  const parts = product.components.map((component, index): ReceiptLinePart => {
    const partQuantity =
      quantity === null ? null : round3(quantity * component.quantityPerUnit)
    const unitCost = split.unitCosts[index] ?? null
    const taxType = taxTypes[component.productId] ?? null
    const amountInclVat =
      partQuantity !== null && unitCost !== null
        ? Math.round(partQuantity * unitCost)
        : null
    return {
      productId: component.productId,
      code: component.code,
      name: component.name,
      unit: component.unit,
      storageType: component.storageType,
      quantityPerUnit: component.quantityPerUnit,
      quantity: partQuantity,
      unitCost,
      expiryDate: hasExpiry
        ? (typedExpiry ??
          suggestExpiryDate(line.manufacturedDate, component.shelfLifeDays))
        : null,
      taxType,
      amountInclVat,
      amountExclVat:
        amountInclVat !== null && taxType
          ? excludedOf(amountInclVat, taxType === "taxable")
          : null,
    }
  })
  return {
    parts,
    rule: split.rule,
    unitCostExclVat: sumOrNull(
      parts.map((part) =>
        part.unitCost !== null && part.taxType
          ? excludedOf(part.unitCost, part.taxType === "taxable") *
            part.quantityPerUnit
          : null
      )
    ),
    amountInclVat:
      quantity !== null && cost !== null ? Math.round(quantity * cost) : null,
    amountExclVat: sumOrNull(parts.map((part) => part.amountExclVat)),
  }
}
