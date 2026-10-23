"use client"

import { EqualIcon, TriangleAlertIcon } from "lucide-react"
import { memo } from "react"
import { useWatch, type FieldErrors, type UseFormReturn } from "react-hook-form"

import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridEmpty,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { ExpiryText } from "@/components/inventory/expiry-badge"
import { Input } from "@/components/ui/input"
import { EMPTY_VALUE, formatNumber } from "@/lib/format"
import {
  formatStockQuantity,
  STOCK_LIMITS,
  storageFit,
} from "@/lib/inventory/constants"
import type { CountSheetLine } from "@/lib/inventory/queries"
import type {
  CountFormInput,
  CountFormValues,
  CountLineInput,
} from "@/lib/inventory/schema"
import { storageTypeLabel } from "@/lib/products/constants"
import { cn } from "@/lib/utils"

import {
  differenceMilli,
  differenceValue,
  fromMilli,
  lineKey,
  quantityText,
} from "./count-helpers"
import { QuantityInput } from "./count-ui"

export type CountFormApi = UseFormReturn<
  CountFormInput,
  unknown,
  CountFormValues
>

type LineErrors = NonNullable<FieldErrors<CountFormInput>["lines"]>

const COLUMN_COUNT = 11

/** Id of a 실사 line's 실사 수량 box (to focus it). */
export function countedInputId(index: number): string {
  return `count-line-${index}-counted`
}

/**
 * The messages of one 실사 line (any field, e.g. a 전산 수량 that changed
 * since the list was read), joined.
 */
export function lineErrorMessage(
  errors: LineErrors | undefined,
  index: number
): string | null {
  const lineErrors = errors?.[index] as
    (FieldErrors<CountLineInput> & { message?: string }) | undefined
  if (!lineErrors) return null
  const messages = [
    lineErrors.message,
    lineErrors.countedQuantity?.message,
    lineErrors.systemQuantity?.message,
    lineErrors.lotId?.message,
    lineErrors.locationId?.message,
    lineErrors.memo?.message,
  ].filter((message): message is string => !!message)
  return messages.length > 0 ? [...new Set(messages)].join(" ") : null
}

/**
 * The 실사 목록: one row per (lot, 위치) with stock at the 실사 date, in
 * 창고·구역·위치 order. Only `indexes` (rows of the filter) are shown; the
 * other rows keep their typed values.
 *
 * Each row: 위치, 상품, 로트, 기한 (D-day badge), 전산 수량, 실사 수량 (a box;
 * empty = not counted, the line stays as it is), [=] (실사 수량 = 전산 수량),
 * 차이 (+ more, − less) and its value, 메모. A row whose 전산 수량 changed
 * when the list was read again is marked amber with the old quantity.
 */
export function CountSheetTable({
  form,
  lines,
  indexes,
  version,
  warningDays,
  changedFrom,
  errors,
  emptyMessage,
}: {
  form: CountFormApi
  lines: readonly CountSheetLine[]
  /** The rows to show (form indexes), in order. */
  indexes: readonly number[]
  /** Changes when a new 실사 목록 is loaded (rows start again). */
  version: number
  warningDays: number
  /** lineKey → the 전산 수량 before the list was read again. */
  changedFrom: ReadonlyMap<string, number>
  errors: LineErrors | undefined
  emptyMessage: React.ReactNode
}) {
  return (
    <DataGrid
      aria-label="실사 목록"
      containerClassName="max-h-[min(34rem,58dvh)]"
      className={indexes.length > 0 ? "min-w-[78rem]" : undefined}
    >
      <DataGridHeader>
        <tr>
          <DataGridHead className="w-10">줄</DataGridHead>
          <DataGridHead className="w-44">위치</DataGridHead>
          <DataGridHead className="min-w-52">상품</DataGridHead>
          <DataGridHead className="w-32">로트번호</DataGridHead>
          <DataGridHead className="w-52">기한</DataGridHead>
          <DataGridHead className="w-28">전산 수량</DataGridHead>
          <DataGridHead className="w-40">실사 수량</DataGridHead>
          <DataGridHead className="w-28">차이</DataGridHead>
          <DataGridHead className="w-28">
            조정 금액
            <span className="block text-[11px] leading-3 font-normal">
              (부가세 포함)
            </span>
          </DataGridHead>
          <DataGridHead className="w-24">입고단가</DataGridHead>
          <DataGridHead className="min-w-40">메모</DataGridHead>
        </tr>
      </DataGridHeader>
      <DataGridBody>
        {indexes.length === 0 && (
          <DataGridEmpty colSpan={COLUMN_COUNT}>{emptyMessage}</DataGridEmpty>
        )}
        {indexes.map((index) => {
          const line = lines[index]
          const key = lineKey(line.lotId, line.locationId)
          return (
            <CountSheetRow
              key={`${version}:${index}`}
              form={form}
              index={index}
              line={line}
              warningDays={warningDays}
              previousQuantity={changedFrom.get(key) ?? null}
              error={lineErrorMessage(errors, index)}
            />
          )
        })}
      </DataGridBody>
    </DataGrid>
  )
}

/** One row of the 실사 목록 (re-renders only when its own value changes). */
const CountSheetRow = memo(function CountSheetRow({
  form,
  index,
  line,
  warningDays,
  previousQuantity,
  error,
}: {
  form: CountFormApi
  index: number
  line: CountSheetLine
  warningDays: number
  previousQuantity: number | null
  error: string | null
}) {
  const counted =
    useWatch({
      control: form.control,
      name: `lines.${index}.countedQuantity`,
    }) ?? ""
  const systemText = quantityText(line.systemQuantity)
  const difference = differenceMilli(systemText, counted)
  const typed = counted.trim() !== ""
  const fit = storageFit(line.productStorageType, line.zoneStorageType)
  const errorId = `count-line-${index}-error`
  const label = `${line.productName} 로트 ${line.lotNo}`

  return (
    <>
      <DataGridRow
        data-error={error ? "true" : undefined}
        className={cn(
          previousQuantity !== null && "bg-chart-4/15 even:bg-chart-4/15",
          error && "bg-destructive/5 even:bg-destructive/5"
        )}
      >
        <DataGridCell numeric className="text-muted-foreground">
          {index + 1}
        </DataGridCell>
        <DataGridCell
          className="max-w-44 truncate"
          title={`${line.warehouseName} > ${line.zoneName} > ${line.locationCode}`}
        >
          <span className="text-muted-foreground">{line.zoneName} &gt; </span>
          <span className="font-bold">{line.locationCode}</span>
          {fit.mismatch && (
            <span
              className={cn(
                "ml-1 inline-flex items-center align-middle",
                fit.tooWarm ? "text-destructive" : "text-muted-foreground"
              )}
              title={`보관온도 불일치: ${storageTypeLabel(line.productStorageType)} 상품이 ${storageTypeLabel(line.zoneStorageType)} 구역에 있습니다.`}
            >
              <TriangleAlertIcon aria-hidden="true" className="size-3.5" />
              <span className="sr-only">
                보관온도 불일치 ({storageTypeLabel(line.productStorageType)}{" "}
                상품, {storageTypeLabel(line.zoneStorageType)} 구역)
              </span>
            </span>
          )}
        </DataGridCell>
        <DataGridCell
          className="max-w-72 truncate"
          title={`${line.productCode} ${line.productName}${line.productSpec ? ` (${line.productSpec})` : ""}`}
        >
          <span className="text-muted-foreground tabular-nums">
            {line.productCode}
          </span>{" "}
          <span className="font-bold">{line.productName}</span>
          {line.productSpec && (
            <span className="text-muted-foreground"> {line.productSpec}</span>
          )}
        </DataGridCell>
        <DataGridCell className="max-w-32 truncate tabular-nums">
          {line.lotNo}
        </DataGridCell>
        <DataGridCell>
          <ExpiryText
            kind={line.expiryKind}
            date={line.expiryDate}
            daysLeft={line.daysLeft}
            warningDays={warningDays}
          />
        </DataGridCell>
        <DataGridCell numeric>
          {formatStockQuantity(line.systemQuantity, line.productUnit)}
          {previousQuantity !== null && (
            <span className="block text-[11px] leading-3 text-muted-foreground">
              이전{" "}
              {formatNumber(previousQuantity, STOCK_LIMITS.quantityDecimals)}
            </span>
          )}
        </DataGridCell>
        <DataGridCell className="py-0.5">
          <span className="flex items-center gap-1">
            <QuantityInput
              id={countedInputId(index)}
              unit={line.productUnit}
              aria-label={`${label} 실사 수량`}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              placeholder="미입력"
              containerClassName="w-28"
              data-counted-input=""
              onKeyDown={moveBetweenRows}
              {...form.register(`lines.${index}.countedQuantity`)}
            />
            <button
              type="button"
              tabIndex={-1}
              title="전산 수량과 같음 (실사 수량에 전산 수량 넣기)"
              aria-label={`${label}: 전산 수량과 같음`}
              onClick={() =>
                form.setValue(`lines.${index}.countedQuantity`, systemText, {
                  shouldDirty: true,
                })
              }
              className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-input text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <EqualIcon aria-hidden="true" className="size-3.5" />
            </button>
          </span>
        </DataGridCell>
        <DataGridCell numeric>
          <DifferenceText
            typed={typed}
            difference={difference}
            unit={line.productUnit}
          />
        </DataGridCell>
        <DataGridCell numeric>
          {difference === null || difference === 0 ? (
            EMPTY_VALUE
          ) : (
            <SignedAmount
              value={differenceValue(difference, line.effectiveUnitCostInclVat)}
              estimated={line.costEstimated}
            />
          )}
        </DataGridCell>
        <DataGridCell
          numeric
          className="text-muted-foreground"
          title={line.costEstimated ? ESTIMATED_COST_NOTE : undefined}
        >
          {line.effectiveUnitCostInclVat === null
            ? EMPTY_VALUE
            : formatNumber(line.effectiveUnitCostInclVat, 0)}
          {line.costEstimated && <EstimatedMark />}
        </DataGridCell>
        <DataGridCell className="py-0.5">
          <Input
            aria-label={`${label} 메모`}
            maxLength={STOCK_LIMITS.memoMaxLength}
            autoComplete="off"
            className="h-7 min-w-36 rounded-sm"
            {...form.register(`lines.${index}.memo`)}
          />
        </DataGridCell>
      </DataGridRow>
      {error && (
        <tr>
          <td
            id={errorId}
            colSpan={COLUMN_COUNT}
            className="border-b border-grid-line bg-destructive/5 px-2 py-1 text-xs font-bold whitespace-normal text-destructive"
          >
            {index + 1}번째 줄: {error}
          </td>
        </tr>
      )}
    </>
  )
})

/**
 * Enter or ↓ in a 실사 수량 box goes to the next shown row's box, ↑ to the
 * previous one (Enter never saves the form: saving is F8).
 */
function moveBetweenRows(event: React.KeyboardEvent<HTMLInputElement>) {
  const step =
    event.key === "Enter" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowUp"
        ? -1
        : 0
  if (step === 0 || event.nativeEvent.isComposing) return
  event.preventDefault()
  const table = event.currentTarget.closest("table")
  if (!table) return
  const inputs = Array.from(
    table.querySelectorAll<HTMLInputElement>("input[data-counted-input]")
  )
  const next = inputs[inputs.indexOf(event.currentTarget) + step]
  if (next) {
    next.focus()
    next.select()
  }
}

/** "+2 kg" (brand), "−1 통" (red), "0" (same), "확인" (not a number). */
export function DifferenceText({
  typed,
  difference,
  unit,
}: {
  typed: boolean
  difference: number | null
  unit: string
}) {
  if (!typed)
    return <span className="text-muted-foreground">{EMPTY_VALUE}</span>
  if (difference === null) {
    return <span className="font-bold text-destructive">숫자 확인</span>
  }
  if (difference === 0) {
    return <span className="text-muted-foreground">같음</span>
  }
  const quantity = formatStockQuantity(fromMilli(Math.abs(difference)), unit)
  return difference > 0 ? (
    <span className="font-bold text-brand">+{quantity}</span>
  ) : (
    <span className="font-bold text-destructive">−{quantity}</span>
  )
}

/** Why a 단가 or 금액 has "*" (same note as 재고처별 재고현황). */
export const ESTIMATED_COST_NOTE =
  "이 로트에 입고단가가 없어 상품의 기본 매입가로 계산했습니다."

/** The "*" after a 단가 / 금액 worked out with the 기본 매입가. */
function EstimatedMark() {
  return (
    <>
      <sup aria-hidden="true" className="ml-0.5 text-muted-foreground">
        *
      </sup>
      <span className="sr-only"> ({ESTIMATED_COST_NOTE})</span>
    </>
  )
}

/**
 * "+12,000" / "−9,000" (won); "*" when the 기본 매입가 stands in for the
 * 입고 단가 (`estimated`); "-" when no 단가 is known at all.
 */
export function SignedAmount({
  value,
  estimated = false,
}: {
  value: number | null
  estimated?: boolean
}) {
  if (value === null) {
    return (
      <span
        className="text-muted-foreground"
        title="입고 단가도 기본 매입가도 없는 로트"
      >
        {EMPTY_VALUE}
      </span>
    )
  }
  const text =
    value === 0
      ? "0"
      : value > 0
        ? `+${formatNumber(value, 0)}`
        : `−${formatNumber(-value, 0)}`
  return (
    <span
      className={value > 0 ? "text-brand" : value < 0 ? "text-destructive" : ""}
      title={estimated ? ESTIMATED_COST_NOTE : undefined}
    >
      {text}
      {estimated && <EstimatedMark />}
    </span>
  )
}
