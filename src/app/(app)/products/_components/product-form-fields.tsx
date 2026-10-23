"use client"

import { ExternalLinkIcon } from "lucide-react"
import {
  Controller,
  useWatch,
  type FieldErrors,
  type UseFormReturn,
} from "react-hook-form"

import { ActionButton, ActionLink } from "@/components/erp/action-bar"
import { FormRow, FormSection, FormTable } from "@/components/erp/form-table"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  findCategoryPath,
  formatCategoryPath,
  type CategoryNode,
} from "@/lib/categories/tree"
import { EMPTY_VALUE, formatDateTime, formatNumber } from "@/lib/format"
import {
  componentPriceTotal,
  componentVatWeights,
  perUnitPrice,
  type BaseProductOption,
  type PriceInclExcl,
  type PriceKind,
} from "@/lib/products/bundle"
import {
  ALLERGENS,
  PRODUCT_LIMITS,
  PRODUCT_TYPES,
  STORAGE_TYPES,
  TAX_TYPES,
  UNITS,
  type ProductType,
} from "@/lib/products/constants"
import type { ProductCategoryPathItem } from "@/lib/products/queries"
import {
  parsePriceInput,
  type ProductFormInput,
  type ProductFormValues,
} from "@/lib/products/schema"
import { allocateMixed, splitVat, type VatSplit } from "@/lib/products/vat"
import { cn } from "@/lib/utils"

import { NumberInput } from "./number-input"

/** The 상품 form (react-hook-form) shared by the tabs. */
export type ProductFormApi = UseFormReturn<
  ProductFormInput,
  unknown,
  ProductFormValues
>

type Errors = FieldErrors<ProductFormInput>

/** Fields typed into a plain text box (registered with `register`). */
type TextFieldName =
  "code" | "name" | "spec" | "origin" | "manufacturer" | "barcode"

/** Where 상품분류설정 lives (opened in a new tab: the form stays as it is). */
const CATEGORY_SETTINGS_HREF = "/products/categories"

// flex-1 + min-w-40: the box gives up some width so a short hint fits on the
// same line (the reference screen keeps every row one line high).
const inputClass = "h-8 min-w-40 flex-1 max-w-80 rounded-sm"

/** Id of a form field's input, e.g. "product-code". */
export function productFieldId(name: keyof ProductFormInput): string {
  return `product-${name}`
}

/** Props screen readers need on an input of a <FormRow>. */
function a11yProps(name: keyof ProductFormInput, errors: Errors) {
  const invalid = Boolean(errors[name])
  return {
    "aria-invalid": invalid,
    "aria-describedby": invalid ? `${productFieldId(name)}-error` : undefined,
  }
}

/** One text box row of a <FormTable>. */
function TextRow({
  form,
  errors,
  name,
  label,
  required = false,
  placeholder,
  maxLength,
  hint,
  title,
  onKeyDown,
  inputMode,
  wide = false,
}: {
  form: ProductFormApi
  errors: Errors
  name: TextFieldName
  label: string
  required?: boolean
  placeholder?: string
  maxLength?: number
  hint?: React.ReactNode
  /** Tooltip on the text box with the full rule (the hint is short). */
  title?: string
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]
  /** The box may use the whole row (long text such as a 묶음상품 name). */
  wide?: boolean
}) {
  const id = productFieldId(name)
  return (
    <FormRow
      label={label}
      htmlFor={id}
      required={required}
      hint={hint}
      error={errors[name]?.message}
      errorId={`${id}-error`}
    >
      <Input
        id={id}
        autoComplete="off"
        spellCheck={false}
        maxLength={maxLength}
        placeholder={placeholder}
        title={title}
        inputMode={inputMode}
        aria-required={required || undefined}
        className={cn(inputClass, wide && "max-w-none")}
        {...a11yProps(name, errors)}
        {...form.register(name)}
        onKeyDown={onKeyDown}
      />
    </FormRow>
  )
}

/** Small red dot used in the "필수정보" note (same as before required labels). */
function RequiredDot() {
  return (
    <span
      aria-hidden="true"
      className="mr-1 inline-block size-1.5 -translate-y-0.5 rounded-full bg-required"
    />
  )
}

// ---------------------------------------------------------------------------
// 공통정보 tab
// ---------------------------------------------------------------------------

/**
 * 공통정보, like a classic ERP master/detail form:
 * - 필수정보 and 기본정보 on the left, 추가정보 on the right (one column on
 *   narrow screens). The top row is 상품유형 (기준상품(개입) / 묶음상품;
 *   fixed after 등록), as in the reference screen. 보관온도, 과세구분,
 *   원산지 and 제조사 are typed only for a 기준상품.
 * - 묶음상품: below them, full width, `bundleSection` (the 구성상품 table and
 *   the 식품정보 worked out from it).
 */
export function ProductCommonFields({
  form,
  errors,
  productType,
  typeLocked,
  bundleSection,
  codeHint,
  nameHint,
  unitNote,
  unitLocked = false,
  isActiveNote,
  categories,
  savedCategoryId,
  savedCategoryPath,
  createdAt,
  updatedAt,
  onOpenCategoryPicker,
  onProductTypeChange,
}: {
  form: ProductFormApi
  errors: Errors
  /** The 상품유형 chosen in the form. */
  productType: ProductType
  /** 상품 수정: the 상품유형 can no longer change. */
  typeLocked: boolean
  /** 묶음상품: the 구성상품 table and its 식품정보. */
  bundleSection?: React.ReactNode
  /** Hint next to 상품코드 / 상품명 (e.g. the suggestion state). */
  codeHint?: React.ReactNode
  nameHint?: React.ReactNode
  /** Warning shown instead of 단위's hint (e.g. 묶음상품 use this unit). */
  unitNote?: React.ReactNode
  /** 상품 수정 of a product with stock records: the 단위 cannot change. */
  unitLocked?: boolean
  /** Note under 사용 여부 (e.g. 묶음상품 switched off together). */
  isActiveNote?: React.ReactNode
  /** All categories, including switched-off ones. */
  categories: CategoryNode[]
  /** 상품 수정: the product's saved category ("" = 미분류). */
  savedCategoryId: string
  /** 상품 수정: the saved category's path as read with the product. */
  savedCategoryPath: ProductCategoryPathItem[]
  /** 상품 수정: 등록일 and 최종수정일 (left out for 상품 등록). */
  createdAt?: string
  updatedAt?: string
  onOpenCategoryPicker: () => void
  onProductTypeChange: (productType: ProductType) => void
}) {
  const isBundle = productType === "bundle"

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-x-5 gap-y-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4">
          <FormSection
            title="필수정보"
            description={
              <>
                <RequiredDot />
                표시가 있는 항목은 꼭 입력해 주세요.
              </>
            }
          >
            <FormTable>
              <ProductTypeRow
                form={form}
                locked={typeLocked}
                onChange={onProductTypeChange}
              />
              <TextRow
                form={form}
                errors={errors}
                name="code"
                label="상품코드"
                required
                placeholder={isBundle ? "예: VEG-001-6" : "예: VEG-001"}
                hint={codeHint ?? "영문·숫자·-_. 30자 이내"}
                title="영문·숫자·하이픈(-)·밑줄(_)·마침표(.)로 30자까지. 대소문자만 다른 코드는 같은 코드로 봅니다."
              />
              <TextRow
                form={form}
                errors={errors}
                name="name"
                label="상품명"
                required
                placeholder={
                  isBundle
                    ? "예: [묶음] 스팸 클래식 1.81kg X 6개입"
                    : "예: 양파"
                }
                maxLength={PRODUCT_LIMITS.nameMaxLength}
                hint={nameHint}
                wide
              />
              <TextRow
                form={form}
                errors={errors}
                name="spec"
                label="규격"
                placeholder={isBundle ? "예: 1.81kg×6" : "예: 1kg, 500g×20입"}
                maxLength={PRODUCT_LIMITS.specMaxLength}
              />
              <UnitRow
                form={form}
                isBundle={isBundle}
                note={unitNote}
                locked={unitLocked}
              />
              {!isBundle && (
                <>
                  <ChoiceRow
                    form={form}
                    name="taxType"
                    label="과세구분"
                    options={TAX_TYPES}
                    hint="신선 농·수·축산물은 보통 면세, 가공식품은 과세"
                  />
                  <ChoiceRow
                    form={form}
                    name="storageType"
                    label="보관온도"
                    options={STORAGE_TYPES}
                    hint="냉장 0~10°C, 냉동 -18°C 이하"
                  />
                </>
              )}
            </FormTable>
          </FormSection>

          <FormSection title="기본정보">
            <FormTable>
              {!isBundle && (
                <>
                  <TextRow
                    form={form}
                    errors={errors}
                    name="origin"
                    label="원산지"
                    placeholder="예: 국산(전남 무안), 호주산"
                    maxLength={PRODUCT_LIMITS.originMaxLength}
                  />
                  <TextRow
                    form={form}
                    errors={errors}
                    name="manufacturer"
                    label="제조사/브랜드"
                    maxLength={PRODUCT_LIMITS.manufacturerMaxLength}
                  />
                </>
              )}
              <BarcodeRow form={form} errors={errors} />
              <CategoryRow
                form={form}
                categories={categories}
                savedCategoryId={savedCategoryId}
                savedCategoryPath={savedCategoryPath}
                onOpenCategoryPicker={onOpenCategoryPicker}
              />
            </FormTable>
          </FormSection>
        </div>

        <FormSection title="추가정보" className="lg:self-start">
          <FormTable>
            <Controller
              control={form.control}
              name="isActive"
              render={({ field, fieldState }) => {
                const errorId = `${productFieldId("isActive")}-error`
                return (
                  <FormRow
                    label="사용 여부"
                    hint={
                      fieldState.error
                        ? undefined
                        : (isActiveNote ??
                          (field.value
                            ? undefined
                            : "목록 기본 화면에서 빠집니다 (사용여부 ‘사용중지’로 조회)"))
                    }
                    error={fieldState.error?.message}
                    errorId={errorId}
                  >
                    <RadioGroup
                      aria-label="사용 여부"
                      aria-invalid={fieldState.invalid || undefined}
                      aria-describedby={
                        fieldState.invalid ? errorId : undefined
                      }
                      value={field.value ? "true" : "false"}
                      onValueChange={(value) =>
                        field.onChange(value === "true")
                      }
                      className="flex w-auto flex-wrap gap-x-4 gap-y-1"
                    >
                      <InlineRadio
                        id="product-isActive-true"
                        value="true"
                        label="사용"
                        ref={field.value ? field.ref : undefined}
                      />
                      <InlineRadio
                        id="product-isActive-false"
                        value="false"
                        label="사용중지"
                        ref={field.value ? undefined : field.ref}
                      />
                    </RadioGroup>
                  </FormRow>
                )
              }}
            />
            <FormRow
              label="참고사항"
              htmlFor={productFieldId("note")}
              hint="내부 참고용 메모(비고)입니다."
              error={errors.note?.message}
              errorId={`${productFieldId("note")}-error`}
            >
              <Textarea
                id={productFieldId("note")}
                rows={4}
                maxLength={PRODUCT_LIMITS.noteMaxLength}
                placeholder="상품 참고사항을 입력해 주세요."
                className="min-h-20 w-full rounded-sm"
                {...a11yProps("note", errors)}
                {...form.register("note")}
              />
            </FormRow>
            {createdAt && (
              <FormRow label="등록일">
                <span className="text-[13px] tabular-nums">
                  {formatDateTime(createdAt)}
                </span>
              </FormRow>
            )}
            {updatedAt && (
              <FormRow label="최종수정일">
                <span className="text-[13px] tabular-nums">
                  {formatDateTime(updatedAt)}
                </span>
              </FormRow>
            )}
          </FormTable>
        </FormSection>
      </div>

      {isBundle && bundleSection}
    </div>
  )
}

/**
 * 상품유형: 기준상품(개입) or 묶음상품, chosen on 등록 and fixed afterwards
 * (`locked`). The first row of 필수정보.
 */
function ProductTypeRow({
  form,
  locked,
  onChange,
}: {
  form: ProductFormApi
  locked: boolean
  onChange: (productType: ProductType) => void
}) {
  return (
    <Controller
      control={form.control}
      name="productType"
      render={({ field, fieldState }) => {
        const errorId = `${productFieldId("productType")}-error`
        return (
          <FormRow
            label="상품유형"
            required
            hint="등록한 뒤에는 바꿀 수 없습니다."
            error={fieldState.error?.message}
            errorId={errorId}
          >
            <RadioGroup
              aria-label="상품유형"
              aria-required
              aria-invalid={fieldState.invalid || undefined}
              aria-describedby={fieldState.invalid ? errorId : undefined}
              disabled={locked}
              value={field.value}
              onValueChange={(value) => {
                const next = value === "bundle" ? "bundle" : "base"
                if (next !== field.value) onChange(next)
              }}
              className="flex w-auto flex-wrap gap-x-4 gap-y-1"
            >
              {PRODUCT_TYPES.map((type) => (
                <InlineRadio
                  key={type.value}
                  id={`${productFieldId("productType")}-${type.value}`}
                  value={type.value}
                  label={type.longLabel}
                  title={type.description}
                  disabled={locked}
                  ref={field.value === type.value ? field.ref : undefined}
                />
              ))}
            </RadioGroup>
          </FormRow>
        )
      }}
    />
  )
}

/**
 * 단위: a select of UNITS (a saved unit no longer in the list still shows).
 * `note` (a warning) replaces the usual hint. `locked`: the product has
 * stock records, so the 단위 cannot change (the database refuses it too).
 */
function UnitRow({
  form,
  isBundle,
  note,
  locked,
}: {
  form: ProductFormApi
  isBundle: boolean
  note?: React.ReactNode
  locked: boolean
}) {
  return (
    <Controller
      control={form.control}
      name="unit"
      render={({ field, fieldState }) => {
        const id = productFieldId("unit")
        const units: string[] = [...UNITS]
        if (field.value && !units.includes(field.value)) {
          units.unshift(field.value)
        }
        return (
          <FormRow
            label="단위"
            htmlFor={id}
            required
            hint={
              note ??
              (locked
                ? `재고 기록이 있어 단위를 바꿀 수 없습니다. 재고 수량과 수불이 모두 ‘${field.value}’ 단위로 기록되어 있습니다.`
                : isBundle
                  ? "이 묶음상품을 세는 단위 (예: 묶음, 박스, 세트)"
                  : "재고·주문을 세는 단위")
            }
            error={fieldState.error?.message}
            errorId={`${id}-error`}
          >
            <Select
              items={units.map((unit) => ({ value: unit, label: unit }))}
              value={field.value || null}
              onValueChange={(value) => field.onChange(value ?? "")}
              disabled={locked}
            >
              <SelectTrigger
                id={id}
                ref={field.ref}
                onBlur={field.onBlur}
                aria-required
                aria-invalid={fieldState.invalid}
                aria-describedby={
                  fieldState.invalid ? `${id}-error` : undefined
                }
                className="h-8 w-40 rounded-sm"
              >
                <SelectValue placeholder="단위 선택" />
              </SelectTrigger>
              <SelectContent>
                {units.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormRow>
        )
      }}
    />
  )
}

/**
 * 과세구분 / 보관온도: one radio button per choice, in a row. Nothing is
 * chosen at first (the user must pick).
 */
function ChoiceRow({
  form,
  name,
  label,
  options,
  hint,
}: {
  form: ProductFormApi
  name: "taxType" | "storageType"
  label: string
  options: readonly { value: string; label: string; description: string }[]
  hint?: React.ReactNode
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => {
        const errorId = `${productFieldId(name)}-error`
        return (
          <FormRow
            label={label}
            required
            hint={hint}
            error={fieldState.error?.message}
            errorId={errorId}
          >
            <RadioGroup
              aria-label={label}
              aria-required
              aria-invalid={fieldState.invalid}
              aria-describedby={fieldState.invalid ? errorId : undefined}
              value={field.value}
              onValueChange={(value) => field.onChange(String(value))}
              className="flex w-auto flex-wrap gap-x-4 gap-y-1"
            >
              {options.map((option, index) => (
                <InlineRadio
                  key={option.value}
                  id={`${productFieldId(name)}-${option.value}`}
                  value={option.value}
                  label={option.label}
                  title={option.description}
                  // The chosen option (or the first one) gets the focus when
                  // the field has an error.
                  ref={
                    (field.value ? field.value === option.value : index === 0)
                      ? field.ref
                      : undefined
                  }
                />
              ))}
            </RadioGroup>
          </FormRow>
        )
      }}
    />
  )
}

/** A radio button with its label on the right, for one-line choices. */
function InlineRadio({
  id,
  value,
  label,
  title,
  disabled = false,
  ref,
}: {
  id: string
  value: string
  label: string
  title?: string
  disabled?: boolean
  ref?: React.Ref<HTMLSpanElement>
}) {
  return (
    <label
      htmlFor={id}
      title={title}
      className={cn(
        "flex min-h-7 items-center gap-1.5 text-[13px]",
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      )}
    >
      <RadioGroupItem id={id} value={value} ref={ref} />
      {label}
    </label>
  )
}

/** 바코드. A scanner types the code and presses Enter: Enter does not save. */
function BarcodeRow({
  form,
  errors,
}: {
  form: ProductFormApi
  errors: Errors
}) {
  return (
    <TextRow
      form={form}
      errors={errors}
      name="barcode"
      label="바코드"
      placeholder="숫자 8~14자리"
      inputMode="numeric"
      onKeyDown={(event) => {
        if (event.key === "Enter") event.preventDefault()
      }}
    />
  )
}

/**
 * 상품 분류: the chosen category's path or "미분류", with [분류적용] (the
 * picker dialog), [분류해제] (back to 미분류) and [분류값 설정] (상품분류설정
 * in a new tab, so this unsaved form is not lost).
 */
function CategoryRow({
  form,
  categories,
  savedCategoryId,
  savedCategoryPath,
  onOpenCategoryPicker,
}: {
  form: ProductFormApi
  categories: CategoryNode[]
  savedCategoryId: string
  savedCategoryPath: ProductCategoryPathItem[]
  onOpenCategoryPicker: () => void
}) {
  return (
    <Controller
      control={form.control}
      name="categoryId"
      render={({ field, fieldState }) => {
        const errorId = `${productFieldId("categoryId")}-error`
        let path: { name: string; isActive: boolean }[] = field.value
          ? findCategoryPath(categories, field.value)
          : []
        // The tree may be older than the product (a category added in
        // another tab): use the path read together with the product.
        if (
          path.length === 0 &&
          field.value &&
          field.value === savedCategoryId
        ) {
          path = savedCategoryPath
        }
        const pathText = formatCategoryPath(path)
        const isInactive = path.some((category) => !category.isActive)

        return (
          <FormRow
            label="상품 분류"
            error={fieldState.error?.message}
            errorId={errorId}
          >
            <span
              className={cn(
                "min-w-0 text-[13px] break-all",
                field.value ? "font-bold" : "text-muted-foreground"
              )}
            >
              {field.value
                ? pathText || "찾을 수 없는 분류 (다시 선택해 주세요)"
                : "미분류"}
              {isInactive && (
                <span className="ml-1 font-normal text-muted-foreground">
                  (사용 중지된 분류)
                </span>
              )}
            </span>
            <span className="flex flex-wrap items-center gap-1">
              <ActionButton
                ref={field.ref}
                size="sm"
                variant="secondary"
                aria-describedby={fieldState.invalid ? errorId : undefined}
                onClick={onOpenCategoryPicker}
              >
                분류적용
              </ActionButton>
              <ActionButton
                size="sm"
                variant="neutral"
                disabled={!field.value}
                onClick={() => field.onChange("")}
              >
                분류해제
              </ActionButton>
              <ActionLink
                size="sm"
                variant="neutral"
                href={CATEGORY_SETTINGS_HREF}
                target="_blank"
                rel="noopener"
                title="상품분류설정이 새 탭에서 열립니다"
              >
                분류값 설정
                <ExternalLinkIcon aria-hidden="true" />
                <span className="sr-only">(새 탭에서 열림)</span>
              </ActionLink>
            </span>
          </FormRow>
        )
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// 상품단가 tab
// ---------------------------------------------------------------------------

/**
 * A 구성상품 as the 상품단가 tab needs it: its name, 과세구분 and prices
 * (부가세 포함), with the 수량 typed for it (null while it is not valid).
 * A BundleComponent with its parsed 수량 fits.
 */
export type PricedComponent = Pick<
  BaseProductOption,
  | "code"
  | "name"
  | "unit"
  | "taxType"
  | "purchasePriceInclVat"
  | "salePriceInclVat"
> & { quantity: number | null }

/** The two price boxes of the 상품단가 tab. */
const PRICE_FIELDS = [
  {
    name: "purchasePriceInclVat",
    kind: "purchase",
    // No-break space: on a narrow screen the label breaks before "(".
    label: "기본 매입가 (부가세 포함)",
    priceName: "매입가",
  },
  {
    name: "salePriceInclVat",
    kind: "sale",
    label: "기본 판매가 (부가세 포함)",
    priceName: "판매가",
  },
] as const

type PriceName = (typeof PRICE_FIELDS)[number]["priceName"]

/**
 * Shown under a price box whose text is not a valid amount (e.g. "12000.5",
 * "-500", over 100억) until its own error message appears.
 */
const PRICE_INPUT_RULE = "0 이상 100억 원 이하의 원 단위 숫자로 입력해 주세요."

// Wider label column: the price labels are longer than the form's.
const priceRowClass =
  "grid-cols-[7.5rem_minmax(0,1fr)] sm:grid-cols-[11.5rem_minmax(0,1fr)]"

/**
 * A price with its 부가세 별도 amount and 부가세, by the 과세구분 in effect
 * (`taxType`: "taxable", "exempt", "mixed", or "" while not known). A 혼합
 * 묶음상품's price is split by the same price of its 구성상품
 * (componentVatWeights). Null when the price is empty or cannot be split.
 * The list gets the same numbers from the database (product_list_items).
 */
function splitPrice(
  amount: number | null,
  taxType: string,
  components: readonly PricedComponent[] | null,
  kind: PriceKind
): VatSplit | null {
  const weights =
    taxType === "mixed" && components
      ? componentVatWeights(components, kind)
      : null
  return splitVat(amount, taxType, weights)
}

/** Whether the 과세구분 in effect is known (else no 부가세 can be worked out). */
function isKnownTaxType(taxType: string): boolean {
  return taxType === "taxable" || taxType === "exempt" || taxType === "mixed"
}

/**
 * 상품단가: 기본 매입가 and 기본 판매가, typed 부가세 포함 (VAT-inclusive,
 * stored as typed). Next to each box, the 부가세 별도 amount and the 부가세
 * are worked out as you type (`@/lib/products/vat`, the same rules as the
 * database).
 * `taxType` is the 과세구분 in effect (a 묶음상품's worked-out one, "mixed"
 * = 혼합). For a 묶음상품 (`bundleComponents`) a 혼합 price is split by its
 * 구성상품's prices, and the tab also shows, for reference only, 개당 환산가
 * (one kind of 기준상품) and 구성 기준가 합계.
 */
export function ProductPriceFields({
  form,
  taxType,
  bundleComponents,
}: {
  form: ProductFormApi
  taxType: string
  /** 묶음상품: its 구성상품; null for a 기준상품. */
  bundleComponents: PricedComponent[] | null
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <FormSection
        title="상품단가"
        description="부가세 포함 금액(원)으로 입력합니다. 부가세 별도 금액은 자동으로 계산됩니다. 비워 둬도 되며, 비워 두면 목록에 '-'로 표시됩니다."
      >
        <FormTable>
          {PRICE_FIELDS.map(({ name, kind, label, priceName }) => (
            <Controller
              key={name}
              control={form.control}
              name={name}
              render={({ field, fieldState }) => {
                const id = productFieldId(name)
                const previewId = `${id}-vat`
                const typed = field.value.trim() !== ""
                const amount = parsePriceInput(field.value)
                // Something typed that is not a valid amount: the preview
                // goes away, so say what is allowed instead.
                const typedInvalid = typed && amount === null
                const showPreview = amount !== null && isKnownTaxType(taxType)
                const split = splitPrice(
                  amount,
                  taxType,
                  bundleComponents,
                  kind
                )
                const describedBy = [
                  showPreview ? previewId : null,
                  fieldState.invalid ? `${id}-error` : null,
                ].filter((value) => value !== null)
                return (
                  <FormRow
                    label={label}
                    htmlFor={id}
                    className={priceRowClass}
                    hint={
                      typedInvalid ? (
                        // Once the error message shows, it says the same.
                        fieldState.invalid ? null : (
                          PRICE_INPUT_RULE
                        )
                      ) : (
                        <VatHint
                          taxType={taxType}
                          amount={amount}
                          components={bundleComponents}
                          kind={kind}
                          priceName={priceName}
                        />
                      )
                    }
                    error={fieldState.error?.message}
                    errorId={`${id}-error`}
                  >
                    <NumberInput
                      id={id}
                      ref={field.ref}
                      name={field.name}
                      value={field.value}
                      onChange={(value) => {
                        field.onChange(value)
                        // While its message is shown, keep it up to date as
                        // you type (it goes away once the amount is valid).
                        if (fieldState.invalid) void form.trigger(name)
                      }}
                      onBlur={() => {
                        field.onBlur()
                        // Check the box on leaving it, so a wrong amount
                        // shows its message now (not only on 저장).
                        if (typed || fieldState.invalid) {
                          void form.trigger(name)
                        }
                      }}
                      unit="원"
                      thousands
                      aria-invalid={fieldState.invalid}
                      aria-describedby={
                        describedBy.length > 0
                          ? describedBy.join(" ")
                          : undefined
                      }
                      containerClassName="w-44"
                      className="h-8 rounded-sm"
                    />
                    {showPreview && <VatPreview id={previewId} split={split} />}
                  </FormRow>
                )
              }}
            />
          ))}
        </FormTable>
      </FormSection>

      {bundleComponents && (
        <BundlePriceReference
          form={form}
          taxType={taxType}
          components={bundleComponents}
        />
      )}
    </div>
  )
}

/**
 * "부가세 별도 10,910원 · 부가세 1,090원" next to a price box, worked out
 * as you type. "-" when a 혼합 price cannot be split (VatHint says why).
 */
function VatPreview({ id, split }: { id: string; split: VatSplit | null }) {
  // Two parts that each stay on one line; on a narrow screen the second
  // part moves to the next line.
  return (
    <span
      id={id}
      className="inline-flex flex-wrap gap-x-1 text-[13px] tabular-nums"
    >
      <span className="whitespace-nowrap">
        부가세 별도{" "}
        <span className="font-bold">
          {split ? `${formatNumber(split.excluded, 0)}원` : EMPTY_VALUE}
        </span>
      </span>{" "}
      <span className="whitespace-nowrap text-muted-foreground">
        · 부가세 {split ? `${formatNumber(split.vat, 0)}원` : EMPTY_VALUE}
      </span>
    </span>
  )
}

/** Grey help text of a price row: how its 부가세 is worked out. */
function VatHint({
  taxType,
  amount,
  components,
  kind,
  priceName,
}: {
  taxType: string
  amount: number | null
  /** 묶음상품: its 구성상품; null for a 기준상품. */
  components: readonly PricedComponent[] | null
  kind: PriceKind
  priceName: PriceName
}) {
  if (taxType === "taxable") {
    return amount === null
      ? "과세 상품: 금액을 넣으면 부가세 별도 금액이 계산됩니다."
      : "부가세 = 포함 금액 ÷ 11 (원 미만 버림)"
  }
  if (taxType === "exempt") return "면세 상품이라 부가세가 없습니다."
  if (taxType === "mixed") {
    return (
      <MixedVatNote
        amount={amount}
        components={components ?? []}
        kind={kind}
        priceName={priceName}
      />
    )
  }
  return components
    ? "구성상품(기준상품)을 추가하면 과세구분이 정해지고 부가세 별도 금액이 계산됩니다."
    : "공통정보 탭에서 과세구분을 고르면 부가세 별도 금액이 계산됩니다."
}

/**
 * How a 혼합 묶음상품's price is split: by its 구성상품's prices of the same
 * kind (판매가 for the 판매가), 과세 : 면세. Says why when it cannot be split
 * (the preview then shows "-").
 */
function MixedVatNote({
  amount,
  components,
  kind,
  priceName,
}: {
  amount: number | null
  components: readonly PricedComponent[]
  kind: PriceKind
  priceName: PriceName
}) {
  const basis = `혼합 묶음상품은 구성상품의 기본 ${priceName} 비율로 과세분과 면세분을 나눠 과세분에만 부가세를 계산합니다.`
  if (components.some((component) => component.quantity === null)) {
    return `${basis} 구성상품의 수량을 모두 넣으면 계산됩니다.`
  }
  const missing = components.filter(
    (component) =>
      (kind === "sale"
        ? component.salePriceInclVat
        : component.purchasePriceInclVat) === null
  )
  if (missing.length > 0) {
    return `${basis} 기본 ${priceName}가 비어 있는 구성상품이 있어 계산할 수 없습니다 (${namesText(missing)}).`
  }
  const weights = componentVatWeights(components, kind)
  if (weights === null) return `${basis} 금액이 너무 커서 계산할 수 없습니다.`
  if (weights.total <= 0) {
    return `${basis} 구성상품의 기본 ${priceName}가 모두 0원이라 나눌 수 없습니다.`
  }
  const ratio = `과세 ${formatNumber(weights.taxable, 0)}원 : 면세 ${formatNumber(weights.total - weights.taxable, 0)}원`
  const allocation = amount === null ? null : allocateMixed(amount, weights)
  const taxablePart = allocation
    ? `과세분 ${formatNumber(allocation.taxable, 0)}원(면세분 ${formatNumber(allocation.exempt, 0)}원)`
    : "과세분"
  return `혼합 묶음상품: 구성상품의 기본 ${priceName} × 수량 합계 비율(${ratio})로 나눠 ${taxablePart}에만 부가세를 계산합니다.`
}

/** "대파, 양파 외 2개": the first names of these 구성상품. */
function namesText(components: readonly PricedComponent[]): string {
  const shown = components.slice(0, 2).map((component) => component.name)
  const rest = components.length - shown.length
  return rest > 0 ? `${shown.join(", ")} 외 ${rest}개` : shown.join(", ")
}

/**
 * 참고 단가 of a 묶음상품 (not saved), each as 부가세 별도 and 부가세 포함:
 * - 개당 환산가 = this price ÷ the quantity (one kind of 기준상품 only),
 *   for the 포함 and the 별도 amount alike;
 * - 구성 기준가 합계 = Σ 기준상품 price × quantity (포함), and Σ each
 *   기준상품's own 별도 amount × quantity (별도), when all are known.
 */
function BundlePriceReference({
  form,
  taxType,
  components,
}: {
  form: ProductFormApi
  taxType: string
  components: PricedComponent[]
}) {
  const [purchaseText, saleText] = useWatch({
    control: form.control,
    name: ["purchasePriceInclVat", "salePriceInclVat"],
  })
  const amounts: Record<PriceKind, number | null> = {
    purchase: parsePriceInput(purchaseText),
    sale: parsePriceInput(saleText),
  }

  const single = components.length === 1 ? components[0] : null
  const allQuantities = components.every(
    (component) => component.quantity !== null
  )

  /** 개당 환산가 of one price, or why it cannot be worked out. */
  function perUnitLine(kind: PriceKind): ReferenceValue {
    if (single === null) return "기준상품을 추가하면 계산됩니다."
    if (single.quantity === null)
      return "구성상품의 수량을 입력하면 계산됩니다."
    const amount = amounts[kind]
    if (amount === null) return "가격을 입력하면 계산됩니다."
    const split = splitPrice(amount, taxType, components, kind)
    return perUnitPrice(
      split ?? { included: amount, excluded: null },
      single.quantity
    )
  }

  /** 구성 기준가 합계 of one price, or why it cannot be worked out. */
  function totalLine(kind: PriceKind, priceName: PriceName): ReferenceValue {
    if (components.length === 0) return "기준상품을 추가하면 계산됩니다."
    if (!allQuantities) return "구성상품의 수량을 모두 입력하면 계산됩니다."
    return (
      componentPriceTotal(components, kind) ??
      `기본 ${priceName}가 비어 있는 기준상품이 있어 계산할 수 없습니다.`
    )
  }

  return (
    <FormSection
      title="참고 단가"
      description="저장하지 않는 참고용 금액입니다."
    >
      <FormTable>
        {single && (
          <FormRow
            label="개당 환산가"
            className={priceRowClass}
            hint={`묶음상품 가격 ÷ ${single.quantity === null ? "수량" : `${formatNumber(single.quantity, 0)}${single.unit}`} = ${single.name} 1${single.unit}당 가격`}
          >
            <ReferenceTable
              caption="개당 환산가"
              purchase={perUnitLine("purchase")}
              sale={perUnitLine("sale")}
            />
          </FormRow>
        )}
        <FormRow
          label="구성 기준가 합계"
          className={priceRowClass}
          hint="기준상품의 기본 매입가·판매가 × 수량을 모두 더한 금액 (부가세 별도는 기준상품마다 계산해 더함)"
        >
          <ReferenceTable
            caption="구성 기준가 합계"
            purchase={totalLine("purchase", "매입가")}
            sale={totalLine("sale", "판매가")}
          />
        </FormRow>
      </FormTable>
    </FormSection>
  )
}

/** An amount as 부가세 포함 / 별도, or a message why it is not known. */
type ReferenceValue = PriceInclExcl | string | null

/**
 * A small table of one 참고 단가:
 *        부가세 별도   부가세 포함
 *   매입    25,455원      28,000원
 *   판매          -             -   가격을 입력하면 계산됩니다.
 * An amount that is not known shows "-", with the reason (if any) after it.
 */
function ReferenceTable({
  caption,
  purchase,
  sale,
}: {
  caption: string
  purchase: ReferenceValue
  sale: ReferenceValue
}) {
  const lines = [
    { label: "매입", value: purchase },
    { label: "판매", value: sale },
  ].map(({ label, value }) => ({
    label,
    amounts: typeof value === "string" ? null : value,
    note: typeof value === "string" ? value : null,
  }))
  const hasNotes = lines.some((line) => line.note !== null)
  const amountText = (amount: number | null | undefined) =>
    amount === null || amount === undefined
      ? EMPTY_VALUE
      : `${formatNumber(amount, 0)}원`
  const headClass = "px-2 text-right text-xs font-normal text-muted-foreground"

  return (
    <table className="text-[13px] tabular-nums">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <td />
          <th scope="col" className={headClass}>
            부가세 별도
          </th>
          <th scope="col" className={headClass}>
            부가세 포함
          </th>
          {hasNotes && <td />}
        </tr>
      </thead>
      <tbody>
        {lines.map(({ label, amounts, note }) => (
          <tr key={label}>
            <th
              scope="row"
              className="pr-2 text-left font-normal text-muted-foreground"
            >
              {label}
            </th>
            <td className="px-2 text-right font-bold">
              {amountText(amounts?.excluded)}
            </td>
            <td className="px-2 text-right font-bold">
              {amountText(amounts?.included)}
            </td>
            {hasNotes && (
              <td className="pl-2 text-xs text-muted-foreground">{note}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------------------
// 상세설정 tab (기준상품 only)
// ---------------------------------------------------------------------------

/** 상세설정: 유통기한 기준일수 and 알레르기 유발물질. */
export function ProductDetailFields({ form }: { form: ProductFormApi }) {
  return (
    <FormSection title="상세설정" className="max-w-4xl">
      <FormTable>
        <Controller
          control={form.control}
          name="shelfLifeDays"
          render={({ field, fieldState }) => {
            const id = productFieldId("shelfLifeDays")
            return (
              <FormRow
                label="유통기한 기준일수"
                htmlFor={id}
                hint="제조일로부터 며칠까지인지 입력합니다 (1~3650일). 입고할 때 기한을 계산하는 기본값으로 씁니다."
                error={fieldState.error?.message}
                errorId={`${id}-error`}
              >
                <span className="text-[13px]">제조일로부터</span>
                <NumberInput
                  id={id}
                  ref={field.ref}
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  unit="일"
                  aria-invalid={fieldState.invalid}
                  aria-describedby={
                    fieldState.invalid ? `${id}-error` : undefined
                  }
                  containerClassName="w-32"
                  className="h-8 rounded-sm"
                />
              </FormRow>
            )
          }}
        />
        <Controller
          control={form.control}
          name="allergens"
          render={({ field, fieldState }) => (
            <FormRow
              label="알레르기 유발물질"
              hint="식품 등의 표시기준에 따른 표시 대상입니다. 해당하는 것을 모두 고르세요."
              error={fieldState.error?.message}
              errorId={`${productFieldId("allergens")}-error`}
            >
              <div className="grid w-full grid-cols-2 gap-x-4 gap-y-1.5 py-1 sm:grid-cols-3 xl:grid-cols-4">
                {ALLERGENS.map((allergen, index) => {
                  const id = `product-allergen-${allergen.value}`
                  const checked = field.value.includes(allergen.value)
                  return (
                    <label
                      key={allergen.value}
                      htmlFor={id}
                      className="flex min-h-6 cursor-pointer items-center gap-2 text-[13px]"
                    >
                      <Checkbox
                        id={id}
                        ref={index === 0 ? field.ref : undefined}
                        checked={checked}
                        onCheckedChange={(next) =>
                          field.onChange(
                            next
                              ? [...field.value, allergen.value]
                              : field.value.filter(
                                  (value) => value !== allergen.value
                                )
                          )
                        }
                      />
                      {allergen.label}
                    </label>
                  )
                })}
              </div>
            </FormRow>
          )}
        />
      </FormTable>
    </FormSection>
  )
}
