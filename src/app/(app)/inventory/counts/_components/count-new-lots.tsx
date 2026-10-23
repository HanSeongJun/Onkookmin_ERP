"use client"

import { PlusIcon, TriangleAlertIcon, XIcon } from "lucide-react"
import {
  Controller,
  useWatch,
  type FieldArrayWithId,
  type FieldErrors,
} from "react-hook-form"

import { NumberInput } from "@/app/(app)/products/_components/number-input"
import { ActionButton } from "@/components/erp/action-bar"
import { Input } from "@/components/ui/input"
import { formatNumber } from "@/lib/format"
import {
  EXPIRY_KINDS,
  STOCK_LIMITS,
  storageFit,
  suggestExpiryDate,
} from "@/lib/inventory/constants"
import type { CountFormInput, CountNewLotInput } from "@/lib/inventory/schema"
import type { BaseProductOption } from "@/lib/products/bundle"
import { storageTypeLabel, type StorageType } from "@/lib/products/constants"
import { excludedOf } from "@/lib/products/vat"
import { cn } from "@/lib/utils"

import type { CountFormApi } from "./count-sheet-table"
import { QuantityInput, SimpleSelect } from "./count-ui"

/** A 위치 inside the 실사 범위 where found stock may go (사용 위치). */
export type ScopeLocation = {
  id: string
  /** "냉장 B구역 > C-01-01". */
  label: string
  zoneStorageType: StorageType
}

type NewLotErrors = NonNullable<FieldErrors<CountFormInput>["newLots"]>

/** Id of the [발견 재고 추가] button (focused after a 발견 재고 is removed). */
export const NEW_LOT_ADD_ID = "count-new-lot-add"

/** Id of a 발견 재고's 수량 box. */
export function newLotQuantityId(index: number): string {
  return `count-new-lot-${index}-quantity`
}

/** The empty 발견 재고 line for a picked 기준상품. */
export function emptyNewLot(
  product: BaseProductOption,
  locationId: string
): CountNewLotInput {
  return {
    productId: product.id,
    unit: product.unit,
    locationId,
    quantity: "",
    // Most foods carry a 소비기한 since 2023 (changed per lot when not).
    expiryKind: "use_by",
    expiryDate: "",
    manufacturedDate: "",
    lotNo: "",
    unitCostInclVat: "",
    memo: "",
  }
}

/**
 * 발견 재고: stock found in the 실사 범위 that has no lot in the 실사 목록
 * (e.g. a box nobody registered). Each one becomes a new lot of a
 * 기준상품 (입고일 = the 실사 date) at a 사용 위치 of the 범위, with its
 * own 수량, 기한, 제조일자, 로트번호 (empty = automatic) and 입고단가
 * (부가세 포함; the 부가세 별도 amount is shown next to it).
 */
export function CountNewLots({
  form,
  fields,
  products,
  locations,
  countDate,
  errors,
  canAdd,
  onAdd,
  onRemove,
}: {
  form: CountFormApi
  fields: FieldArrayWithId<CountFormInput, "newLots", "id">[]
  /** The picked 기준상품 by id. */
  products: ReadonlyMap<string, BaseProductOption>
  locations: readonly ScopeLocation[]
  /** The 실사 date (= 입고일 of the new lots). */
  countDate: string
  errors: NewLotErrors | undefined
  canAdd: boolean
  onAdd: () => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {fields.length === 0 ? (
        <p className="border border-dashed border-input px-3 py-3 text-[13px] text-muted-foreground">
          실사 목록에 없는 재고를 창고에서 찾았다면 [발견 재고 추가]로 넣어
          주세요. 새 로트로 등록되고, 입고일은 실사 일자({countDate})가 됩니다.
        </p>
      ) : (
        fields.map((field, index) => (
          <NewLotBlock
            key={field.id}
            form={form}
            index={index}
            product={products.get(field.productId) ?? null}
            locations={locations}
            countDate={countDate}
            errors={errors?.[index]}
            onRemove={() => onRemove(index)}
          />
        ))
      )}
      <div>
        <ActionButton
          id={NEW_LOT_ADD_ID}
          variant="secondary"
          disabled={!canAdd || locations.length === 0}
          onClick={onAdd}
        >
          <PlusIcon aria-hidden="true" />
          발견 재고 추가
        </ActionButton>
        {locations.length === 0 && (
          <p className="mt-1 text-xs text-destructive">
            이 범위에는 새 재고를 넣을 수 있는 위치가 없습니다.
            (창고·구역·위치가 사용중지) 창고·로케이션 설정에서 확인해 주세요.
          </p>
        )}
      </div>
    </div>
  )
}

function NewLotBlock({
  form,
  index,
  product,
  locations,
  countDate,
  errors,
  onRemove,
}: {
  form: CountFormApi
  index: number
  product: BaseProductOption | null
  locations: readonly ScopeLocation[]
  countDate: string
  errors: FieldErrors<CountNewLotInput> | undefined
  onRemove: () => void
}) {
  const lot = useWatch({ control: form.control, name: `newLots.${index}` })
  const location = locations.find((item) => item.id === lot?.locationId)
  const fit =
    product && location
      ? storageFit(product.storageType, location.zoneStorageType)
      : null
  const autoExpiry =
    lot && lot.expiryKind !== "none" && lot.expiryDate.trim() === ""
      ? suggestExpiryDate(
          lot.manufacturedDate || null,
          product?.shelfLifeDays ?? null
        )
      : null
  const shownExpiry =
    lot?.expiryKind === "none" ? null : lot?.expiryDate || autoExpiry
  const costDigits = (lot?.unitCostInclVat ?? "").replace(/[,\s원₩]/g, "")
  const cost = /^\d{1,11}$/.test(costDigits) ? Number(costDigits) : null
  const prefix = `count-new-lot-${index}`
  const fieldError = (name: keyof CountNewLotInput) =>
    errors?.[name]?.message as string | undefined
  const blockError = (errors as { message?: string } | undefined)?.message

  return (
    <section
      aria-label={`발견 재고 ${index + 1}`}
      className={cn("border border-input", errors && "border-destructive/60")}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-grid-line bg-label px-2.5 py-1.5 text-[13px]">
        <span className="font-bold">발견 {index + 1}</span>
        {product ? (
          <>
            <span className="text-muted-foreground tabular-nums">
              {product.code}
            </span>
            <span className="font-bold">{product.name}</span>
            {product.spec && (
              <span className="text-muted-foreground">{product.spec}</span>
            )}
            <span className="text-muted-foreground">
              · 단위 {product.unit} · {storageTypeLabel(product.storageType)}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            상품 정보를 불러오는 중…
          </span>
        )}
        <button
          type="button"
          aria-label={`발견 재고 ${index + 1} 빼기`}
          onClick={onRemove}
          className="ml-auto flex h-7 items-center gap-1 rounded-sm px-1.5 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <XIcon aria-hidden="true" className="size-3.5" />
          빼기
        </button>
      </div>

      <div className="grid grid-cols-1 gap-x-3 gap-y-2 px-2.5 py-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="위치"
          required
          htmlFor={`${prefix}-location`}
          error={fieldError("locationId")}
        >
          <Controller
            control={form.control}
            name={`newLots.${index}.locationId`}
            render={({ field }) => (
              <SimpleSelect
                id={`${prefix}-location`}
                value={field.value || "none"}
                invalid={!!fieldError("locationId")}
                options={[
                  ...(field.value
                    ? []
                    : [{ value: "none", label: "위치 선택" }]),
                  ...locations.map((item) => ({
                    value: item.id,
                    label: `${item.label} (${storageTypeLabel(item.zoneStorageType)})`,
                  })),
                ]}
                className="max-w-none"
                onChange={(value) =>
                  field.onChange(value === "none" ? "" : value)
                }
              />
            )}
          />
        </Field>

        <Field
          label="수량"
          required
          htmlFor={newLotQuantityId(index)}
          error={fieldError("quantity")}
        >
          <QuantityInput
            id={newLotQuantityId(index)}
            unit={product?.unit}
            aria-required
            aria-invalid={fieldError("quantity") ? true : undefined}
            containerClassName="w-full"
            className="h-8"
            {...form.register(`newLots.${index}.quantity`)}
          />
        </Field>

        <Field
          label="기한 종류"
          required
          htmlFor={`${prefix}-expiry-kind`}
          error={fieldError("expiryKind")}
        >
          <Controller
            control={form.control}
            name={`newLots.${index}.expiryKind`}
            render={({ field }) => (
              <SimpleSelect
                id={`${prefix}-expiry-kind`}
                value={field.value}
                options={EXPIRY_KINDS.map(({ value, label }) => ({
                  value,
                  label,
                }))}
                className="max-w-none"
                onChange={(value) => {
                  field.onChange(value)
                  if (value === "none") {
                    form.setValue(`newLots.${index}.expiryDate`, "", {
                      shouldDirty: true,
                    })
                  }
                }}
              />
            )}
          />
        </Field>

        <Field
          label="기한일"
          htmlFor={`${prefix}-expiry-date`}
          error={fieldError("expiryDate")}
          hint={
            lot?.expiryKind === "none"
              ? "기한 없음"
              : autoExpiry
                ? `비우면 ${autoExpiry} (제조일자 + ${product?.shelfLifeDays}일)`
                : product?.shelfLifeDays
                  ? "기한일 또는 제조일자를 입력"
                  : "기한일을 입력 (유통기한 기준일수 없음)"
          }
        >
          <Input
            id={`${prefix}-expiry-date`}
            type="date"
            disabled={lot?.expiryKind === "none"}
            aria-invalid={fieldError("expiryDate") ? true : undefined}
            className="h-8 rounded-sm tabular-nums"
            {...form.register(`newLots.${index}.expiryDate`)}
          />
        </Field>

        <Field
          label="제조일자"
          htmlFor={`${prefix}-manufactured`}
          error={fieldError("manufacturedDate")}
        >
          <Input
            id={`${prefix}-manufactured`}
            type="date"
            max={countDate}
            aria-invalid={fieldError("manufacturedDate") ? true : undefined}
            className="h-8 rounded-sm tabular-nums"
            {...form.register(`newLots.${index}.manufacturedDate`)}
          />
        </Field>

        <Field
          label="로트번호"
          htmlFor={`${prefix}-lot-no`}
          error={fieldError("lotNo")}
        >
          <Input
            id={`${prefix}-lot-no`}
            placeholder="비우면 자동"
            maxLength={STOCK_LIMITS.lotNoMaxLength}
            autoComplete="off"
            aria-invalid={fieldError("lotNo") ? true : undefined}
            className="h-8 rounded-sm"
            {...form.register(`newLots.${index}.lotNo`)}
          />
        </Field>

        <Field
          label="입고단가(부가세 포함)"
          htmlFor={`${prefix}-cost`}
          error={fieldError("unitCostInclVat")}
          hint={
            cost !== null && product
              ? `부가세 별도 ${formatNumber(excludedOf(cost, product.taxType === "taxable"), 0)}원 (${product.taxType === "taxable" ? "과세" : "면세"})`
              : product && product.purchasePriceInclVat !== null
                ? `비우면 재고금액은 기본 매입가 ${formatNumber(product.purchasePriceInclVat, 0)}원으로 추정`
                : "1단위 가격, 비워도 됩니다"
          }
        >
          <Controller
            control={form.control}
            name={`newLots.${index}.unitCostInclVat`}
            render={({ field }) => (
              <NumberInput
                id={`${prefix}-cost`}
                thousands
                unit="원"
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                ref={field.ref}
                aria-invalid={fieldError("unitCostInclVat") ? true : undefined}
                className="h-8 rounded-sm"
                containerClassName="w-full"
              />
            )}
          />
        </Field>

        <Field
          label="메모"
          htmlFor={`${prefix}-memo`}
          error={fieldError("memo")}
        >
          <Input
            id={`${prefix}-memo`}
            maxLength={STOCK_LIMITS.memoMaxLength}
            autoComplete="off"
            className="h-8 rounded-sm"
            {...form.register(`newLots.${index}.memo`)}
          />
        </Field>
      </div>

      {(fit?.mismatch ||
        (shownExpiry && shownExpiry < countDate) ||
        fieldError("productId") ||
        blockError) && (
        <div className="flex flex-col gap-0.5 border-t border-grid-line px-2.5 py-1.5 text-xs">
          {fit?.mismatch && product && location && (
            <p
              className={cn(
                "flex items-center gap-1",
                fit.tooWarm ? "font-bold text-destructive" : "text-foreground"
              )}
            >
              <TriangleAlertIcon aria-hidden="true" className="size-3.5" />
              보관온도가 맞지 않습니다: {storageTypeLabel(
                product.storageType
              )}{" "}
              상품을 {storageTypeLabel(location.zoneStorageType)} 구역에
              넣습니다.
              {fit.tooWarm
                ? " 상품이 상할 수 있으니 맞는 구역으로 옮겨 주세요. (저장은 됩니다)"
                : " (저장은 됩니다)"}
            </p>
          )}
          {shownExpiry && shownExpiry < countDate && (
            <p className="text-foreground">
              기한({shownExpiry})이 이미 지난 재고입니다. 저장한 뒤 폐기
              등록에서 폐기해 주세요.
            </p>
          )}
          {fieldError("productId") && (
            <p className="font-bold text-destructive">
              {fieldError("productId")}
            </p>
          )}
          {blockError && (
            <p className="font-bold text-destructive">{blockError}</p>
          )}
        </div>
      )}
    </section>
  )
}

/** A small stacked [label / input / hint or error] cell. */
function Field({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  children,
}: {
  label: string
  htmlFor: string
  required?: boolean
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <label htmlFor={htmlFor} className="flex items-center text-xs font-bold">
        {required && (
          <span
            aria-hidden="true"
            className="mr-1 size-1.5 shrink-0 rounded-full bg-required"
          />
        )}
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-bold text-destructive">{error}</p>
      ) : (
        hint && <p className="text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
