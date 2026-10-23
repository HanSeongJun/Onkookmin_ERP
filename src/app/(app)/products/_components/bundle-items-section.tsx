"use client"

import { PlusIcon, XIcon } from "lucide-react"
import type { FieldError, FieldErrors } from "react-hook-form"

import { ActionButton } from "@/components/erp/action-bar"
import { FormSection } from "@/components/erp/form-table"
import { EMPTY_VALUE, formatNumber } from "@/lib/format"
import type { BaseProductOption, FoodInfo } from "@/lib/products/bundle"
import {
  allergenLabel,
  BUNDLE_ITEM_QUANTITY,
  BUNDLE_ITEMS_MAX,
  storageTypeLabel,
  taxTypeLabel,
} from "@/lib/products/constants"
import {
  buildProductModalHref,
  type BundleItemInput,
} from "@/lib/products/schema"
import { cn } from "@/lib/utils"

import { NumberInput } from "./number-input"

/** Id of the [기준상품 추가] button (focused when the 구성표 has an error). */
export const BUNDLE_ITEMS_ADD_ID = "product-items-add"

/** Id of a 구성표 row's 수량 box. */
export function bundleQuantityInputId(index: number): string {
  return `product-items-${index}-quantity`
}

/**
 * 수량 typed in a 구성표 row as a number, or null when it is empty or not a
 * whole number from 1 to 100,000 (the form shows the error for that case).
 * Same rule as bundleItemSchema in `@/lib/products/schema`.
 * @example parseBundleQuantity("1,000") // 1000
 */
export function parseBundleQuantity(value: string): number | null {
  const digits = value.replace(/[,\s]/g, "")
  if (!/^\d{1,7}$/.test(digits)) return null
  const quantity = Number(digits)
  return quantity >= BUNDLE_ITEM_QUANTITY.min &&
    quantity <= BUNDLE_ITEM_QUANTITY.max
    ? quantity
    : null
}

/** One row of the 구성상품 table: the form row and its 기준상품. */
export type BundleItemRow = {
  item: BundleItemInput
  /** The 기준상품, or null when its details could not be read. */
  component: BaseProductOption | null
}

/** Errors of the `items` field: for the whole list, or per row. */
type ItemsErrors = FieldErrors<{ items: BundleItemInput[] }>["items"]

/** The message about the 구성표 as a whole (none, duplicates, …). */
export function bundleItemsMessage(errors: ItemsErrors): string | undefined {
  if (!errors) return undefined
  const root = (errors as { root?: FieldError }).root
  return errors.message ?? root?.message
}

/**
 * 구성상품 of a 묶음상품: a bordered table of its 기준상품 (상품코드, 상품명,
 * 규격, 단위, 수량, 삭제) with [기준상품 추가].
 *
 * - 수량 is in the 기준상품's own unit (6 → 6캔). Enter or ↓ moves to the
 *   next row's 수량, ↑ to the previous one (Enter never saves the form).
 * - [삭제] takes the row out; the focus moves to the next row's 수량 (or to
 *   [기준상품 추가] when it was the last one).
 * - A 사용중지 기준상품 is marked: a 묶음상품 with one can only be saved as
 *   사용중지.
 * - A click on a 상품명 opens that 기준상품 (e.g. to switch it on again).
 * - Phones: only 상품명 (with the 상품코드 below it), 수량 (with the unit
 *   inside the box) and an icon-only [삭제] are shown, so the row fits
 *   without scrolling sideways.
 */
export function BundleItemsSection({
  rows,
  errors,
  addButtonRef,
  onAdd,
  onQuantityChange,
  onQuantityBlur,
  onRemove,
  onOpenComponent,
}: {
  rows: BundleItemRow[]
  errors: ItemsErrors
  /** react-hook-form's ref of the `items` field (focus on error). */
  addButtonRef: React.Ref<HTMLButtonElement>
  /** Opens the 기준상품 picker. */
  onAdd: () => void
  onQuantityChange: (index: number, quantity: string) => void
  onQuantityBlur: () => void
  onRemove: (index: number) => void
  /** Opens the 상품 수정 modal of this 기준상품 (by its id). */
  onOpenComponent: (componentId: string) => void
}) {
  const listMessage = bundleItemsMessage(errors)
  const isFull = rows.length >= BUNDLE_ITEMS_MAX
  const messageId = "product-items-error"

  function focusQuantity(index: number) {
    document.getElementById(bundleQuantityInputId(index))?.focus()
  }

  function handleQuantityKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    index: number
  ) {
    if (event.key === "Enter") {
      // Enter must not submit the form (also while composing Korean).
      event.preventDefault()
      if (event.nativeEvent.isComposing || event.keyCode === 229) return
      if (index < rows.length - 1) focusQuantity(index + 1)
    } else if (event.key === "ArrowDown" && index < rows.length - 1) {
      event.preventDefault()
      focusQuantity(index + 1)
    } else if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault()
      focusQuantity(index - 1)
    }
  }

  return (
    <FormSection
      title="구성상품"
      description={
        <>
          이 묶음상품에 들어가는 기준상품과 수량(기준상품의 단위)입니다.
          {rows.length > 0 &&
            ` 기준상품 ${formatNumber(rows.length, 0)}종 (최대 ${BUNDLE_ITEMS_MAX}종)`}
        </>
      }
      actions={
        <ActionButton
          id={BUNDLE_ITEMS_ADD_ID}
          ref={addButtonRef}
          size="sm"
          disabled={isFull}
          aria-describedby={listMessage ? messageId : undefined}
          title={
            isFull
              ? `묶음상품 하나에 기준상품은 ${BUNDLE_ITEMS_MAX}종류까지 넣을 수 있습니다.`
              : undefined
          }
          onClick={onAdd}
        >
          <PlusIcon aria-hidden="true" />
          기준상품 추가
        </ActionButton>
      }
    >
      <div
        className={cn(
          "overflow-x-auto border bg-background",
          listMessage ? "border-destructive" : "border-input"
        )}
      >
        <table
          aria-label="구성상품"
          aria-describedby={listMessage ? messageId : undefined}
          // Wider screens: wide enough for every column. Phones: fixed
          // columns, so 상품명 + 수량 + 삭제 fit the box. An empty table fits
          // the box so its message stays in view.
          className={cn(
            "w-full border-collapse text-[13px]",
            rows.length > 0 && "table-fixed sm:min-w-[40rem] sm:table-auto"
          )}
        >
          <thead>
            <tr className="bg-label">
              <BundleHead className="hidden w-10 sm:table-cell">No</BundleHead>
              <BundleHead className="hidden w-28 sm:table-cell">
                상품코드
              </BundleHead>
              <BundleHead>상품명</BundleHead>
              <BundleHead className="hidden w-28 sm:table-cell">
                규격
              </BundleHead>
              <BundleHead className="hidden w-14 sm:table-cell">
                단위
              </BundleHead>
              <BundleHead className="w-28 sm:w-32">수량</BundleHead>
              <BundleHead className="w-12 sm:w-16">삭제</BundleHead>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="h-20 px-3 text-center text-muted-foreground"
                >
                  <p className="font-bold text-foreground">
                    기준상품을 추가해 주세요.
                  </p>
                  <p className="text-xs">
                    [기준상품 추가]로 이 묶음상품에 들어갈 기준상품(개입)을 고른
                    뒤 수량을 입력합니다. 예: 스팸 × 6, 스팸 × 2 + 참치 × 3
                  </p>
                </td>
              </tr>
            ) : (
              rows.map(({ item, component }, index) => {
                const rowErrors = Array.isArray(errors)
                  ? (errors[index] as
                      | { quantity?: FieldError; componentId?: FieldError }
                      | undefined)
                  : undefined
                const quantityError =
                  rowErrors?.quantity?.message ??
                  rowErrors?.componentId?.message
                const inputId = bundleQuantityInputId(index)
                const name = component?.name ?? "알 수 없는 기준상품"
                return (
                  <tr
                    key={item.componentId}
                    className="border-t border-grid-line even:bg-zebra"
                  >
                    <BundleCell
                      align="center"
                      className="hidden tabular-nums sm:table-cell"
                    >
                      {index + 1}
                    </BundleCell>
                    <BundleCell
                      align="center"
                      className="hidden tabular-nums sm:table-cell"
                    >
                      {component?.code ?? EMPTY_VALUE}
                    </BundleCell>
                    <BundleCell className="whitespace-normal sm:max-w-72 sm:whitespace-nowrap">
                      <span className="flex min-w-0 items-center gap-1.5">
                        {component ? (
                          <a
                            href={buildProductModalHref("", {
                              mode: "edit",
                              id: component.id,
                            })}
                            title={`${name} (기준상품 열기)`}
                            onClick={(event) => {
                              // Ctrl/⌘/Shift-click: the browser opens a new
                              // tab/window.
                              if (
                                event.metaKey ||
                                event.ctrlKey ||
                                event.shiftKey ||
                                event.altKey
                              ) {
                                return
                              }
                              event.preventDefault()
                              onOpenComponent(component.id)
                            }}
                            className="min-w-0 rounded-sm break-all underline-offset-4 outline-none hover:text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:truncate"
                          >
                            {name}
                          </a>
                        ) : (
                          <span
                            className="min-w-0 break-all sm:truncate"
                            title={name}
                          >
                            {name}
                          </span>
                        )}
                        {component && !component.isActive && (
                          <span className="shrink-0 rounded-sm border border-destructive/50 px-1 text-[11px] font-bold text-destructive">
                            사용중지
                          </span>
                        )}
                      </span>
                      {/* Phones: the 상품코드 column is hidden. */}
                      <span className="block text-xs text-muted-foreground tabular-nums sm:hidden">
                        {component?.code ?? EMPTY_VALUE}
                      </span>
                    </BundleCell>
                    <BundleCell
                      align="center"
                      className="hidden max-w-32 truncate sm:table-cell"
                      title={component?.spec ?? undefined}
                    >
                      {component?.spec ?? EMPTY_VALUE}
                    </BundleCell>
                    <BundleCell align="center" className="hidden sm:table-cell">
                      {component?.unit ?? EMPTY_VALUE}
                    </BundleCell>
                    <BundleCell className="py-1">
                      <NumberInput
                        id={inputId}
                        data-bundle-quantity=""
                        aria-label={`${name} 수량`}
                        aria-required
                        aria-invalid={quantityError ? true : undefined}
                        aria-describedby={
                          quantityError ? `${inputId}-error` : undefined
                        }
                        value={item.quantity}
                        thousands
                        placeholder="수량"
                        maxLength={9}
                        onChange={(value) => onQuantityChange(index, value)}
                        onBlur={onQuantityBlur}
                        onKeyDown={(event) =>
                          handleQuantityKeyDown(event, index)
                        }
                        // Phones: the 단위 column is hidden, so the unit is
                        // shown inside the box ("6 캔").
                        unit={component?.unit}
                        unitClassName="sm:hidden"
                        containerClassName="w-full"
                        className="h-7 rounded-sm pr-12 sm:pr-2.5"
                      />
                      {quantityError && (
                        <p
                          id={`${inputId}-error`}
                          className="mt-0.5 text-xs font-bold whitespace-normal text-destructive"
                        >
                          {quantityError}
                        </p>
                      )}
                    </BundleCell>
                    <BundleCell align="center">
                      <ActionButton
                        size="sm"
                        variant="neutral"
                        aria-label={`${name} 빼기`}
                        title="구성상품에서 빼기"
                        onClick={() => onRemove(index)}
                      >
                        <XIcon aria-hidden="true" />
                        <span className="hidden sm:inline">삭제</span>
                      </ActionButton>
                    </BundleCell>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {listMessage && (
        <p id={messageId} className="text-xs font-bold text-destructive">
          {listMessage}
        </p>
      )}
    </FormSection>
  )
}

function BundleHead({
  className,
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <th
      scope="col"
      className={cn(
        "h-8 border-r border-b border-grid-line px-2 text-center font-bold whitespace-nowrap last:border-r-0",
        className
      )}
    >
      {children}
    </th>
  )
}

function BundleCell({
  align = "left",
  className,
  ...props
}: React.ComponentProps<"td"> & { align?: "left" | "center" }) {
  return (
    <td
      className={cn(
        "h-9 border-r border-grid-line px-2 whitespace-nowrap last:border-r-0",
        align === "center" ? "text-center" : "text-left",
        className
      )}
      {...props}
    />
  )
}

// ---------------------------------------------------------------------------
// 식품정보 (worked out from the 구성상품)
// ---------------------------------------------------------------------------

/**
 * A 묶음상품's food information, read-only: worked out from its 기준상품
 * (deriveBundleFoodInfo), never typed. Shown as a grid of [label | value]
 * cells under the 구성상품 table.
 */
export function BundleFoodInfoSection({
  foodInfo,
  hasComponents,
}: {
  foodInfo: FoodInfo
  /** False while the 구성표 is empty: every value is still empty. */
  hasComponents: boolean
}) {
  const allergens = foodInfo.allergens.map(allergenLabel).join(", ")
  return (
    <FormSection
      title="식품정보 (자동)"
      description={
        hasComponents
          ? "구성상품(기준상품)의 정보로 자동으로 정해집니다. 바꾸려면 기준상품을 수정하세요 (구성상품의 상품명을 누르면 열립니다)."
          : "기준상품을 추가하면 자동으로 채워집니다."
      }
    >
      <dl className="grid grid-cols-1 border-t border-l border-input bg-background md:grid-cols-2 xl:grid-cols-3">
        <InfoCell label="보관온도" note="가장 엄격한 온도">
          {foodInfo.storageType ? storageTypeLabel(foodInfo.storageType) : null}
        </InfoCell>
        <InfoCell label="과세구분">
          {foodInfo.taxType === "mixed" ? (
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <MixedTaxBadge />
              <span className="text-xs text-muted-foreground">
                구성상품의 과세구분이 섞여 있습니다.
              </span>
            </span>
          ) : foodInfo.taxType ? (
            taxTypeLabel(foodInfo.taxType)
          ) : null}
        </InfoCell>
        <InfoCell label="유통기한 기준" note="가장 짧은 일수">
          {foodInfo.shelfLifeDays === null
            ? null
            : `제조일로부터 ${formatNumber(foodInfo.shelfLifeDays, 0)}일`}
        </InfoCell>
        <InfoCell label="원산지">{foodInfo.origin}</InfoCell>
        <InfoCell label="제조사/브랜드">{foodInfo.manufacturer}</InfoCell>
        <InfoCell label="알레르기">
          {hasComponents ? allergens || "없음" : null}
        </InfoCell>
      </dl>
    </FormSection>
  )
}

/** "혼합" badge for a 묶음상품 with both 과세 and 면세 기준상품. */
export function MixedTaxBadge() {
  return (
    <span
      title="구성상품의 과세구분이 섞여 있습니다."
      className="inline-flex h-5 items-center rounded-sm border border-brand-border bg-brand-tint px-1.5 text-xs font-bold text-brand-active"
    >
      혼합
    </span>
  )
}

/** One read-only [grey label | value] cell. Empty values show "-". */
function InfoCell({
  label,
  note,
  children,
}: {
  label: string
  /** Small grey note after the value (how it is worked out). */
  note?: string
  children: React.ReactNode
}) {
  const isEmpty = children === null || children === undefined
  return (
    <div className="flex min-h-9 min-w-0 border-r border-b border-input">
      <dt className="flex w-24 shrink-0 items-center bg-label px-2.5 py-1.5 text-[13px] font-bold sm:w-28">
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 px-2.5 py-1.5 text-[13px] break-all">
        {isEmpty ? EMPTY_VALUE : children}
        {note && !isEmpty && (
          <span className="text-xs text-muted-foreground">({note})</span>
        )}
      </dd>
    </div>
  )
}
