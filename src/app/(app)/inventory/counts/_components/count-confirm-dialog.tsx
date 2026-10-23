"use client"

import { LoaderCircleIcon } from "lucide-react"
import { useWatch } from "react-hook-form"

import { ActionButton } from "@/components/erp/action-bar"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { EMPTY_VALUE, formatNumber } from "@/lib/format"
import {
  expiryKindLabel,
  formatStockQuantity,
  suggestExpiryDate,
  type ExpiryKind,
} from "@/lib/inventory/constants"
import type { CountSheetLine } from "@/lib/inventory/queries"
import type { CountNewLotInput } from "@/lib/inventory/schema"
import type { BaseProductOption } from "@/lib/products/bundle"
import { cn } from "@/lib/utils"

import { differenceValue, fromMilli } from "./count-helpers"
import type { ScopeLocation } from "./count-new-lots"
import {
  DifferenceText,
  SignedAmount,
  type CountFormApi,
} from "./count-sheet-table"
import { summarize, type CountSummary } from "./count-summary"

/** Rows of the confirm dialog's list of changes. */
const CONFIRM_ROWS_SHOWN = 50

/** "전체 48줄 · 입력 12줄 · 늘어남 2줄 (+12,000원) · …" (live). */
export function CountSummaryBar({
  form,
  lines,
  shown,
}: {
  form: CountFormApi
  lines: readonly CountSheetLine[]
  /** Rows shown by the filter. */
  shown: number
}) {
  const values = useWatch({ control: form.control, name: "lines" })
  const lots = useWatch({ control: form.control, name: "newLots" })
  const summary = summarize(lines, values ?? [], lots?.length ?? 0)
  return (
    <p
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px]"
    >
      <span>
        전체{" "}
        <strong className="font-bold">{formatNumber(lines.length, 0)}</strong>줄
        {shown !== lines.length && ` (보이는 줄 ${formatNumber(shown, 0)})`}
      </span>
      <span>
        입력{" "}
        <strong className="font-bold text-brand">
          {formatNumber(summary.counted, 0)}
        </strong>
        줄
      </span>
      <span>
        늘어남{" "}
        <strong className="font-bold text-brand">
          {formatNumber(summary.increased, 0)}
        </strong>
        줄{summary.valueIn > 0 && ` (+${formatNumber(summary.valueIn, 0)}원)`}
      </span>
      <span>
        줄어듦{" "}
        <strong className="font-bold text-destructive">
          {formatNumber(summary.decreased, 0)}
        </strong>
        줄{summary.valueOut > 0 && ` (−${formatNumber(summary.valueOut, 0)}원)`}
      </span>
      <span>같음 {formatNumber(summary.unchanged, 0)}줄</span>
      {summary.newLots > 0 && (
        <span>발견 재고 {formatNumber(summary.newLots, 0)}줄</span>
      )}
      {summary.invalid > 0 && (
        <span className="font-bold text-destructive">
          숫자 확인 {formatNumber(summary.invalid, 0)}줄
        </span>
      )}
      {summary.costEstimated && (
        <span className="text-xs text-muted-foreground">
          (* 입고단가가 없어 기본 매입가로 계산)
        </span>
      )}
      {summary.costMissing && (
        <span className="text-xs text-muted-foreground">
          (입고 단가도 기본 매입가도 없는 로트는 금액에서 빠짐)
        </span>
      )}
    </p>
  )
}

/**
 * The last look before saving: 범위, 일자, 사유, every line that changes
 * (전산 → 실사, 차이), the 발견 재고, and the totals. F8 again saves.
 */
export function CountConfirmDialog({
  summary,
  form,
  products,
  locations,
  scope,
  asOf,
  saving,
  onConfirm,
  onCancel,
}: {
  summary: CountSummary
  form: CountFormApi
  products: ReadonlyMap<string, BaseProductOption>
  locations: readonly ScopeLocation[]
  scope: string
  asOf: string
  saving: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const values = form.getValues()
  const shownChanges = summary.changes.slice(0, CONFIRM_ROWS_SHOWN)
  return (
    <ErpDialog
      open
      size="lg"
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title="실사 조정 저장"
      footer={
        <>
          <ActionButton
            variant="secondary"
            size="lg"
            disabled={saving}
            onClick={onCancel}
          >
            돌아가기
          </ActionButton>
          <ActionButton
            size="lg"
            keyHint="F8"
            disabled={saving}
            onClick={onConfirm}
          >
            {saving && (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            )}
            {saving ? "저장 중…" : "저장"}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="font-bold">실사 범위</dt>
          <dd>{scope}</dd>
          <dt className="font-bold">실사 일자</dt>
          <dd className="tabular-nums">{asOf}</dd>
          <dt className="font-bold">사유</dt>
          <dd>{values.memo.trim()}</dd>
          <dt className="font-bold">조정</dt>
          <dd>
            늘어남{" "}
            <strong className="text-brand">
              {formatNumber(summary.increased, 0)}줄
            </strong>
            {summary.valueIn > 0 && ` (+${formatNumber(summary.valueIn, 0)}원)`}
            {" · "}줄어듦{" "}
            <strong className="text-destructive">
              {formatNumber(summary.decreased, 0)}줄
            </strong>
            {summary.valueOut > 0 &&
              ` (−${formatNumber(summary.valueOut, 0)}원)`}
            {summary.newLots > 0 &&
              ` · 발견 재고 ${formatNumber(summary.newLots, 0)}줄`}
            {summary.unchanged > 0 &&
              ` · 같음 ${formatNumber(summary.unchanged, 0)}줄 (그대로)`}
          </dd>
        </dl>

        {shownChanges.length > 0 && (
          <div className="overflow-x-auto border border-input">
            <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-xs">
              <thead>
                <tr className="bg-label">
                  {[
                    "줄",
                    "위치",
                    "상품",
                    "로트번호",
                    "전산",
                    "실사",
                    "차이",
                  ].map((title) => (
                    <th
                      key={title}
                      scope="col"
                      className="border-b border-grid-line px-2 py-1 font-bold whitespace-nowrap"
                    >
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shownChanges.map(({ index, line, difference }) => (
                  <tr key={index}>
                    <td className="border-b border-grid-line px-2 py-1 text-right tabular-nums">
                      {index + 1}
                    </td>
                    <td className="border-b border-grid-line px-2 py-1 whitespace-nowrap">
                      {line.zoneName} &gt; {line.locationCode}
                    </td>
                    <td className="border-b border-grid-line px-2 py-1">
                      {line.productName}
                    </td>
                    <td className="border-b border-grid-line px-2 py-1 tabular-nums">
                      {line.lotNo}
                    </td>
                    <td className="border-b border-grid-line px-2 py-1 text-right whitespace-nowrap tabular-nums">
                      {formatStockQuantity(
                        line.systemQuantity,
                        line.productUnit
                      )}
                    </td>
                    <td className="border-b border-grid-line px-2 py-1 text-right whitespace-nowrap tabular-nums">
                      {formatStockQuantity(
                        fromMilli(
                          Math.round(line.systemQuantity * 1000) + difference
                        ),
                        line.productUnit
                      )}
                    </td>
                    <td className="border-b border-grid-line px-2 py-1 text-right whitespace-nowrap tabular-nums">
                      <DifferenceText
                        typed
                        difference={difference}
                        unit={line.productUnit}
                      />{" "}
                      <span className="text-muted-foreground">
                        <SignedAmount
                          value={differenceValue(
                            difference,
                            line.effectiveUnitCostInclVat
                          )}
                          estimated={line.costEstimated}
                        />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {summary.changes.length > shownChanges.length && (
              <p className="px-2 py-1 text-muted-foreground">
                외{" "}
                {formatNumber(summary.changes.length - shownChanges.length, 0)}
                줄 (실사 목록의 ‘차이 있는 줄’에서 볼 수 있습니다)
              </p>
            )}
          </div>
        )}

        {values.newLots.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="font-bold">발견 재고 (새 로트)</p>
            <ul className="flex list-disc flex-col gap-0.5 pl-5">
              {values.newLots.map((lot, index) => (
                <NewLotLine
                  key={index}
                  lot={lot}
                  product={products.get(lot.productId) ?? null}
                  location={
                    locations.find((item) => item.id === lot.locationId) ?? null
                  }
                />
              ))}
            </ul>
          </div>
        )}

        <p className="text-muted-foreground">
          저장하면 차이만큼 재고가 바로 바뀝니다. 실사 전표는 고칠 수 없고, 잘못
          저장했다면 전표를 열어 [전표 취소]로 되돌립니다.
        </p>
      </div>
    </ErpDialog>
  )
}

function NewLotLine({
  lot,
  product,
  location,
}: {
  lot: CountNewLotInput
  product: BaseProductOption | null
  location: ScopeLocation | null
}) {
  const expiry =
    lot.expiryKind === "none"
      ? "기한 없음"
      : lot.expiryDate
        ? `${expiryKindLabel(lot.expiryKind as ExpiryKind)} ${lot.expiryDate}`
        : `${expiryKindLabel(lot.expiryKind as ExpiryKind)} 자동 (${
            suggestExpiryDate(
              lot.manufacturedDate || null,
              product?.shelfLifeDays ?? null
            ) ?? EMPTY_VALUE
          })`
  return (
    <li className={cn(!product && "text-muted-foreground")}>
      {product ? `${product.code} ${product.name}` : "상품"} ·{" "}
      <strong className="font-bold text-brand">
        +{lot.quantity.trim()} {product?.unit ?? ""}
      </strong>{" "}
      · {location?.label ?? "위치 미선택"} · {expiry}
      {lot.lotNo.trim() ? ` · 로트 ${lot.lotNo.trim()}` : " · 로트 자동"}
    </li>
  )
}
