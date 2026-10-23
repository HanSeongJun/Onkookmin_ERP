/**
 * Texts and links of the 전표 screens (입고 / 출고 / 폐기 / 이동 / 실사조정)
 * that share the 전표 list shell (StockDocumentListScreen).
 *
 * No server imports: Client Components and Route Handlers both use it.
 */

import {
  stockDocumentTypeLabel,
  type StockDocumentType,
} from "@/lib/inventory/constants"
import type { StockDocumentRow } from "@/lib/inventory/queries"
import {
  STOCK_DOCUMENT_SCREENS,
  type StockDocumentScreen,
} from "@/lib/inventory/schema"
import { isUuid } from "@/lib/products/schema"

/** What a 전표 list shows in its 금액 column(s). */
export type StockDocumentAmountColumns = "in" | "out" | "both" | "none"

export type StockDocumentScreenText = {
  /** "입고" — used in messages ("입고 전표", "입고할 상품"). */
  noun: string
  /** Title of the 등록 modal, e.g. "입고 등록". */
  newTitle: string
  /** Title of the 거래처 column / field, or null (폐기, 이동, 실사: none). */
  partnerLabel: string | null
  amount: StockDocumentAmountColumns
  /** File name of the 엑셀 download ("입고전표" → 입고전표_20261023.csv). */
  exportName: string
  /** Plain file name for old browsers ("receipts" → receipts_20261023.csv). */
  exportAsciiName: string
}

export const STOCK_DOCUMENT_SCREEN_TEXT: Record<
  StockDocumentScreen,
  StockDocumentScreenText
> = {
  receipt: {
    noun: "입고",
    newTitle: "입고 등록",
    partnerLabel: "매입처",
    amount: "in",
    exportName: "입고전표",
    exportAsciiName: "receipts",
  },
  issue: {
    noun: "출고",
    newTitle: "출고 등록",
    partnerLabel: "거래처",
    amount: "out",
    exportName: "출고전표",
    exportAsciiName: "issues",
  },
  disposal: {
    noun: "폐기",
    newTitle: "폐기 등록",
    partnerLabel: null,
    amount: "out",
    exportName: "폐기전표",
    exportAsciiName: "disposals",
  },
  transfer: {
    noun: "이동",
    newTitle: "재고처간 이동등록",
    partnerLabel: null,
    amount: "none",
    exportName: "이동전표",
    exportAsciiName: "transfers",
  },
  count: {
    noun: "실사조정",
    newTitle: "실사재고조정",
    partnerLabel: null,
    amount: "both",
    exportName: "실사조정전표",
    exportAsciiName: "counts",
  },
}

/**
 * The 구분 of a 전표 as the lists show it: "입고", "기초재고", or for a 취소
 * 전표 "입고취소" (the kind it undoes + 취소).
 */
export function stockDocumentKindLabel(
  row: Pick<StockDocumentRow, "docType" | "effectiveType">
): string {
  return row.docType === "reversal"
    ? `${stockDocumentTypeLabel(row.effectiveType)}취소`
    : stockDocumentTypeLabel(row.docType)
}

/** "스팸 클래식 1.81kg 외 2건" (or the one product, or "-"). */
export function stockDocumentProductsLabel(
  row: Pick<StockDocumentRow, "firstProductName" | "productCount">
): string {
  if (!row.firstProductName) return "-"
  return row.productCount > 1
    ? `${row.firstProductName} 외 ${row.productCount - 1}건`
    : row.firstProductName
}

/** The screen that lists a 전표 of this kind (취소 전표: the kind they undo). */
export function stockDocumentScreenOf(
  effectiveType: StockDocumentType
): StockDocumentScreen | null {
  for (const [screen, config] of Object.entries(STOCK_DOCUMENT_SCREENS)) {
    if (
      (config.types as readonly StockDocumentType[]).includes(effectiveType)
    ) {
      return screen as StockDocumentScreen
    }
  }
  return null
}

/** Most 재고 rows a link may carry (the URL must stay short). */
export const STOCK_LINK_BALANCES_MAX = 200

/**
 * A link that opens a 전표 screen's 등록 modal, optionally with these
 * (lot × 위치) rows already in it — e.g. the [이동] / [폐기] buttons of
 * 재고처별 재고현황 with the checked rows' balanceId:
 *   buildStockDocumentNewHref("disposal", { balanceIds })
 *   → "/inventory/disposals?modal=new&balances=<id>,<id>"
 * (폐기 and 이동 read `balances`; the other screens ignore it.)
 */
export function buildStockDocumentNewHref(
  screen: StockDocumentScreen,
  options: { balanceIds?: readonly string[] } = {}
): string {
  const query = new URLSearchParams({ modal: "new" })
  const ids = (options.balanceIds ?? [])
    .filter((id) => isUuid(id))
    .slice(0, STOCK_LINK_BALANCES_MAX)
  if (ids.length > 0) query.set("balances", ids.join(","))
  return `${STOCK_DOCUMENT_SCREENS[screen].path}?${query.toString()}`
}

/**
 * A link that opens one 전표 (보기 modal with [취소]) on its screen, e.g.
 * from 상품별 거래수불 or the dashboard:
 *   buildStockDocumentViewHref("receipt", id) → "/inventory/receipts?modal=view&id=<id>"
 * The 전표 list around it shows the default period (last 30 days); the
 * modal opens whatever the 전표's date.
 */
export function buildStockDocumentViewHref(
  screen: StockDocumentScreen,
  documentId: string
): string {
  const query = new URLSearchParams({ modal: "view", id: documentId })
  return `${STOCK_DOCUMENT_SCREENS[screen].path}?${query.toString()}`
}

/**
 * The link to a 전표 by its kind (취소 전표 → the screen of the kind they
 * undo; 기초재고 → 입고 등록), or null for an unknown kind.
 * @example stockDocumentHref("issue", id) // "/inventory/issues?modal=view&id=…"
 */
export function stockDocumentHref(
  effectiveType: StockDocumentType,
  documentId: string
): string | null {
  const screen = stockDocumentScreenOf(effectiveType)
  return screen ? buildStockDocumentViewHref(screen, documentId) : null
}

/** The `balances` param of a 등록 link (valid ids only, at most 200). */
export function parseBalanceIdsParam(value: string | null): string[] {
  if (!value) return []
  return [
    ...new Set(
      value
        .split(",")
        .map((id) => id.trim().toLowerCase())
        .filter((id) => isUuid(id))
    ),
  ].slice(0, STOCK_LINK_BALANCES_MAX)
}

/**
 * The 구분 filter of a 전표 list (URL "kind"): one of the screen's kinds
 * (입고 등록 lists 입고 and 기초재고), or null for all of them. Screens with
 * one kind ignore it.
 * @example parseStockDocumentKind("receipt", "opening") // "opening"
 */
export function parseStockDocumentKind(
  screen: StockDocumentScreen,
  value: string | string[] | null | undefined
): StockDocumentType | null {
  const text = Array.isArray(value) ? value[0] : value
  const types: readonly StockDocumentType[] =
    STOCK_DOCUMENT_SCREENS[screen].types
  return types.length > 1 && types.includes(text as StockDocumentType)
    ? (text as StockDocumentType)
    : null
}

/** The 전표 kinds a list reads: the chosen 구분, or all of the screen's. */
export function stockDocumentListTypes(
  screen: StockDocumentScreen,
  kind: StockDocumentType | null
): readonly StockDocumentType[] {
  return kind ? [kind] : STOCK_DOCUMENT_SCREENS[screen].types
}

/** `href` with the 구분 filter added (`kind`), when there is one. */
export function withStockDocumentKind(
  href: string,
  kind: StockDocumentType | null
): string {
  if (!kind) return href
  return `${href}${href.includes("?") ? "&" : "?"}kind=${kind}`
}
