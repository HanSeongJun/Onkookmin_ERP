"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { LoaderCircleIcon, PlusIcon } from "lucide-react"
import { unstable_rethrow } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type FieldPath,
} from "react-hook-form"
import { toast } from "sonner"

import { ActionButton } from "@/components/erp/action-bar"
import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridEmpty,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { FormRow, FormSection, FormTable } from "@/components/erp/form-table"
import {
  enterMovesToNextField,
  isNestedDialogOpen,
  newRequestId,
  UNSAVED_STOCK_MESSAGE,
} from "@/components/inventory/dialog-helpers"
import { ExpiryText } from "@/components/inventory/expiry-badge"
import {
  fieldDomId,
  fieldErrorId,
  focusField,
  lineErrorMessage,
  LineFormErrorList,
  orderedFormErrors,
} from "@/components/inventory/line-form-errors"
import {
  cellInputClass,
  LineIconButton,
  stickyLineCellClass,
  stickyLineHeadClass,
} from "@/components/inventory/line-table-parts"
import {
  LotPickerDialog,
  lotRowPlace,
} from "@/components/inventory/lot-picker-dialog"
import {
  quantityText,
  quantityValue,
  StockQuantityInput,
} from "@/components/inventory/number-inputs"
import type { StockNewDialogProps } from "@/components/inventory/stock-document-list-screen"
import { useFocusAfterAppend } from "@/components/inventory/use-focus-after-append"
import { useInitialLotRows } from "@/components/inventory/use-initial-lot-rows"
import { useNewModalStillShown } from "@/components/inventory/use-new-modal-still-shown"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { createDisposal, type StockSaveResult } from "@/lib/inventory/actions"
import {
  DISPOSAL_REASONS,
  formatStockQuantity,
  STOCK_LIMITS,
  type DisposalReason,
} from "@/lib/inventory/constants"
import type { LotStockRow } from "@/lib/inventory/queries"
import {
  disposalFormSchema,
  todayInKorea,
  type DisposalFormInput,
  type DisposalFormValues,
  type DisposalLineInput,
} from "@/lib/inventory/schema"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

const FORM_ID = "disposal-form"

const HEADER_FIELDS: [string, string][] = [
  ["docDate", "폐기일"],
  ["memo", "메모"],
]

// In the order of the line table's columns.
const LINE_FIELDS: [string, string][] = [
  ["lotId", "로트"],
  ["locationId", "위치"],
  ["quantity", "폐기 수량"],
  ["reason", "사유"],
  ["memo", "메모"],
]

const LINE_COLUMN_COUNT = 11

const REASON_OPTIONS = DISPOSAL_REASONS.map(({ value, label }) => ({
  value,
  label,
}))

/** The key of a (lot, 위치) row of the form. */
function rowKey(lotId: string, locationId: string): string {
  return `${lotId}:${locationId}`
}

/**
 * 폐기 등록 modal (?modal=new on /inventory/disposals; ?balances=… adds the
 * rows checked on 재고처별 재고현황).
 *
 * - 머리: 폐기일 (default today, earlier allowed), 기본 사유 (for new
 *   lines; [모든 줄에 적용]), 메모.
 * - 줄: [재고 추가] opens the lot picker, showing 기한 경과·임박 stock
 *   first (any stock can be found with its filters). Each line is one lot
 *   at one 위치: 폐기 수량 (default: all of it), 사유 (기한 경과 / 파손 /
 *   품질 불량 / 기타 — 기타 needs a memo), 메모. Lots past their 기한
 *   start with 사유 ‘기한 경과’.
 * - F8 = 저장. The database checks the stock again (another 출고 may have
 *   taken it meanwhile) and saves all lines or nothing.
 */
export function DisposalDialog({
  onClose,
  onSaved,
  initialBalanceIds,
}: StockNewDialogProps) {
  const [requestId] = useState(() => newRequestId())
  const today = todayInKorea()
  const isStillShown = useNewModalStillShown()

  const [rows, setRows] = useState<ReadonlyMap<string, LotStockRow>>(
    () => new Map()
  )
  const [defaultReason, setDefaultReason] = useState<DisposalReason | "">("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const submittingRef = useRef(false)

  const form = useForm<DisposalFormInput, unknown, DisposalFormValues>({
    resolver: zodResolver(disposalFormSchema),
    defaultValues: { requestId, docDate: today, memo: "", lines: [] },
    shouldFocusError: false,
  })
  const {
    control,
    register,
    formState: { errors, isDirty },
  } = form
  const { fields, append, remove } = useFieldArray({ control, name: "lines" })
  const lines = useWatch({ control, name: "lines" })
  const focusLine = useFocusAfterAppend(FORM_ID, fields.length)

  useEffect(() => {
    if (!isDirty) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [isDirty])

  // ---- Lines ----------------------------------------------------------------

  function addRows(picked: LotStockRow[]) {
    const present = new Set(
      form.getValues("lines").map((line) => rowKey(line.lotId, line.locationId))
    )
    const fresh = picked.filter(
      (row) => !present.has(rowKey(row.lotId, row.locationId))
    )
    if (fresh.length === 0) return
    setRows((current) => {
      const next = new Map(current)
      for (const row of fresh) next.set(rowKey(row.lotId, row.locationId), row)
      return next
    })
    const room = STOCK_LIMITS.linesMax - form.getValues("lines").length
    const firstNew = form.getValues("lines").length
    append(
      fresh.slice(0, Math.max(room, 0)).map((row): DisposalLineInput => ({
        lotId: row.lotId,
        locationId: row.locationId,
        unit: row.productUnit,
        quantity: quantityText(row.quantity),
        reason: row.expiryStatus === "expired" ? "expired" : defaultReason,
        memo: "",
      })),
      { shouldFocus: false }
    )
    // The 폐기 수량 of the first new line (not a box of the last one).
    focusLine(`lines.${firstNew}.quantity`)
  }

  const loadingInitial = useInitialLotRows(initialBalanceIds, addRows)

  function applyReasonToAll() {
    if (!defaultReason) return
    form.getValues("lines").forEach((_, index) => {
      form.setValue(`lines.${index}.reason`, defaultReason, {
        shouldDirty: true,
        shouldValidate: form.formState.isSubmitted,
      })
    })
    toast.success("모든 줄의 사유를 바꿨습니다.")
  }

  // ---- Close and save -------------------------------------------------------

  function requestClose() {
    if (isPending) return
    if (isDirty && !window.confirm(UNSAVED_STOCK_MESSAGE)) return
    onClose()
  }

  function focusFirstError() {
    const first = orderedFormErrors(form.formState.errors, {
      headerFields: HEADER_FIELDS,
      listName: "lines",
      lineFields: LINE_FIELDS,
    })[0]
    if (!first) return
    if (first.path === "lines") {
      document.getElementById(`${FORM_ID}-add-lot`)?.focus()
    } else {
      focusField(FORM_ID, first.path)
    }
  }

  /** 폐기 수량 ≤ the stock shown (the database checks again). */
  function checkQuantities(values: DisposalFormInput): boolean {
    let ok = true
    values.lines.forEach((line, index) => {
      const row = rows.get(rowKey(line.lotId, line.locationId))
      const quantity = quantityValue(line.quantity)
      if (row && quantity !== null && quantity > row.quantity) {
        ok = false
        form.setError(`lines.${index}.quantity`, {
          type: "client",
          message: `폐기 수량이 현재 재고(${formatStockQuantity(row.quantity, row.productUnit)})보다 많습니다.`,
        })
      }
    })
    return ok
  }

  async function send(input: DisposalFormInput) {
    let result: StockSaveResult
    try {
      result = await createDisposal(input)
    } catch (error) {
      submittingRef.current = false
      unstable_rethrow(error)
      console.error(error)
      toast.error(
        "저장하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요. (다시 저장해도 전표가 두 번 생기지 않습니다.)"
      )
      return
    }
    submittingRef.current = false
    const stillShown = isStillShown()
    if (!result.ok) {
      if (!stillShown) {
        toast.error(result.message)
        return
      }
      for (const [path, message] of Object.entries(result.fieldErrors)) {
        form.setError(path as FieldPath<DisposalFormInput>, {
          type: "server",
          message,
        })
      }
      toast.error(result.message)
      setTimeout(focusFirstError, 0)
      return
    }
    if (stillShown) onSaved(result)
    else toast.success(result.message)
  }

  function save() {
    if (submittingRef.current || isPending) return
    submittingRef.current = true
    void form.handleSubmit(
      () => {
        const input = form.getValues()
        if (!checkQuantities(input)) {
          submittingRef.current = false
          toast.error(
            "입력한 내용을 확인해 주세요. 빨간 글씨로 표시된 항목이 있습니다."
          )
          setTimeout(focusFirstError, 0)
          return
        }
        startTransition(async () => {
          await send(input)
        })
      },
      () => {
        submittingRef.current = false
        toast.error(
          "입력한 내용을 확인해 주세요. 빨간 글씨로 표시된 항목이 있습니다."
        )
        setTimeout(focusFirstError, 0)
      }
    )()
  }

  useHotkeys({
    F5: () => {},
    F8: () => {
      if (!isNestedDialogOpen()) save()
    },
  })

  // ---- Screen ---------------------------------------------------------------

  const formErrors = orderedFormErrors(errors, {
    headerFields: HEADER_FIELDS,
    listName: "lines",
    lineFields: LINE_FIELDS,
  })
  const lineErrors = errors.lines
  const addedBalanceIds = new Set(
    lines.flatMap((line) => {
      const row = rows.get(rowKey(line.lotId, line.locationId))
      return row ? [row.balanceId] : []
    })
  )
  const amounts = lines.map((line) => {
    const row = rows.get(rowKey(line.lotId, line.locationId))
    const quantity = quantityValue(line.quantity)
    if (!row || quantity === null || row.effectiveUnitCostInclVat === null) {
      return null
    }
    return Math.round(quantity * row.effectiveUnitCostInclVat)
  })
  const totalAmount = amounts.reduce<number>(
    (sum, value) => sum + (value ?? 0),
    0
  )

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
      title="폐기 등록"
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
            disabled={isPending}
          >
            {isPending && (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            )}
            {isPending ? "저장 중…" : "저장"}
          </ActionButton>
        </>
      }
    >
      <form
        id={FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
        onKeyDown={enterMovesToNextField}
        className="flex flex-col gap-4"
      >
        <input type="hidden" {...register("requestId")} />
        <FormSection title="폐기 정보">
          <div className="grid gap-x-5 gap-y-2 lg:grid-cols-2">
            <FormTable>
              <FormRow
                label="폐기일"
                htmlFor={fieldDomId(FORM_ID, "docDate")}
                required
                error={errors.docDate?.message}
                errorId={fieldErrorId(FORM_ID, "docDate")}
                hint="오늘 이후는 안 됩니다"
              >
                <Input
                  id={fieldDomId(FORM_ID, "docDate")}
                  type="date"
                  max={today}
                  aria-required
                  aria-invalid={!!errors.docDate}
                  className="h-8 w-40 rounded-sm"
                  {...register("docDate")}
                />
              </FormRow>
              <FormRow label="기본 사유" htmlFor={`${FORM_ID}-default-reason`}>
                <ReasonSelect
                  id={`${FORM_ID}-default-reason`}
                  value={defaultReason}
                  onChange={setDefaultReason}
                  placeholder="새 줄의 사유 (선택)"
                  className="h-8 w-48 rounded-sm"
                />
                {defaultReason && fields.length > 0 && (
                  <ActionButton
                    variant="neutral"
                    size="sm"
                    onClick={applyReasonToAll}
                  >
                    모든 줄에 적용
                  </ActionButton>
                )}
              </FormRow>
            </FormTable>
            <FormTable>
              <FormRow
                label="메모"
                htmlFor={fieldDomId(FORM_ID, "memo")}
                error={errors.memo?.message}
                errorId={fieldErrorId(FORM_ID, "memo")}
              >
                <Input
                  id={fieldDomId(FORM_ID, "memo")}
                  maxLength={STOCK_LIMITS.memoMaxLength}
                  placeholder="예: 10월 정기 폐기, 폐기업체 ○○"
                  aria-invalid={!!errors.memo}
                  className="h-8 rounded-sm"
                  {...register("memo")}
                />
              </FormRow>
            </FormTable>
          </div>
        </FormSection>

        <FormSection
          title="폐기할 재고"
          description="로트(기한)와 위치별로 한 줄씩입니다. 폐기 수량은 기본으로 그 위치의 재고 전부입니다."
          actions={
            <ActionButton
              id={`${FORM_ID}-add-lot`}
              size="sm"
              onClick={() => setPickerOpen(true)}
            >
              <PlusIcon aria-hidden="true" />
              재고 추가
            </ActionButton>
          }
        >
          <DataGrid
            aria-label="폐기할 재고"
            containerClassName="max-h-[min(30rem,52dvh)]"
            // At least the sum of the column widths (see the 입고 table).
            className={fields.length > 0 ? "min-w-[92rem]" : undefined}
          >
            <DataGridHeader>
              <tr>
                <DataGridHead
                  className={cn(stickyLineHeadClass, "left-0 w-10")}
                >
                  줄
                </DataGridHead>
                <DataGridHead
                  className={cn(stickyLineHeadClass, "left-10 w-40 sm:w-56")}
                >
                  상품
                </DataGridHead>
                <DataGridHead className="w-32">로트번호</DataGridHead>
                <DataGridHead className="w-52">기한</DataGridHead>
                <DataGridHead className="w-48">위치</DataGridHead>
                <DataGridHead className="w-24">현재 재고</DataGridHead>
                <DataGridHead className="w-32">폐기 수량</DataGridHead>
                <DataGridHead className="w-32">사유</DataGridHead>
                <DataGridHead className="w-28">금액(포함)</DataGridHead>
                <DataGridHead className="min-w-40">메모</DataGridHead>
                <DataGridHead className="w-12">삭제</DataGridHead>
              </tr>
            </DataGridHeader>
            <DataGridBody>
              {fields.length === 0 ? (
                <DataGridEmpty colSpan={LINE_COLUMN_COUNT}>
                  {loadingInitial ? (
                    <span className="inline-flex items-center gap-1.5">
                      <LoaderCircleIcon
                        aria-hidden="true"
                        className="size-4 animate-spin"
                      />
                      고른 재고를 불러오는 중…
                    </span>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <p>
                        [재고 추가]로 폐기할 로트를 고르세요. 기한이 지났거나
                        임박한 재고가 먼저 보입니다.
                      </p>
                      <ActionButton onClick={() => setPickerOpen(true)}>
                        <PlusIcon aria-hidden="true" />
                        재고 추가
                      </ActionButton>
                    </div>
                  )}
                </DataGridEmpty>
              ) : (
                fields.map((field, index) => {
                  const line = lines[index] ?? field
                  const row = rows.get(rowKey(line.lotId, line.locationId))
                  const error = (name: string) =>
                    lineErrorMessage(lineErrors, index, name)
                  const describedBy = (name: string) =>
                    error(name)
                      ? fieldErrorId(FORM_ID, `lines.${index}.${name}`)
                      : undefined
                  const lineLabel = `${index + 1}번째 줄`
                  return (
                    <DataGridRow key={field.id}>
                      <DataGridCell
                        numeric
                        className={cn(stickyLineCellClass, "left-0")}
                      >
                        <span className="block w-6">{index + 1}</span>
                      </DataGridCell>
                      <DataGridCell
                        id={fieldDomId(FORM_ID, `lines.${index}.lotId`)}
                        className={cn(stickyLineCellClass, "left-10 max-w-56")}
                      >
                        {row ? (
                          <span className="flex max-w-36 min-w-0 items-center gap-1 sm:max-w-52">
                            <span className="shrink-0 font-bold tabular-nums">
                              {row.productCode}
                            </span>
                            <span className="truncate" title={row.productName}>
                              {row.productName}
                            </span>
                          </span>
                        ) : (
                          "-"
                        )}
                      </DataGridCell>
                      <DataGridCell className="tabular-nums">
                        {row?.lotNo ?? "-"}
                      </DataGridCell>
                      <DataGridCell>
                        {row && (
                          <ExpiryText
                            kind={row.expiryKind}
                            date={row.expiryDate}
                            daysLeft={row.daysLeft}
                            status={row.expiryStatus}
                          />
                        )}
                      </DataGridCell>
                      <DataGridCell
                        id={fieldDomId(FORM_ID, `lines.${index}.locationId`)}
                        className="max-w-48 truncate"
                        title={row ? lotRowPlace(row) : undefined}
                      >
                        {row ? lotRowPlace(row) : "-"}
                      </DataGridCell>
                      <DataGridCell numeric>
                        {row
                          ? formatStockQuantity(row.quantity, row.productUnit)
                          : "-"}
                      </DataGridCell>
                      <DataGridCell className="px-1 py-0.5">
                        <Controller
                          control={control}
                          name={`lines.${index}.quantity`}
                          render={({ field: input }) => (
                            <StockQuantityInput
                              id={fieldDomId(
                                FORM_ID,
                                `lines.${index}.quantity`
                              )}
                              ref={input.ref}
                              name={input.name}
                              value={input.value}
                              onChange={input.onChange}
                              onBlur={input.onBlur}
                              unit={row?.productUnit ?? line.unit}
                              aria-label={`${lineLabel} 폐기 수량`}
                              aria-required
                              aria-invalid={!!error("quantity")}
                              aria-describedby={describedBy("quantity")}
                              className={cellInputClass}
                            />
                          )}
                        />
                      </DataGridCell>
                      <DataGridCell className="px-1 py-0.5">
                        <Controller
                          control={control}
                          name={`lines.${index}.reason`}
                          render={({ field: input }) => (
                            <ReasonSelect
                              id={fieldDomId(FORM_ID, `lines.${index}.reason`)}
                              triggerRef={input.ref}
                              value={(input.value || "") as DisposalReason | ""}
                              onChange={input.onChange}
                              placeholder="사유 선택"
                              invalid={!!error("reason")}
                              ariaLabel={`${lineLabel} 폐기 사유`}
                              className="h-7 w-full rounded-sm text-[13px]"
                            />
                          )}
                        />
                      </DataGridCell>
                      <DataGridCell numeric>
                        {formatNumber(amounts[index], 0)}
                        {row?.costEstimated && amounts[index] !== null && (
                          <span
                            className="ml-0.5 text-muted-foreground"
                            title="입고 단가가 없어 기본 매입가로 계산했습니다."
                          >
                            *
                          </span>
                        )}
                      </DataGridCell>
                      <DataGridCell className="px-1 py-0.5">
                        <Input
                          id={fieldDomId(FORM_ID, `lines.${index}.memo`)}
                          maxLength={STOCK_LIMITS.memoMaxLength}
                          autoComplete="off"
                          placeholder={
                            line.reason === "other" ? "사유를 적어 주세요" : ""
                          }
                          aria-label={`${lineLabel} 메모${line.reason === "other" ? " (사유 기타: 필수)" : ""}`}
                          aria-invalid={!!error("memo")}
                          aria-describedby={describedBy("memo")}
                          className={cellInputClass}
                          {...register(`lines.${index}.memo`)}
                        />
                      </DataGridCell>
                      <DataGridCell align="center" className="px-0.5">
                        <LineIconButton
                          kind="remove"
                          label={`${lineLabel} 삭제`}
                          onClick={() => remove(index)}
                        />
                      </DataGridCell>
                    </DataGridRow>
                  )
                })
              )}
            </DataGridBody>
          </DataGrid>
          {fields.length > 0 && (
            <p className="text-right text-[13px]">
              {formatNumber(fields.length, 0)}줄 · 폐기 금액(부가세 포함){" "}
              <strong className="font-bold tabular-nums">
                {formatNumber(totalAmount, 0)}원
              </strong>
              <span className="ml-1 text-xs text-muted-foreground">
                (로트 입고 단가 기준, * = 기본 매입가로 추정)
              </span>
            </p>
          )}
          <LineFormErrorList formId={FORM_ID} errors={formErrors} />
        </FormSection>

        {pickerOpen && (
          <LotPickerDialog
            title="폐기할 재고 선택"
            description="기한 경과·임박 재고가 먼저 보입니다(기한 빠른 순). 다른 재고는 기한 조건을 ‘전체’로 바꿔 찾으세요. 여러 줄을 체크해 [선택 추가]를 누르세요."
            initialExpiry="attention"
            sort="expiry_date"
            addedBalanceIds={addedBalanceIds}
            onPick={addRows}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </form>
    </ErpDialog>
  )
}

/** 폐기 사유 select (기한 경과 / 파손 / 품질 불량 / 기타). */
function ReasonSelect({
  id,
  value,
  onChange,
  placeholder,
  invalid = false,
  ariaLabel,
  triggerRef,
  className,
}: {
  id: string
  value: DisposalReason | ""
  onChange: (value: DisposalReason) => void
  placeholder: string
  invalid?: boolean
  ariaLabel?: string
  triggerRef?: React.Ref<HTMLButtonElement>
  className?: string
}) {
  return (
    <Select
      items={REASON_OPTIONS}
      value={value || null}
      onValueChange={(next) => {
        if (next) onChange(next as DisposalReason)
      }}
    >
      <SelectTrigger
        id={id}
        ref={triggerRef}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        size="sm"
        className={className}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {REASON_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
