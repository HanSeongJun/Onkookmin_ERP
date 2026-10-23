"use client"

import { ExternalLinkIcon, SearchIcon } from "lucide-react"
import {
  Controller,
  useWatch,
  type FieldErrors,
  type UseFormReturn,
} from "react-hook-form"

import { PARTNER_CATEGORY_SETTINGS_HREF } from "@/app/(app)/partners/categories/settings-link"
import { NumberInput } from "@/app/(app)/products/_components/number-input"
import { ActionButton, ActionLink } from "@/components/erp/action-bar"
import { FormRow, FormSection, FormTable } from "@/components/erp/form-table"
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
  formatEmployeeLabel,
  selectableEmployees,
  type EmployeeDuty,
  type EmployeeOption,
} from "@/lib/employees/schema"
import { formatDateTime, formatNumber } from "@/lib/format"
import {
  findCategoryPath,
  formatCategoryPath,
  isCategorySelectable,
  type PartnerCategoryNode,
} from "@/lib/partner-categories/tree"
import {
  isValidBusinessNumber,
  toBusinessNumberDigits,
} from "@/lib/partners/business-number"
import {
  CREDIT_LIMIT_TYPES,
  INVOICE_TYPES,
  PARTNER_INDUSTRIES,
  PARTNER_LIMITS,
  PARTNER_TYPES,
  PAYMENT_TERMS,
  partnerTypeLabel,
  SLIP_PRINT_TYPES,
} from "@/lib/partners/constants"
import type {
  PartnerCategoryReference,
  PartnerDetail,
  PartnerEmployeeReference,
  SameBusinessNumberPartner,
} from "@/lib/partners/queries"
import type { PartnerFormInput, PartnerFormValues } from "@/lib/partners/schema"
import { cn } from "@/lib/utils"

import { BusinessNumberInput, PhoneInput } from "./formatted-input"

/** The 거래처 form (react-hook-form) shared by the tabs. */
export type PartnerFormApi = UseFormReturn<
  PartnerFormInput,
  unknown,
  PartnerFormValues
>

export type PartnerErrors = FieldErrors<PartnerFormInput>

/** The choices of the form's select boxes (read when the modal opens). */
export type PartnerFormOptions = {
  /** Every 거래처분류 as a tree, 사용 and 사용 중지. */
  categories: PartnerCategoryNode[]
  /** Every employee, 재직 and 퇴사. */
  employees: EmployeeOption[]
}

/**
 * Id of a form field's input, e.g. "partner-code" or
 * "partner-contacts-0-name" (for "contacts.0.name").
 */
export function partnerFieldId(path: string): string {
  return `partner-${path.replaceAll(".", "-")}`
}

/** Id of a field's error message (for aria-describedby). */
export function partnerErrorId(path: string): string {
  return `${partnerFieldId(path)}-error`
}

// flex-1 + min-w-40: the box gives up some width so a short hint fits on
// the same line (the reference screen keeps every row one line high).
const inputClass = "h-8 min-w-40 flex-1 max-w-80 rounded-sm"

/** Text fields of the form typed into a plain box (registered). */
type TextFieldName =
  | "code"
  | "name"
  | "companyName"
  | "representative"
  | "businessCategory"
  | "businessItem"
  | "taxEmail"

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
  type = "text",
  wide = false,
}: {
  form: PartnerFormApi
  errors: PartnerErrors
  name: TextFieldName
  label: string
  required?: boolean
  placeholder?: string
  maxLength?: number
  hint?: React.ReactNode
  title?: string
  type?: "text" | "email"
  wide?: boolean
}) {
  const id = partnerFieldId(name)
  const error = errors[name]?.message
  return (
    <FormRow
      label={label}
      htmlFor={id}
      required={required}
      hint={hint}
      error={error}
      errorId={partnerErrorId(name)}
    >
      <Input
        id={id}
        type={type}
        autoComplete="off"
        spellCheck={false}
        maxLength={maxLength}
        placeholder={placeholder}
        title={title}
        aria-required={required || undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? partnerErrorId(name) : undefined}
        className={cn(inputClass, wide && "max-w-none")}
        {...form.register(name)}
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

/** A radio button with its label on the right, for one-line choices. */
export function InlineRadio({
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
      <RadioGroupItem id={id} value={value} ref={ref} disabled={disabled} />
      {label}
    </label>
  )
}

/** Value of a select box option meaning "none" (stored as ""). */
const NONE = "__none__"

type SelectOption = { value: string; label: string }

/**
 * A select box over a text field where "" means "none" (`noneLabel`, e.g.
 * "미분류", "없음"). Without `noneLabel` nothing can be unselected and
 * `placeholder` shows while it is empty. `onOpen` runs when the list opens
 * (e.g. to read the choices again).
 */
function OptionSelect({
  id,
  value,
  options,
  noneLabel,
  placeholder,
  onChange,
  onBlur,
  onOpen,
  triggerRef,
  invalid,
  describedBy,
  ariaLabel,
  className,
}: {
  id: string
  value: string
  options: SelectOption[]
  noneLabel?: string
  placeholder?: string
  onChange: (value: string) => void
  onBlur?: () => void
  onOpen?: () => void
  triggerRef?: React.Ref<HTMLButtonElement>
  invalid?: boolean
  describedBy?: string
  ariaLabel?: string
  className?: string
}) {
  const items: SelectOption[] = noneLabel
    ? [{ value: NONE, label: noneLabel }, ...options]
    : options
  const selected = value === "" ? (noneLabel ? NONE : null) : value
  return (
    <Select
      items={items}
      value={selected}
      onValueChange={(next) => {
        const text = next === null || next === NONE ? "" : String(next)
        if (text !== value) onChange(text)
      }}
      onOpenChange={(open) => {
        if (open) onOpen?.()
      }}
    >
      <SelectTrigger
        id={id}
        ref={triggerRef}
        onBlur={onBlur}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cn("h-8 w-56 max-w-full rounded-sm", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The select-box fields of the 기본정보 tab ("" = none). */
type SelectFieldName = "industry" | "salesRepId" | "deliveryRepId"

/** One select box row (업종, 영업담당, 배송담당). */
function SelectRow({
  form,
  name,
  label,
  options,
  noneLabel,
  hint,
  onOpen,
}: {
  form: PartnerFormApi
  name: SelectFieldName
  label: string
  options: SelectOption[]
  noneLabel: string
  hint?: React.ReactNode
  onOpen?: () => void
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => {
        const id = partnerFieldId(name)
        return (
          <FormRow
            label={label}
            htmlFor={id}
            hint={hint}
            error={fieldState.error?.message}
            errorId={partnerErrorId(name)}
          >
            <OptionSelect
              id={id}
              value={field.value}
              options={options}
              noneLabel={noneLabel}
              onChange={field.onChange}
              onBlur={field.onBlur}
              onOpen={onOpen}
              triggerRef={field.ref}
              invalid={fieldState.invalid}
              describedBy={
                fieldState.invalid ? partnerErrorId(name) : undefined
              }
            />
          </FormRow>
        )
      }}
    />
  )
}

/** The radio-button fields (one choice of a short list). */
type RadioFieldName = "partnerType" | "invoiceType" | "slipPrint"

/** One row of radio buttons (구분, 계산서 발행, 전표 인쇄). */
function RadioRow({
  form,
  name,
  label,
  options,
  required = false,
  hint,
}: {
  form: PartnerFormApi
  name: RadioFieldName
  label: string
  options: readonly { value: string; label: string; description?: string }[]
  required?: boolean
  hint?: React.ReactNode
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => {
        const errorId = partnerErrorId(name)
        return (
          <FormRow
            label={label}
            required={required}
            hint={hint}
            error={fieldState.error?.message}
            errorId={errorId}
          >
            <RadioGroup
              aria-label={label}
              aria-required={required || undefined}
              aria-invalid={fieldState.invalid || undefined}
              aria-describedby={fieldState.invalid ? errorId : undefined}
              value={field.value}
              onValueChange={(value) => field.onChange(String(value))}
              className="flex w-auto flex-wrap gap-x-4 gap-y-1"
            >
              {options.map((option, index) => (
                <InlineRadio
                  key={option.value}
                  id={`${partnerFieldId(name)}-${option.value}`}
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

/** A phone number row (대표연락처). */
function PhoneRow({
  form,
  name,
  label,
  hint,
}: {
  form: PartnerFormApi
  name: "phone"
  label: string
  hint?: React.ReactNode
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => {
        const id = partnerFieldId(name)
        return (
          <FormRow
            label={label}
            htmlFor={id}
            hint={hint}
            error={fieldState.error?.message}
            errorId={partnerErrorId(name)}
          >
            <PhoneInput
              id={id}
              ref={field.ref}
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-invalid={fieldState.invalid}
              aria-describedby={
                fieldState.invalid ? partnerErrorId(name) : undefined
              }
              className="h-8 w-44 rounded-sm"
            />
          </FormRow>
        )
      }}
    />
  )
}

/**
 * The choices of a 영업담당 (`duty` "sales") / 배송담당(기사) ("delivery")
 * box: the 재직 employees with that 담당업무, plus the one saved on the
 * partner (even when 퇴사 or without the 담당업무 now, so it can be kept;
 * shown with "(퇴사)" / "(영업담당 해제)").
 */
function employeeOptions(
  employees: readonly EmployeeOption[],
  duty: EmployeeDuty,
  saved: PartnerEmployeeReference | null
): SelectOption[] {
  const list = selectableEmployees(employees, duty, saved?.id ?? null)
  if (saved && !list.some((employee) => employee.id === saved.id)) {
    // Only its label is used: the other details don't matter here.
    list.unshift({
      ...saved,
      department: null,
      jobTitle: null,
      salesPartnerCount: 0,
      deliveryPartnerCount: 0,
    })
  }
  return list.map((employee) => ({
    value: employee.id,
    label: formatEmployeeLabel(employee, duty),
  }))
}

/** Hint under a 영업담당 / 배송담당 box when nobody can be chosen yet. */
function noEmployeeHint(
  employees: readonly EmployeeOption[],
  duty: EmployeeDuty
): string | undefined {
  if (selectableEmployees(employees, duty, null).length > 0) return undefined
  return duty === "sales"
    ? "직원관리에서 담당업무 ‘영업담당’을 체크한 재직 직원을 먼저 등록해 주세요."
    : "직원관리에서 담당업무 ‘배송담당’을 체크한 재직 직원(기사)을 먼저 등록해 주세요."
}

/**
 * 거래처분류: the chosen category's path ("대분류 > 중분류 > 소분류") or
 * "미분류", with [분류적용] (the picker), [분류해제] (back to 미분류) and
 * [분류값 설정] (거래처분류설정 in a new tab, so this form is not lost).
 */
function CategoryRow({
  form,
  categories,
  saved,
  onOpenPicker,
}: {
  form: PartnerFormApi
  categories: PartnerCategoryNode[]
  /** The saved partner's category (null for 등록 or 미분류). */
  saved: PartnerCategoryReference | null
  onOpenPicker: () => void
}) {
  return (
    <Controller
      control={form.control}
      name="categoryId"
      render={({ field, fieldState }) => {
        const errorId = partnerErrorId("categoryId")
        const path = field.value
          ? findCategoryPath(categories, field.value)
          : []
        let pathText = formatCategoryPath(path)
        let isInactive =
          path.length > 0 && !isCategorySelectable(categories, field.value)
        // The tree may be older than the partner (a category added in
        // another tab): use the path read together with the partner.
        if (path.length === 0 && field.value && field.value === saved?.id) {
          pathText = saved.path
          isInactive = !saved.isActive
        }

        return (
          <FormRow
            label="거래처분류"
            error={fieldState.error?.message}
            errorId={errorId}
          >
            <span
              id={partnerFieldId("categoryId")}
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
                onClick={onOpenPicker}
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
                href={PARTNER_CATEGORY_SETTINGS_HREF}
                target="_blank"
                rel="noopener"
                title="거래처분류설정의 분류값 설정이 새 탭에서 열립니다"
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
// 기본정보 tab
// ---------------------------------------------------------------------------

/**
 * 기본정보, like the reference screen: 필수정보 and 기본정보 on the left,
 * 추가정보 (거래조건) on the right (one column on narrow screens).
 */
export function PartnerBasicFields({
  form,
  errors,
  options,
  saved,
  codeHint,
  onReloadOptions,
  onOpenCategoryPicker,
  onManageAddresses,
}: {
  form: PartnerFormApi
  errors: PartnerErrors
  options: PartnerFormOptions
  /** 거래처 수정: the saved partner (null for 등록). */
  saved: PartnerDetail | null
  /** Hint next to 거래처코드 (e.g. "사용할 수 있는 코드입니다."). */
  codeHint?: React.ReactNode
  /** Reads the choices again (a select box opened). */
  onReloadOptions: () => void
  /** Opens the 거래처분류 picker ([분류적용]). */
  onOpenCategoryPicker: () => void
  /** Goes to the 배송지 tab. */
  onManageAddresses: () => void
}) {
  return (
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
            <RadioRow
              form={form}
              name="partnerType"
              label="구분"
              required
              options={PARTNER_TYPES}
            />
            <TextRow
              form={form}
              errors={errors}
              name="code"
              label="거래처코드"
              required
              placeholder="예: 100001"
              maxLength={PARTNER_LIMITS.codeMaxLength}
              hint={codeHint ?? "영문·숫자·-_. 30자 이내"}
              title="영문·숫자·하이픈(-)·밑줄(_)·마침표(.)로 30자까지. 대소문자만 다른 코드는 같은 코드로 봅니다."
            />
            <TextRow
              form={form}
              errors={errors}
              name="name"
              label="거래처명"
              required
              placeholder="예: 한빛식당 본점"
              maxLength={PARTNER_LIMITS.nameMaxLength}
              wide
            />
          </FormTable>
        </FormSection>

        <FormSection title="기본정보">
          <FormTable>
            <PhoneRow
              form={form}
              name="phone"
              label="대표연락처"
              hint="숫자만 입력하면 - 가 자동으로 들어갑니다."
            />
            <SelectRow
              form={form}
              name="industry"
              label="업종"
              noneLabel="미지정"
              options={PARTNER_INDUSTRIES.map(({ value, label }) => ({
                value,
                label,
              }))}
            />
            <SelectRow
              form={form}
              name="salesRepId"
              label="영업담당"
              noneLabel="없음"
              options={employeeOptions(
                options.employees,
                "sales",
                saved?.salesRep ?? null
              )}
              onOpen={onReloadOptions}
              hint={
                noEmployeeHint(options.employees, "sales") ??
                "판매 채널(쿠팡·스마트스토어 등)"
              }
            />
            <SelectRow
              form={form}
              name="deliveryRepId"
              label="배송담당(기사)"
              noneLabel="없음"
              options={employeeOptions(
                options.employees,
                "delivery",
                saved?.deliveryRep ?? null
              )}
              onOpen={onReloadOptions}
              hint={
                noEmployeeHint(options.employees, "delivery") ??
                "이 거래처의 주문을 배송할 기사"
              }
            />
            <CategoryRow
              form={form}
              categories={options.categories}
              saved={saved?.category ?? null}
              onOpenPicker={onOpenCategoryPicker}
            />
            <DefaultAddressRow form={form} onManage={onManageAddresses} />
          </FormTable>
        </FormSection>
      </div>

      <FormSection
        title="추가정보"
        description="거래조건"
        className="lg:self-start"
      >
        <FormTable>
          <PaymentRow form={form} />
          <CreditLimitRow form={form} />
          <RadioRow
            form={form}
            name="invoiceType"
            label="계산서 발행"
            options={INVOICE_TYPES}
          />
          <RadioRow
            form={form}
            name="slipPrint"
            label="전표 인쇄"
            options={SLIP_PRINT_TYPES}
            hint="거래명세표에 금액을 찍을지 정합니다."
          />
          {saved && (
            <>
              <FormRow label="등록일">
                <span className="text-[13px] tabular-nums">
                  {formatDateTime(saved.created_at)}
                </span>
              </FormRow>
              <FormRow label="최종수정일">
                <span className="text-[13px] tabular-nums">
                  {formatDateTime(saved.updated_at)}
                </span>
              </FormRow>
            </>
          )}
        </FormTable>
      </FormSection>
    </div>
  )
}

/**
 * 기본배송지: the 배송지 tab's 기본 배송지 (as typed now), with a button to
 * that tab ([배송지 등록] while there is none).
 */
function DefaultAddressRow({
  form,
  onManage,
}: {
  form: PartnerFormApi
  onManage: () => void
}) {
  const addresses = useWatch({ control: form.control, name: "addresses" })
  const chosen =
    addresses.find((address) => address.isDefault) ?? addresses[0] ?? null
  const text = chosen
    ? [chosen.address.trim(), chosen.addressDetail.trim()]
        .filter(Boolean)
        .join(" ")
    : ""
  return (
    <FormRow label="기본배송지">
      {chosen ? (
        <span className="min-w-0 text-[13px] break-all">
          {chosen.label.trim() && (
            <span className="mr-1 font-bold">[{chosen.label.trim()}]</span>
          )}
          {text || <span className="text-muted-foreground">주소 미입력</span>}
          {addresses.length > 1 && (
            <span className="ml-1 text-muted-foreground">
              외 {formatNumber(addresses.length - 1, 0)}곳
            </span>
          )}
        </span>
      ) : (
        <span className="text-[13px] text-muted-foreground">없음</span>
      )}
      <ActionButton size="sm" variant="secondary" onClick={onManage}>
        {chosen ? "배송지 관리" : "배송지 등록"}
      </ActionButton>
    </FormRow>
  )
}

/** Days of the month for 결제일 "매월 N일". */
const PAYMENT_DAY_OPTIONS: SelectOption[] = Array.from(
  { length: PARTNER_LIMITS.paymentDayMax - PARTNER_LIMITS.paymentDayMin + 1 },
  (_, index) => {
    const day = String(PARTNER_LIMITS.paymentDayMin + index)
    return { value: day, label: `${day}일` }
  }
)

/** 결제일: 미지정 / 건별 즉시 / 매월 N일 (+ the day) / 매월 말일. */
function PaymentRow({ form }: { form: PartnerFormApi }) {
  const paymentTerm = useWatch({ control: form.control, name: "paymentTerm" })
  const termError = form.formState.errors.paymentTerm?.message
  const dayError = form.formState.errors.paymentDay?.message
  const error = termError ?? (paymentTerm === "monthly_day" ? dayError : null)
  const errorId = partnerErrorId(termError ? "paymentTerm" : "paymentDay")
  return (
    <FormRow
      label="결제일"
      htmlFor={partnerFieldId("paymentTerm")}
      error={error ?? undefined}
      errorId={errorId}
    >
      <Controller
        control={form.control}
        name="paymentTerm"
        render={({ field, fieldState }) => (
          <OptionSelect
            id={partnerFieldId("paymentTerm")}
            value={field.value}
            options={PAYMENT_TERMS.map(({ value, label }) => ({
              value,
              label,
            }))}
            onChange={(value) => {
              field.onChange(value)
              // 매월 N일: choose the day next.
              if (value === "monthly_day") {
                setTimeout(() => form.setFocus("paymentDay"), 0)
              }
            }}
            onBlur={field.onBlur}
            triggerRef={field.ref}
            invalid={fieldState.invalid}
            describedBy={fieldState.invalid ? errorId : undefined}
            className="w-36"
          />
        )}
      />
      {paymentTerm === "monthly_day" && (
        <Controller
          control={form.control}
          name="paymentDay"
          render={({ field, fieldState }) => (
            <span className="flex items-center gap-1.5 text-[13px]">
              매월
              <OptionSelect
                id={partnerFieldId("paymentDay")}
                value={field.value}
                options={PAYMENT_DAY_OPTIONS}
                placeholder="날짜"
                ariaLabel="결제일 (매월 며칠)"
                onChange={field.onChange}
                onBlur={field.onBlur}
                triggerRef={field.ref}
                invalid={fieldState.invalid}
                describedBy={fieldState.invalid ? errorId : undefined}
                className="w-24"
              />
            </span>
          )}
        />
      )}
      {paymentTerm === "monthly_day" && (
        <p className="text-xs text-muted-foreground">
          29~31일은 ‘매월 말일’을 고르세요.
        </p>
      )}
    </FormRow>
  )
}

/**
 * The 외상 한도 choices in screen order: 한도 설정 last, so its amount box
 * can follow it (outside the radio group: arrow keys typed in the box must
 * not move between the radio buttons).
 */
const CREDIT_LIMIT_CHOICES = [
  ...CREDIT_LIMIT_TYPES.filter((option) => option.value !== "limited"),
  ...CREDIT_LIMIT_TYPES.filter((option) => option.value === "limited"),
]

/**
 * 외상(잔액) 한도: 무제한 / 외상 불가 / 한도 설정 + 금액 (원). The amount
 * box is used only for 한도 설정.
 */
function CreditLimitRow({ form }: { form: PartnerFormApi }) {
  const creditLimitType = useWatch({
    control: form.control,
    name: "creditLimitType",
  })
  const limited = creditLimitType === "limited"
  const typeError = form.formState.errors.creditLimitType?.message
  const amountError = limited
    ? form.formState.errors.creditLimit?.message
    : undefined
  const error = typeError ?? amountError
  const errorId = partnerErrorId(typeError ? "creditLimitType" : "creditLimit")
  const amountId = partnerFieldId("creditLimit")

  return (
    <FormRow
      label="외상(잔액) 한도"
      hint={
        error
          ? undefined
          : creditLimitType === "none"
            ? "주문할 때마다 바로 결제하는 거래처입니다."
            : undefined
      }
      error={error}
      errorId={errorId}
    >
      <Controller
        control={form.control}
        name="creditLimitType"
        render={({ field, fieldState }) => (
          <RadioGroup
            aria-label="외상(잔액) 한도"
            aria-invalid={fieldState.invalid || undefined}
            aria-describedby={fieldState.invalid ? errorId : undefined}
            value={field.value}
            onValueChange={(value) => {
              field.onChange(String(value))
              // 한도 설정: type the amount next.
              if (value === "limited") {
                setTimeout(() => document.getElementById(amountId)?.focus(), 0)
              }
            }}
            className="flex w-auto flex-wrap gap-x-4 gap-y-1"
          >
            {CREDIT_LIMIT_CHOICES.map((option, index) => (
              <InlineRadio
                key={option.value}
                id={`${partnerFieldId("creditLimitType")}-${option.value}`}
                value={option.value}
                label={option.label}
                ref={
                  (field.value ? field.value === option.value : index === 0)
                    ? field.ref
                    : undefined
                }
              />
            ))}
          </RadioGroup>
        )}
      />
      <Controller
        control={form.control}
        name="creditLimit"
        render={({ field, fieldState }) => (
          <NumberInput
            id={amountId}
            ref={field.ref}
            name={field.name}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            disabled={!limited}
            unit="원"
            thousands
            placeholder={limited ? "한도 금액" : undefined}
            aria-label="외상 한도 금액"
            aria-invalid={limited && fieldState.invalid}
            aria-describedby={
              limited && fieldState.invalid ? errorId : undefined
            }
            containerClassName="-ml-2 w-40"
            className="h-7 rounded-sm"
          />
        )}
      />
    </FormRow>
  )
}

// ---------------------------------------------------------------------------
// 사업자정보 tab
// ---------------------------------------------------------------------------

/**
 * 사업자정보: 사업자등록번호 (checked as you type; a warning lists other
 * partners with the same number), 상호, 대표자명, 업태, 종목, 사업장 주소
 * ([주소 검색]) and 세금계산서 이메일.
 */
export function PartnerBusinessFields({
  form,
  errors,
  sameNumberPartners,
  onSearchAddress,
}: {
  form: PartnerFormApi
  errors: PartnerErrors
  /**
   * Other partners with the 사업자등록번호 typed now (null while it is
   * incomplete, invalid or still being checked).
   */
  sameNumberPartners: SameBusinessNumberPartner[] | null
  /** Opens the 주소 검색 for the 사업장 주소. */
  onSearchAddress: () => void
}) {
  return (
    <div className="grid gap-x-5 gap-y-4 lg:grid-cols-2">
      <FormSection title="사업자등록 정보" className="lg:self-start">
        <FormTable>
          <BusinessNumberRow
            form={form}
            sameNumberPartners={sameNumberPartners}
          />
          <TextRow
            form={form}
            errors={errors}
            name="companyName"
            label="상호(법인명)"
            placeholder="사업자등록증의 상호"
            maxLength={PARTNER_LIMITS.companyNameMaxLength}
            wide
          />
          <TextRow
            form={form}
            errors={errors}
            name="representative"
            label="대표자명"
            maxLength={PARTNER_LIMITS.representativeMaxLength}
          />
          <TextRow
            form={form}
            errors={errors}
            name="businessCategory"
            label="업태"
            placeholder="예: 음식점업"
            maxLength={PARTNER_LIMITS.businessCategoryMaxLength}
          />
          <TextRow
            form={form}
            errors={errors}
            name="businessItem"
            label="종목"
            placeholder="예: 한식"
            maxLength={PARTNER_LIMITS.businessItemMaxLength}
          />
        </FormTable>
      </FormSection>

      <FormSection title="사업장·세금계산서" className="lg:self-start">
        <FormTable>
          <BusinessAddressRow
            form={form}
            errors={errors}
            onSearchAddress={onSearchAddress}
          />
          <TextRow
            form={form}
            errors={errors}
            name="taxEmail"
            label="세금계산서 이메일"
            type="email"
            placeholder="예: tax@example.com"
            maxLength={PARTNER_LIMITS.emailMaxLength}
            wide
          />
        </FormTable>
      </FormSection>
    </div>
  )
}

/**
 * 사업자등록번호: hyphens as you type, and right away whether the number
 * is valid (its last digit is a check digit). The number is not unique: a
 * warning lists other partners that use it (saving is still allowed).
 */
function BusinessNumberRow({
  form,
  sameNumberPartners,
}: {
  form: PartnerFormApi
  sameNumberPartners: SameBusinessNumberPartner[] | null
}) {
  return (
    <Controller
      control={form.control}
      name="businessNumber"
      render={({ field, fieldState }) => {
        const id = partnerFieldId("businessNumber")
        const errorId = partnerErrorId("businessNumber")
        const digits = toBusinessNumberDigits(field.value)
        const feedbackId = `${id}-check`
        let feedback: React.ReactNode = "숫자 10자리 (- 는 자동)"
        if (digits.length > 0 && digits.length < 10) {
          feedback = `숫자 10자리 중 ${digits.length}자리 입력`
        } else if (digits.length === 10) {
          feedback = isValidBusinessNumber(digits) ? (
            <span className="font-bold text-brand">
              ✓ 올바른 사업자등록번호 형식입니다.
            </span>
          ) : (
            <span className="font-bold text-destructive">
              번호가 맞지 않습니다. 사업자등록증의 번호를 다시 확인해 주세요.
            </span>
          )
        }
        const others = sameNumberPartners ?? []
        return (
          <FormRow
            label="사업자등록번호"
            htmlFor={id}
            error={fieldState.error?.message}
            errorId={errorId}
          >
            <BusinessNumberInput
              id={id}
              ref={field.ref}
              name={field.name}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              aria-invalid={fieldState.invalid}
              // The check result, or (once saving found a problem) the error.
              aria-describedby={fieldState.invalid ? errorId : feedbackId}
              className="h-8 w-36 rounded-sm"
            />
            {!fieldState.invalid && (
              <p id={feedbackId} className="text-xs text-muted-foreground">
                {feedback}
              </p>
            )}
            {others.length > 0 && (
              <div
                role="status"
                className="w-full rounded-sm border border-destructive/40 bg-destructive/5 px-2.5 py-1.5 text-[13px]"
              >
                <p className="font-bold text-destructive">
                  같은 사업자등록번호를 쓰는 거래처가{" "}
                  {formatNumber(others.length, 0)}곳 있습니다. (저장은 할 수
                  있습니다)
                </p>
                <ul className="mt-1 max-h-28 list-disc overflow-y-auto pl-5">
                  {others.map((partner) => (
                    <li key={partner.id}>
                      <span className="tabular-nums">{partner.code}</span>{" "}
                      {partner.name}{" "}
                      <span className="text-muted-foreground">
                        ({partnerTypeLabel(partner.partnerType)}
                        {partner.isActive ? "" : " · 미사용"})
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </FormRow>
        )
      }}
    />
  )
}

/** Id of the 사업장 상세주소 box (focused after an address search). */
export const BUSINESS_ADDRESS_DETAIL_ID = partnerFieldId("addressDetail")

/**
 * 사업장 주소: 우편번호 + [주소 검색], 주소, 상세주소. The boxes can also be
 * typed in by hand (e.g. when the 주소 검색 cannot load).
 */
function BusinessAddressRow({
  form,
  errors,
  onSearchAddress,
}: {
  form: PartnerFormApi
  errors: PartnerErrors
  onSearchAddress: () => void
}) {
  const fields = ["postalCode", "address", "addressDetail"] as const
  const firstError = fields.find((name) => errors[name])
  const errorId = firstError ? partnerErrorId(firstError) : undefined
  const describedBy = (name: (typeof fields)[number]) =>
    errors[name] ? errorId : undefined
  return (
    <FormRow
      label="사업장 주소"
      error={firstError ? errors[firstError]?.message : undefined}
      errorId={errorId}
    >
      <div className="flex w-full flex-col gap-1.5 py-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <Input
            id={partnerFieldId("postalCode")}
            aria-label="사업장 우편번호"
            placeholder="우편번호"
            inputMode="numeric"
            autoComplete="off"
            maxLength={5}
            aria-invalid={Boolean(errors.postalCode)}
            aria-describedby={describedBy("postalCode")}
            className="h-8 w-24 rounded-sm tabular-nums"
            {...form.register("postalCode")}
          />
          <ActionButton size="sm" variant="secondary" onClick={onSearchAddress}>
            <SearchIcon aria-hidden="true" />
            주소 검색
          </ActionButton>
        </span>
        <Input
          id={partnerFieldId("address")}
          aria-label="사업장 주소"
          placeholder="주소 (주소 검색으로 채우거나 직접 입력)"
          autoComplete="off"
          maxLength={PARTNER_LIMITS.addressMaxLength}
          aria-invalid={Boolean(errors.address)}
          aria-describedby={describedBy("address")}
          className="h-8 w-full rounded-sm"
          {...form.register("address")}
        />
        <Input
          id={BUSINESS_ADDRESS_DETAIL_ID}
          aria-label="사업장 상세주소"
          placeholder="상세주소 (동·호수 등)"
          autoComplete="off"
          maxLength={PARTNER_LIMITS.addressDetailMaxLength}
          aria-invalid={Boolean(errors.addressDetail)}
          aria-describedby={describedBy("addressDetail")}
          className="h-8 w-full rounded-sm"
          {...form.register("addressDetail")}
        />
      </div>
    </FormRow>
  )
}

// ---------------------------------------------------------------------------
// 특이사항 tab
// ---------------------------------------------------------------------------

/** 특이사항: free text (up to 2,000 characters), with a counter. */
export function PartnerNoteFields({
  form,
  errors,
}: {
  form: PartnerFormApi
  errors: PartnerErrors
}) {
  const note = useWatch({ control: form.control, name: "note" })
  const id = partnerFieldId("note")
  const error = errors.note?.message
  return (
    <FormSection
      title="특이사항"
      description="배송·결제 등 거래할 때 알아야 할 내용을 적어 두세요."
      className="max-w-4xl"
    >
      <Textarea
        id={id}
        aria-label="특이사항"
        rows={12}
        maxLength={PARTNER_LIMITS.noteMaxLength}
        placeholder="예: 매주 월·목 오전 10시 전 납품, 뒷문 이용"
        aria-invalid={Boolean(error)}
        aria-describedby={error ? partnerErrorId("note") : `${id}-count`}
        className="min-h-60 w-full rounded-sm"
        {...form.register("note")}
      />
      <div className="flex items-start justify-between gap-2">
        {error ? (
          <p
            id={partnerErrorId("note")}
            className="text-xs font-bold text-destructive"
          >
            {error}
          </p>
        ) : (
          <span />
        )}
        <p
          id={`${id}-count`}
          className="text-xs text-muted-foreground tabular-nums"
        >
          {formatNumber(note.length, 0)} /{" "}
          {formatNumber(PARTNER_LIMITS.noteMaxLength, 0)}자
        </p>
      </div>
    </FormSection>
  )
}
