/**
 * What a 실사 would change, worked out from the 실사 목록 and the typed
 * 실사 수량 (shown live above the list and in the confirm before saving).
 * No server imports, no React.
 */

import type { CountSheetLine } from "@/lib/inventory/queries"
import type { CountLineInput } from "@/lib/inventory/schema"

import { differenceMilli, differenceValue } from "./count-helpers"

/** A counted line that differs from its 전산 수량. */
export type ChangeRow = {
  index: number
  line: CountSheetLine
  difference: number
}

/** What a save would change (also shown live above the 실사 목록). */
export type CountSummary = {
  /** Lines with a 실사 수량. */
  counted: number
  /** Lines whose 실사 수량 is not a valid number. */
  invalid: number
  increased: number
  decreased: number
  unchanged: number
  /**
   * 부가세 포함: × the lot's 입고 단가, or the product's 기본 매입가 when
   * the lot has none (costEstimated); lots with neither are left out.
   */
  valueIn: number
  valueOut: number
  /** A changed lot uses the 기본 매입가 (no 입고 단가). */
  costEstimated: boolean
  /** A changed lot has neither (left out of the values). */
  costMissing: boolean
  newLots: number
  changes: ChangeRow[]
}

export function summarize(
  lines: readonly CountSheetLine[],
  values: readonly CountLineInput[],
  newLotCount: number
): CountSummary {
  const summary: CountSummary = {
    counted: 0,
    invalid: 0,
    increased: 0,
    decreased: 0,
    unchanged: 0,
    valueIn: 0,
    valueOut: 0,
    costEstimated: false,
    costMissing: false,
    newLots: newLotCount,
    changes: [],
  }
  lines.forEach((line, index) => {
    const value = values[index]
    if (!value || value.countedQuantity.trim() === "") return
    summary.counted++
    const difference = differenceMilli(
      value.systemQuantity,
      value.countedQuantity
    )
    if (difference === null) {
      summary.invalid++
      return
    }
    if (difference === 0) {
      summary.unchanged++
      return
    }
    summary.changes.push({ index, line, difference })
    const amount = differenceValue(difference, line.effectiveUnitCostInclVat)
    if (amount === null) summary.costMissing = true
    if (line.costEstimated) summary.costEstimated = true
    if (difference > 0) {
      summary.increased++
      summary.valueIn += amount ?? 0
    } else {
      summary.decreased++
      summary.valueOut += -(amount ?? 0)
    }
  })
  return summary
}
