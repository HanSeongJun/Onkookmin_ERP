"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { LoaderCircleIcon, SearchIcon, XIcon } from "lucide-react"
import { unstable_rethrow } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import {
  Controller,
  useForm,
  useWatch,
  type FieldErrors,
  type UseFormReturn,
} from "react-hook-form"
import { toast } from "sonner"

import { PhoneInput } from "@/app/(app)/partners/_components/formatted-input"
import {
  AddressSearchDialog,
  type AddressSearchResult,
} from "@/components/address-search-dialog"
import { ActionButton } from "@/components/erp/action-bar"
import { ErpDialog } from "@/components/erp/erp-dialog"
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
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useHotkeys } from "@/hooks/use-hotkeys"
import {
  checkEmployeeCode,
  createEmployee,
  loadEmployeeForEdit,
  suggestEmployeeCode,
  updateEmployee,
  type EmployeeActionResult,
} from "@/lib/employees/actions"
import type { EmployeeDetail } from "@/lib/employees/queries"
import {
  buildEmployeeModalHref,
  DRIVER_OPERATION_TYPES,
  EMPLOYEE_CODE_PATTERN,
  EMPLOYEE_CODE_TAKEN_MESSAGE,
  EMPLOYEE_LIMITS,
  EMPLOYMENT_TYPES,
  emptyEmployeeFormInput,
  employeeFormSchema,
  employeeToFormInput,
  parseEmployeeModal,
  todayInKorea,
  VEHICLE_TYPES,
  type EmployeeFieldErrors,
  type EmployeeFieldName,
  type EmployeeFormInput,
  type EmployeeFormValues,
  type EmployeeModalState,
} from "@/lib/employees/schema"
import { formatDateTime, formatNumber } from "@/lib/format"
import { isUuid } from "@/lib/products/schema"
import { cn } from "@/lib/utils"

const FORM_ID = "employee-form"

/** Fields in screen order (the first wrong one gets the focus). */
const FIELD_ORDER: EmployeeFieldName[] = [
  "isActive",
  "isSalesRep",
  "isDeliveryDriver",
  "code",
  "name",
  "hireDate",
  "mobile",
  "mobile2",
  "email",
  "phone",
  "postalCode",
  "address",
  "addressDetail",
  "note",
  "department",
  "jobTitle",
  "employmentType",
  "isSalaryPaid",
  "resignationDate",
  "driverOperationType",
  "vehicleNumber",
  "vehicleType",
]

/** Wait this long (ms) after the last key before checking the 직원코드. */
const CHECK_DELAY = 400

/** Earliest / latest date the date boxes offer (the form checks the same). */
const MIN_DATE = "1950-01-01"
const MAX_DATE = "2100-12-31"

const UNSAVED_CHANGES_MESSAGE =
  "저장하지 않은 내용은 사라집니다. 창을 닫을까요?"

// flex-1 + min-w-40: the box gives up some width so a short hint fits on the
// same line.
const inputClass = "h-8 min-w-40 flex-1 max-w-80 rounded-sm"

/** Value of the "선택 안 함" choice of a select box (the form keeps ""). */
const NONE = "__none__"

type EmployeeForm = UseFormReturn<
  EmployeeFormInput,
  unknown,
  EmployeeFormValues
>

/** What happens while the modal reads its data. */
type LoadState =
  | { status: "loading" }
  /** `employee`: the saved employee (직원 수정), or null (직원 등록). */
  | { status: "ready"; employee: EmployeeDetail | null }
  | { status: "missing" }
  | { status: "error" }

/** The answer of the 직원코드 check, for the code it was asked for. */
type CodeCheck = {
  code: string
  status: "available" | "taken" | "invalid" | "unknown"
}

/** Id of a form field's input, e.g. "employee-name". */
function fieldId(name: EmployeeFieldName): string {
  return `employee-${name}`
}

/** Id of a form field's error message. */
function errorId(name: EmployeeFieldName): string {
  return `employee-${name}-error`
}

/**
 * 직원 등록/수정 modal (the URL says which: ?modal=new or
 * ?modal=edit&id=…). One scrolling column of bordered [label | value]
 * tables, like the reference screen:
 * - top: 재직여부* (재직/퇴사), 담당업무 (영업담당 = 판매 플랫폼·영업
 *   담당자, 배송담당 = 직배송 기사);
 * - 기본정보: 직원코드*, 직원명*, 입사일*, 휴대폰번호1*, 휴대폰번호2,
 *   이메일, 전화번호, 주소 (주소 검색 = Daum/Kakao 우편번호 layer), 비고;
 * - 소속정보: 부서명, 직급/직책, 고용형태, 급여지급여부, 퇴사일 (only
 *   while 퇴사);
 * - 배송기사 정보 (only while 배송담당 is checked): 운영형태, 차량번호,
 *   차량 종류.
 *
 * - 직원 등록 starts with the next free 직원코드 (0001, 0002, …) and today
 *   as 입사일; both can be changed. A hint says whether the typed 직원코드
 *   is free (checked while typing); saving checks it again.
 * - The rules are checked in the browser and again on the server (same zod
 *   schema); the first wrong field gets the focus.
 * - F8 = 저장. Esc, × and [취소] close it, asking first when something was
 *   changed. F5 does nothing here (it must not reload and lose the form).
 * - 직원 수정 reads the employee when it opens. If someone else saves the
 *   employee meanwhile, saving is refused (the server compares updated_at).
 * - When the modal is gone before a save finishes (e.g. the browser's back
 *   button), the result is only shown as a message.
 *
 * Mount it with a `key` per modal address, so every modal starts fresh.
 */
export function EmployeeDialog({
  modal,
  onClose,
}: {
  modal: EmployeeModalState
  /** Closes the modal (the parent removes it from the URL). */
  onClose: () => void
}) {
  const employeeId = modal.mode === "edit" ? modal.id : null
  const isEdit = employeeId !== null

  const [isPending, startTransition] = useTransition()
  // Reading the employee (or the suggested 직원코드).
  const [, startLoad] = useTransition()
  // Background checks (직원코드).
  const [, startCheck] = useTransition()
  // Set while a save is being sent, so F8 or a double click cannot send the
  // form twice.
  const submittingRef = useRef(false)
  // False once this modal is gone. (Set again on mount: React may run
  // effects twice in development.) See isStillShown.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /**
   * Whether this modal is still the one the user is looking at. It may not
   * be after the browser's back button while a save was running. The address
   * is checked too: Next.js carries out a back navigation only after a
   * running Server Action has answered, so this dialog can still be on
   * screen although the address already moved on.
   */
  function isStillShown(): boolean {
    if (!mountedRef.current) return false
    const shown = parseEmployeeModal(
      new URLSearchParams(window.location.search)
    )
    return (
      buildEmployeeModalHref("", shown) === buildEmployeeModalHref("", modal)
    )
  }

  const [load, setLoad] = useState<LoadState>(
    employeeId !== null && !isUuid(employeeId)
      ? { status: "missing" }
      : { status: "loading" }
  )
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [codeCheck, setCodeCheck] = useState<CodeCheck | null>(null)
  const [addressOpen, setAddressOpen] = useState(false)

  const form: EmployeeForm = useForm<
    EmployeeFormInput,
    unknown,
    EmployeeFormValues
  >({
    resolver: zodResolver(employeeFormSchema),
    defaultValues: emptyEmployeeFormInput,
  })
  const {
    reset,
    register,
    formState: { errors, isDirty },
  } = form

  // 직원 수정: read the employee, then fill the form. 직원 등록: ask for the
  // next free 직원코드 and start with today as 입사일 (as the form's
  // starting values, so they don't count as changes). In a transition, so
  // a redirect from the server (e.g. to the login page when the session has
  // expired) is carried out by Next.js.
  useEffect(() => {
    if (employeeId !== null && !isUuid(employeeId)) return
    let ignore = false
    startLoad(async () => {
      try {
        if (employeeId === null) {
          const code = await suggestEmployeeCode()
          if (ignore) return
          reset({ ...emptyEmployeeFormInput, code, hireDate: todayInKorea() })
          setLoad({ status: "ready", employee: null })
          return
        }
        const employee = await loadEmployeeForEdit(employeeId)
        if (ignore) return
        if (!employee) {
          setLoad({ status: "missing" })
          return
        }
        reset(employeeToFormInput(employee))
        setLoad({ status: "ready", employee })
      } catch (error) {
        if (ignore) return
        unstable_rethrow(error)
        console.error(error)
        setLoad({ status: "error" })
      }
    })
    return () => {
      ignore = true
    }
  }, [employeeId, loadAttempt, reset])

  // Once the form is shown, start at 직원명 (unless the user already moved
  // the focus into the form).
  useEffect(() => {
    if (load.status !== "ready") return
    if (document.getElementById(FORM_ID)?.contains(document.activeElement)) {
      return
    }
    form.setFocus("name")
  }, [load.status, form])

  // Closing the tab or reloading the page with unsaved changes: the browser
  // asks first.
  useEffect(() => {
    if (!isDirty) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [isDirty])

  const employee = load.status === "ready" ? load.employee : null
  const canSave = load.status === "ready" && !isPending

  const isActive = useWatch({ control: form.control, name: "isActive" })
  const isSalesRep = useWatch({ control: form.control, name: "isSalesRep" })
  const isDeliveryDriver = useWatch({
    control: form.control,
    name: "isDeliveryDriver",
  })
  const hireDate = useWatch({ control: form.control, name: "hireDate" })

  // ---- 직원코드: is it free? ------------------------------------------------

  const codeValue = useWatch({ control: form.control, name: "code" }).trim()
  const savedCode = employee?.code ?? null
  const codeToCheck =
    load.status === "ready" &&
    EMPLOYEE_CODE_PATTERN.test(codeValue) &&
    (savedCode === null || codeValue.toLowerCase() !== savedCode.toLowerCase())
      ? codeValue
      : null
  useEffect(() => {
    if (codeToCheck === null) return
    const timer = window.setTimeout(() => {
      startCheck(async () => {
        try {
          const status = await checkEmployeeCode(codeToCheck, employeeId)
          setCodeCheck({ code: codeToCheck, status })
        } catch (error) {
          unstable_rethrow(error)
          console.error(error)
        }
      })
    }, CHECK_DELAY)
    return () => window.clearTimeout(timer)
  }, [codeToCheck, employeeId])

  let codeHint: React.ReactNode = "영문·숫자·-_. 30자 이내"
  if (codeToCheck !== null && codeCheck?.code === codeToCheck) {
    if (codeCheck.status === "available") {
      codeHint = (
        <span className="font-bold text-brand">사용할 수 있는 코드입니다.</span>
      )
    } else if (codeCheck.status === "taken") {
      codeHint = (
        <span className="font-bold text-destructive">
          {EMPLOYEE_CODE_TAKEN_MESSAGE}
        </span>
      )
    }
  }

  // ---- 주소 검색 ---------------------------------------------------------------

  function applyAddress(result: AddressSearchResult) {
    const options = {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    }
    form.setValue("postalCode", result.postalCode, options)
    form.setValue("address", result.address, options)
    // Type the 상세주소 next (after the search has closed and given the
    // focus back to its button).
    setTimeout(
      () => document.getElementById(fieldId("addressDetail"))?.focus(),
      0
    )
  }

  function clearAddress() {
    const options = {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    }
    form.setValue("postalCode", "", options)
    form.setValue("address", "", options)
    form.setValue("addressDetail", "", options)
  }

  // ---- Close and save ---------------------------------------------------------

  function requestClose() {
    if (isPending) return
    if (isDirty && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return
    onClose()
  }

  /** Focuses the first wrong field. */
  function focusError(
    fieldErrors: FieldErrors<EmployeeFormInput> | EmployeeFieldErrors
  ) {
    const first = FIELD_ORDER.find((field) => fieldErrors[field])
    if (first) form.setFocus(first)
  }

  /** Sends the form to the server and handles the answer. */
  async function send(input: EmployeeFormInput) {
    let result: EmployeeActionResult
    try {
      result =
        employee !== null
          ? await updateEmployee(employee.id, employee.updated_at, input)
          : await createEmployee(input)
    } catch (error) {
      submittingRef.current = false
      // A redirect from the server (e.g. to the login page when the
      // session has expired) is not an error: let Next.js carry it out.
      unstable_rethrow(error)
      console.error(error)
      toast.error(
        "저장하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
      )
      return
    }
    submittingRef.current = false

    const stillShown = isStillShown()

    if (!result.ok) {
      // The user left this modal meanwhile: only say what happened.
      if (!stillShown) {
        toast.error(result.message)
        return
      }
      const fieldErrors = Object.entries(result.fieldErrors) as [
        EmployeeFieldName,
        string,
      ][]
      for (const [field, message] of fieldErrors) {
        form.setError(field, { type: "server", message })
      }
      focusError(result.fieldErrors)
      toast.error(result.message)
      return
    }

    toast.success(isEdit ? "변경 내용을 저장했습니다." : "직원을 등록했습니다.")
    // Saved, but the user already left this modal (e.g. the browser's back
    // button): closing now would close what they went back to.
    if (stillShown) onClose()
  }

  function save() {
    if (!canSave || submittingRef.current) return
    submittingRef.current = true

    void form.handleSubmit(
      () => {
        // Send what the user typed: the server checks it again with the same
        // rules and never trusts the browser.
        const input = form.getValues()
        startTransition(async () => {
          await send(input)
        })
      },
      (fieldErrors) => {
        submittingRef.current = false
        focusError(fieldErrors)
        toast.error(
          "입력한 내용을 확인해 주세요. 빨간 글씨로 표시된 항목이 있습니다."
        )
      }
    )()
  }

  // F8 = 저장. F5 is caught so the browser does not reload and lose the form.
  useHotkeys({
    F5: () => {},
    F8: save,
  })

  // ---- Screen ---------------------------------------------------------------

  /** Props screen readers need on an input with a possible error. */
  function a11yProps(name: EmployeeFieldName) {
    const invalid = Boolean(errors[name])
    return {
      "aria-invalid": invalid,
      "aria-describedby": invalid ? errorId(name) : undefined,
    }
  }

  /** Error message and its id for a <FormRow>. */
  function rowError(name: EmployeeFieldName) {
    return { error: errors[name]?.message, errorId: errorId(name) }
  }

  const title = isEdit
    ? employee
      ? `직원 수정 - ${employee.name}`
      : "직원 수정"
    : "직원 등록"

  // Notes when a saved employee loses a 담당업무 or becomes 퇴사: the
  // partners that have them keep them.
  const salesCount = employee?.salesPartnerCount ?? 0
  const deliveryCount = employee?.deliveryPartnerCount ?? 0
  const dutyNotes: string[] = []
  if (employee?.is_sales_rep && !isSalesRep) {
    dutyNotes.push(
      salesCount > 0
        ? `영업담당을 해제해도 이 직원이 영업담당인 거래처 ${formatNumber(salesCount, 0)}곳은 그대로 남습니다. 다른 거래처의 영업담당으로는 새로 고를 수 없게 됩니다.`
        : "영업담당을 해제하면 거래처의 영업담당으로 고를 수 없게 됩니다."
    )
  }
  if (employee?.is_delivery_driver && !isDeliveryDriver) {
    dutyNotes.push(
      `${
        deliveryCount > 0
          ? `배송담당을 해제해도 이 직원이 배송담당인 거래처 ${formatNumber(deliveryCount, 0)}곳은 그대로 남습니다. 다른 거래처의 배송담당으로는 새로 고를 수 없게 됩니다.`
          : "배송담당을 해제하면 거래처의 배송담당으로 고를 수 없게 됩니다."
      } 배송기사 정보(운영형태·차량)는 저장할 때 지워집니다.`
    )
  }

  let statusHint: React.ReactNode
  if (!isActive) {
    statusHint =
      employee?.is_active && salesCount + deliveryCount > 0 ? (
        <span className="font-bold text-foreground">
          이 직원이 담당인 거래처(영업 {formatNumber(salesCount, 0)}곳 · 배송{" "}
          {formatNumber(deliveryCount, 0)}곳)는 담당이 그대로 남고, 다른
          거래처의 담당으로는 새로 고를 수 없게 됩니다.
        </span>
      ) : (
        "퇴사 직원은 거래처의 담당으로 새로 고를 수 없습니다"
      )
  }

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
      title={title}
      size="md"
      className="sm:max-w-2xl"
      footer={
        <>
          <ActionButton variant="secondary" size="lg" onClick={requestClose}>
            취소
          </ActionButton>
          <ActionButton
            type="submit"
            form={FORM_ID}
            size="lg"
            keyHint="F8"
            disabled={!canSave}
          >
            {isPending && (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            )}
            {isPending ? "저장 중…" : "저장"}
          </ActionButton>
        </>
      }
    >
      {load.status === "loading" ? (
        <FormLoading />
      ) : load.status === "missing" ? (
        <DialogMessage
          title="직원을 찾을 수 없습니다"
          description="주소가 잘못되었거나 등록되지 않은 직원입니다. 창을 닫고 목록에서 다시 선택해 주세요."
        />
      ) : load.status === "error" ? (
        <DialogMessage
          title={
            isEdit
              ? "직원 정보를 불러오지 못했습니다"
              : "직원 등록 창을 열지 못했습니다"
          }
          description="인터넷 연결을 확인한 뒤 다시 시도해 주세요."
        >
          <ActionButton
            variant="neutral"
            onClick={() => {
              setLoad({ status: "loading" })
              setLoadAttempt((attempt) => attempt + 1)
            }}
          >
            다시 시도
          </ActionButton>
        </DialogMessage>
      ) : (
        // noValidate: show our own Korean messages instead of the browser's
        // popups.
        <form
          id={FORM_ID}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
          className="flex flex-col gap-5"
        >
          {/* Top: 재직여부, 담당업무 */}
          <FormTable>
            <Controller
              control={form.control}
              name="isActive"
              render={({ field, fieldState }) => (
                <FormRow
                  label="재직여부"
                  required
                  hint={fieldState.error ? undefined : statusHint}
                  {...rowError("isActive")}
                >
                  <RadioGroup
                    aria-label="재직여부"
                    aria-required
                    aria-invalid={fieldState.invalid || undefined}
                    aria-describedby={
                      fieldState.invalid ? errorId("isActive") : undefined
                    }
                    value={field.value ? "true" : "false"}
                    onValueChange={(value) => field.onChange(value === "true")}
                    className="flex w-auto flex-wrap gap-x-4 gap-y-1"
                  >
                    <InlineRadio
                      id="employee-isActive-true"
                      value="true"
                      label="재직"
                      ref={field.value ? field.ref : undefined}
                    />
                    <InlineRadio
                      id="employee-isActive-false"
                      value="false"
                      label="퇴사"
                      ref={field.value ? undefined : field.ref}
                    />
                  </RadioGroup>
                </FormRow>
              )}
            />
            <FormRow
              label="담당업무"
              error={
                errors.isSalesRep?.message ?? errors.isDeliveryDriver?.message
              }
              errorId={errorId("isSalesRep")}
            >
              <div className="flex w-full flex-col gap-1 py-0.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <DutyCheckbox
                    form={form}
                    name="isSalesRep"
                    label="영업담당"
                  />
                  <DutyCheckbox
                    form={form}
                    name="isDeliveryDriver"
                    label="배송담당"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  영업담당 = 판매 플랫폼(쿠팡, 스마트스토어 등)·영업 담당자,
                  배송담당 = 거래처 주문을 직접 배송하는 기사. 체크한 담당으로만
                  거래처에 고를 수 있습니다.
                </p>
                {dutyNotes.map((note) => (
                  <p key={note} className="text-xs font-bold text-foreground">
                    {note}
                  </p>
                ))}
              </div>
            </FormRow>
          </FormTable>

          <FormSection
            title="기본정보"
            description={
              <>
                <span
                  aria-hidden="true"
                  className="mr-1 inline-block size-1.5 -translate-y-0.5 rounded-full bg-required"
                />
                표시가 있는 항목은 꼭 입력해 주세요.
              </>
            }
          >
            <FormTable>
              <FormRow
                label="직원코드"
                htmlFor={fieldId("code")}
                required
                hint={codeHint}
                {...rowError("code")}
              >
                <Input
                  id={fieldId("code")}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={EMPLOYEE_LIMITS.codeMaxLength}
                  placeholder="예: 0001"
                  title="영문·숫자·하이픈(-)·밑줄(_)·마침표(.)로 30자까지. 대소문자만 다른 코드는 같은 코드로 봅니다."
                  aria-required
                  className={cn(inputClass, "max-w-48 tabular-nums")}
                  {...a11yProps("code")}
                  {...register("code")}
                />
              </FormRow>
              <FormRow
                label="직원명"
                htmlFor={fieldId("name")}
                required
                hint={`${EMPLOYEE_LIMITS.nameMaxLength}자 이내`}
                {...rowError("name")}
              >
                <Input
                  id={fieldId("name")}
                  autoComplete="off"
                  maxLength={EMPLOYEE_LIMITS.nameMaxLength}
                  placeholder="예: 김영길, 쿠팡"
                  aria-required
                  className={inputClass}
                  {...a11yProps("name")}
                  {...register("name")}
                />
              </FormRow>
              <FormRow
                label="입사일"
                htmlFor={fieldId("hireDate")}
                required
                {...rowError("hireDate")}
              >
                <Input
                  id={fieldId("hireDate")}
                  type="date"
                  min={MIN_DATE}
                  max={MAX_DATE}
                  aria-required
                  className="h-8 w-40 rounded-sm tabular-nums"
                  {...a11yProps("hireDate")}
                  {...register("hireDate")}
                />
              </FormRow>
              <PhoneRow
                form={form}
                name="mobile"
                label="휴대폰번호1"
                required
                hint="숫자만 넣어도 됩니다"
              />
              <PhoneRow form={form} name="mobile2" label="휴대폰번호2" />
              <FormRow
                label="이메일"
                htmlFor={fieldId("email")}
                {...rowError("email")}
              >
                <Input
                  id={fieldId("email")}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={EMPLOYEE_LIMITS.emailMaxLength}
                  placeholder="name@example.com"
                  className={inputClass}
                  {...a11yProps("email")}
                  {...register("email")}
                />
              </FormRow>
              <PhoneRow
                form={form}
                name="phone"
                label="전화번호"
                placeholder="예: 02-123-4567"
              />
              <AddressRow
                form={form}
                onSearch={() => setAddressOpen(true)}
                onClear={clearAddress}
              />
              <FormRow
                label="비고"
                htmlFor={fieldId("note")}
                {...rowError("note")}
              >
                <Textarea
                  id={fieldId("note")}
                  rows={3}
                  maxLength={EMPLOYEE_LIMITS.noteMaxLength}
                  placeholder="예: 화·목 배송, 쿠팡 로켓배송 주문"
                  className="min-h-16 w-full rounded-sm"
                  {...a11yProps("note")}
                  {...register("note")}
                />
              </FormRow>
            </FormTable>
          </FormSection>

          <FormSection title="소속정보">
            <FormTable>
              <FormRow
                label="부서명"
                htmlFor={fieldId("department")}
                {...rowError("department")}
              >
                <Input
                  id={fieldId("department")}
                  autoComplete="off"
                  maxLength={EMPLOYEE_LIMITS.departmentMaxLength}
                  placeholder="예: 영업팀, 배송팀"
                  className={inputClass}
                  {...a11yProps("department")}
                  {...register("department")}
                />
              </FormRow>
              <FormRow
                label="직급/직책"
                htmlFor={fieldId("jobTitle")}
                {...rowError("jobTitle")}
              >
                <Input
                  id={fieldId("jobTitle")}
                  autoComplete="off"
                  maxLength={EMPLOYEE_LIMITS.jobTitleMaxLength}
                  placeholder="예: 차장, 팀장"
                  className={inputClass}
                  {...a11yProps("jobTitle")}
                  {...register("jobTitle")}
                />
              </FormRow>
              <ChoiceRow
                form={form}
                name="employmentType"
                label="고용형태"
                options={EMPLOYMENT_TYPES}
              />
              <Controller
                control={form.control}
                name="isSalaryPaid"
                render={({ field, fieldState }) => (
                  <FormRow label="급여지급여부" {...rowError("isSalaryPaid")}>
                    <RadioGroup
                      aria-label="급여지급여부"
                      aria-invalid={fieldState.invalid || undefined}
                      value={field.value ? "true" : "false"}
                      onValueChange={(value) =>
                        field.onChange(value === "true")
                      }
                      className="flex w-auto flex-wrap gap-x-4 gap-y-1"
                    >
                      <InlineRadio
                        id="employee-isSalaryPaid-true"
                        value="true"
                        label="Y (지급)"
                        ref={field.value ? field.ref : undefined}
                      />
                      <InlineRadio
                        id="employee-isSalaryPaid-false"
                        value="false"
                        label="N (미지급)"
                        ref={field.value ? undefined : field.ref}
                      />
                    </RadioGroup>
                  </FormRow>
                )}
              />
              {!isActive && (
                <FormRow
                  label="퇴사일"
                  htmlFor={fieldId("resignationDate")}
                  hint="비워 둘 수 있습니다"
                  {...rowError("resignationDate")}
                >
                  <Input
                    id={fieldId("resignationDate")}
                    type="date"
                    min={hireDate || MIN_DATE}
                    max={MAX_DATE}
                    className="h-8 w-40 rounded-sm tabular-nums"
                    {...a11yProps("resignationDate")}
                    {...register("resignationDate")}
                  />
                </FormRow>
              )}
            </FormTable>
          </FormSection>

          {isDeliveryDriver && (
            <FormSection
              title="배송기사 정보"
              description="배송담당(기사)의 차량 정보입니다."
            >
              <FormTable>
                <ChoiceRow
                  form={form}
                  name="driverOperationType"
                  label="운영형태"
                  options={DRIVER_OPERATION_TYPES}
                  hint="직영: 회사 차량 · 지입: 기사 본인 차량 · 용차: 그때그때 부르는 차량"
                />
                <FormRow
                  label="차량번호"
                  htmlFor={fieldId("vehicleNumber")}
                  {...rowError("vehicleNumber")}
                >
                  <Input
                    id={fieldId("vehicleNumber")}
                    autoComplete="off"
                    maxLength={EMPLOYEE_LIMITS.vehicleNumberMaxLength}
                    placeholder="예: 12가3456"
                    className={cn(inputClass, "max-w-48")}
                    {...a11yProps("vehicleNumber")}
                    {...register("vehicleNumber")}
                  />
                </FormRow>
                <ChoiceRow
                  form={form}
                  name="vehicleType"
                  label="차량 종류"
                  options={VEHICLE_TYPES}
                />
              </FormTable>
            </FormSection>
          )}

          {employee && (
            <FormSection title="등록 정보">
              <FormTable>
                <FormRow label="담당 거래처">
                  <span className="text-[13px] tabular-nums">
                    영업담당 {formatNumber(salesCount, 0)}곳 · 배송담당{" "}
                    {formatNumber(deliveryCount, 0)}곳
                    <span className="ml-1 text-xs text-muted-foreground">
                      (미사용 거래처 포함)
                    </span>
                  </span>
                </FormRow>
                <FormRow label="등록일">
                  <span className="text-[13px] tabular-nums">
                    {formatDateTime(employee.created_at)}
                  </span>
                </FormRow>
                <FormRow label="최종수정일">
                  <span className="text-[13px] tabular-nums">
                    {formatDateTime(employee.updated_at)}
                  </span>
                </FormRow>
              </FormTable>
            </FormSection>
          )}

          {/* Inside the 직원 dialog, so Esc closes only the search. */}
          {addressOpen && (
            <AddressSearchDialog
              query={form.getValues("address")}
              onSelect={applyAddress}
              onClose={() => setAddressOpen(false)}
            />
          )}
        </form>
      )}
    </ErpDialog>
  )
}

/** A 담당업무 check box (영업담당 / 배송담당). */
function DutyCheckbox({
  form,
  name,
  label,
}: {
  form: EmployeeForm
  name: "isSalesRep" | "isDeliveryDriver"
  label: string
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <label className="flex min-h-7 cursor-pointer items-center gap-1.5 text-[13px]">
          <Checkbox
            id={fieldId(name)}
            ref={field.ref}
            checked={field.value}
            onCheckedChange={(checked) => field.onChange(checked)}
            onBlur={field.onBlur}
          />
          {label}
        </label>
      )}
    />
  )
}

/** The phone fields: hyphens are put in while typing (010-1234-5678). */
function PhoneRow({
  form,
  name,
  label,
  required = false,
  hint,
  placeholder = "예: 010-1234-5678",
}: {
  form: EmployeeForm
  name: "mobile" | "mobile2" | "phone"
  label: string
  required?: boolean
  hint?: React.ReactNode
  placeholder?: string
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <FormRow
          label={label}
          htmlFor={fieldId(name)}
          required={required}
          hint={hint}
          error={fieldState.error?.message}
          errorId={errorId(name)}
        >
          <PhoneInput
            id={fieldId(name)}
            ref={field.ref}
            name={field.name}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            placeholder={placeholder}
            aria-required={required || undefined}
            aria-invalid={fieldState.invalid}
            aria-describedby={fieldState.invalid ? errorId(name) : undefined}
            className="h-8 w-44 rounded-sm"
          />
        </FormRow>
      )}
    />
  )
}

/**
 * 주소: 우편번호 + [주소 검색] [삭제], 주소, 상세주소. The boxes can also
 * be typed in by hand (e.g. when the 주소 검색 cannot load).
 */
function AddressRow({
  form,
  onSearch,
  onClear,
}: {
  form: EmployeeForm
  onSearch: () => void
  onClear: () => void
}) {
  const errors = form.formState.errors
  const fields = ["postalCode", "address", "addressDetail"] as const
  const firstError = fields.find((name) => errors[name])
  const describedBy = (name: (typeof fields)[number]) =>
    errors[name] && firstError ? errorId(firstError) : undefined
  return (
    <FormRow
      label="주소"
      error={firstError ? errors[firstError]?.message : undefined}
      errorId={firstError ? errorId(firstError) : undefined}
    >
      <div className="flex w-full flex-col gap-1.5 py-0.5">
        <span className="flex flex-wrap items-center gap-1.5">
          <Input
            id={fieldId("postalCode")}
            aria-label="우편번호"
            placeholder="우편번호"
            inputMode="numeric"
            autoComplete="off"
            maxLength={5}
            aria-invalid={Boolean(errors.postalCode)}
            aria-describedby={describedBy("postalCode")}
            className="h-8 w-24 rounded-sm tabular-nums"
            {...form.register("postalCode")}
          />
          <ActionButton size="sm" variant="secondary" onClick={onSearch}>
            <SearchIcon aria-hidden="true" />
            주소 검색
          </ActionButton>
          <ActionButton size="sm" variant="neutral" onClick={onClear}>
            <XIcon aria-hidden="true" />
            삭제
          </ActionButton>
        </span>
        <Input
          id={fieldId("address")}
          aria-label="주소"
          placeholder="주소 (주소 검색으로 채우거나 직접 입력)"
          autoComplete="off"
          maxLength={EMPLOYEE_LIMITS.addressMaxLength}
          aria-invalid={Boolean(errors.address)}
          aria-describedby={describedBy("address")}
          className="h-8 w-full rounded-sm"
          {...form.register("address")}
        />
        <Input
          id={fieldId("addressDetail")}
          aria-label="상세주소"
          placeholder="상세주소 (동·호수 등)"
          autoComplete="off"
          maxLength={EMPLOYEE_LIMITS.addressDetailMaxLength}
          aria-invalid={Boolean(errors.addressDetail)}
          aria-describedby={describedBy("addressDetail")}
          className="h-8 w-full rounded-sm"
          {...form.register("addressDetail")}
        />
      </div>
    </FormRow>
  )
}

/** A select box of a fixed list with "선택 안 함" (the form keeps ""). */
function ChoiceRow({
  form,
  name,
  label,
  options,
  hint,
}: {
  form: EmployeeForm
  name: "employmentType" | "driverOperationType" | "vehicleType"
  label: string
  options: readonly { value: string; label: string }[]
  hint?: React.ReactNode
}) {
  const items = [{ value: NONE, label: "선택 안 함" }, ...options]
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <FormRow
          label={label}
          htmlFor={fieldId(name)}
          hint={fieldState.error ? undefined : hint}
          error={fieldState.error?.message}
          errorId={errorId(name)}
        >
          <Select
            items={items}
            value={field.value === "" ? NONE : field.value}
            onValueChange={(next) => {
              const text = next === null || next === NONE ? "" : String(next)
              if (text !== field.value) field.onChange(text)
            }}
          >
            <SelectTrigger
              id={fieldId(name)}
              ref={field.ref}
              onBlur={field.onBlur}
              aria-invalid={fieldState.invalid || undefined}
              aria-describedby={fieldState.invalid ? errorId(name) : undefined}
              className="h-8 w-48 max-w-full rounded-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormRow>
      )}
    />
  )
}

/** A radio button with its label on the right, for one-line choices. */
function InlineRadio({
  id,
  value,
  label,
  ref,
}: {
  id: string
  value: string
  label: string
  ref?: React.Ref<HTMLSpanElement>
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-7 cursor-pointer items-center gap-1.5 text-[13px]"
    >
      <RadioGroupItem id={id} value={value} ref={ref} />
      {label}
    </label>
  )
}

/** Placeholder while the employee (or the next 직원코드) is read. */
function FormLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <span className="sr-only">직원 정보를 불러오는 중…</span>
      {[2, 6, 4].map((rowCount, index) => (
        <div key={index} className="flex flex-col gap-2">
          {index > 0 && <Skeleton className="h-5 w-20 rounded-sm" />}
          <div className="flex flex-col gap-px border border-grid-line">
            {Array.from({ length: rowCount }, (_, row) => (
              <Skeleton key={row} className="h-10 rounded-none" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** A message in the middle of the modal (not found, could not load). */
function DialogMessage({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 px-4 py-16 text-center"
    >
      <p className="text-base font-bold">{title}</p>
      <p className="text-[13px] text-muted-foreground">{description}</p>
      {children}
    </div>
  )
}
