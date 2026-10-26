"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowRightIcon, LoaderCircleIcon, PlusIcon } from "lucide-react"
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
  type StockPlaceRef,
} from "@/components/inventory/lot-picker-dialog"
import {
  quantityText,
  quantityValue,
  StockQuantityInput,
} from "@/components/inventory/number-inputs"
import { findStockLocation } from "@/components/inventory/place-tree"
import type { StockNewDialogProps } from "@/components/inventory/stock-document-list-screen"
import { StockPlaceField } from "@/components/inventory/stock-place-field"
import { storageMismatchText } from "@/components/inventory/storage-fit"
import { useFocusAfterAppend } from "@/components/inventory/use-focus-after-append"
import { ScheduledBadge } from "@/components/inventory/scheduled-badge"
import { useInitialLotRows } from "@/components/inventory/use-initial-lot-rows"
import { useNewModalStillShown } from "@/components/inventory/use-new-modal-still-shown"
import { useStockPlaces } from "@/components/inventory/use-stock-places"
import { Input } from "@/components/ui/input"
import { useHotkeys } from "@/hooks/use-hotkeys"
import {
  createTransfer,
  previewTransferWarnings,
  type StockSaveResult,
  type StockWarning,
} from "@/lib/inventory/actions"
import {
  docDateLimitHint,
  formatStockQuantity,
  maxDocDate,
  STOCK_LIMITS,
} from "@/lib/inventory/constants"
import type { LotStockRow } from "@/lib/inventory/queries"
import {
  makeTransferFormSchema,
  todayInKorea,
  type TransferFormInput,
  type TransferFormValues,
  type TransferLineInput,
} from "@/lib/inventory/schema"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

const FORM_ID = "transfer-form"

const HEADER_FIELDS: [string, string][] = [
  ["docDate", "이동일"],
  ["memo", "메모"],
]

// In the order of the line table's columns.
const LINE_FIELDS: [string, string][] = [
  ["lotId", "로트"],
  ["fromLocationId", "보내는 위치"],
  ["quantity", "이동 수량"],
  ["toLocationId", "받는 위치"],
  ["memo", "메모"],
]

const LINE_COLUMN_COUNT = 10

function rowKey(lotId: string, locationId: string): string {
  return `${lotId}:${locationId}`
}

/**
 * The form values a save sends, as text: the 보관온도 check (and its
 * confirm) is valid only for exactly these values.
 */
function inputSnapshot(values: TransferFormInput): string {
  return JSON.stringify(values)
}

/** The 보관온도 warnings of the confirm, and the input they were made for. */
type TransferCheck = { warnings: StockWarning[]; input: TransferFormInput }

/**
 * 재고처간 이동등록 modal (?modal=new on /inventory/transfers; ?balances=…
 * adds the rows checked on 재고처별 재고현황).
 *
 * - 머리: 이동일 (default today, earlier allowed, later up to today + the
 *   재고 설정's days = 예정; the source gives what it has that day, the
 *   destination has it from that day), 받는 위치 (for new lines;
 *   [모든 줄에 적용]), 보내는 위치 (optional: the lot picker starts there),
 *   메모.
 * - 줄: [재고 추가] opens the lot picker. Each line: 보내는 위치 → 받는 위치
 *   (사용 위치 only; ⚠ when its 구역 has another 보관온도), 이동 수량
 *   (default: all of it), 메모.
 * - F8 = 저장: the database lists the 보관온도 mismatches first (asked
 *   before saving; red = the 구역 is too warm), then moves all lines or
 *   nothing. The form is locked while that check runs, and what is saved
 *   is exactly what was checked (changed meanwhile → asked again).
 * - 줄 and 상품 stay pinned on the left while the table scrolls sideways.
 */
export function TransferDialog({
  onClose,
  onSaved,
  initialBalanceIds,
  futureDocDays,
}: StockNewDialogProps) {
  const [requestId] = useState(() => newRequestId())
  const today = todayInKorea()
  const [schema] = useState(() => makeTransferFormSchema(futureDocDays))
  const places = useStockPlaces()
  const isStillShown = useNewModalStillShown()

  const [rows, setRows] = useState<ReadonlyMap<string, LotStockRow>>(
    () => new Map()
  )
  const [defaultToId, setDefaultToId] = useState<string | null>(null)
  const [sourcePlace, setSourcePlace] = useState<StockPlaceRef | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [warnings, setWarnings] = useState<TransferCheck | null>(null)
  const [isChecking, startChecking] = useTransition()
  const [isPending, startTransition] = useTransition()
  const submittingRef = useRef(false)

  const form = useForm<TransferFormInput, unknown, TransferFormValues>({
    resolver: zodResolver(schema),
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
  const docDate = useWatch({ control, name: "docDate" })
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
      form
        .getValues("lines")
        .map((line) => rowKey(line.lotId, line.fromLocationId))
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
    const count = form.getValues("lines").length
    const room = STOCK_LIMITS.linesMax - count
    append(
      fresh.slice(0, Math.max(room, 0)).map((row): TransferLineInput => ({
        lotId: row.lotId,
        fromLocationId: row.locationId,
        toLocationId:
          defaultToId && defaultToId !== row.locationId ? defaultToId : "",
        unit: row.productUnit,
        quantity: quantityText(row.quantity),
        memo: "",
      })),
      { shouldFocus: false }
    )
    // The 이동 수량 of the first new line (not a box of the last one).
    focusLine(`lines.${count}.quantity`)
  }

  const loadingInitial = useInitialLotRows(initialBalanceIds, addRows)

  function changeDefaultTo(locationId: string | null) {
    setDefaultToId(locationId)
    if (!locationId) return
    form.getValues("lines").forEach((line, index) => {
      if (!line.toLocationId && line.fromLocationId !== locationId) {
        form.setValue(`lines.${index}.toLocationId`, locationId, {
          shouldDirty: true,
          shouldValidate: form.formState.isSubmitted,
        })
      }
    })
  }

  function applyDefaultToAll() {
    if (!defaultToId) return
    let skipped = 0
    form.getValues("lines").forEach((line, index) => {
      if (line.fromLocationId === defaultToId) {
        skipped++
        return
      }
      form.setValue(`lines.${index}.toLocationId`, defaultToId, {
        shouldDirty: true,
        shouldValidate: form.formState.isSubmitted,
      })
    })
    toast.success(
      skipped > 0
        ? `받는 위치를 바꿨습니다. ${skipped}줄은 보내는 위치와 같아 그대로 두었습니다.`
        : "모든 줄의 받는 위치를 바꿨습니다."
    )
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

  /** 이동 수량 ≤ the stock shown; 받는 위치 must take new stock. */
  function checkLines(values: TransferFormInput): boolean {
    let ok = true
    values.lines.forEach((line, index) => {
      const row = rows.get(rowKey(line.lotId, line.fromLocationId))
      const quantity = quantityValue(line.quantity)
      if (row && quantity !== null && quantity > row.quantity) {
        ok = false
        form.setError(`lines.${index}.quantity`, {
          type: "client",
          message: `이동 수량이 현재 재고(${formatStockQuantity(row.quantity, row.productUnit)})보다 많습니다.`,
        })
      }
      if (places.tree && line.toLocationId) {
        const found = findStockLocation(places.tree, line.toLocationId)
        if (!found || !found.location.canReceive) {
          ok = false
          form.setError(`lines.${index}.toLocationId`, {
            type: "client",
            message: !found
              ? "받는 위치를 찾을 수 없습니다. 다시 골라 주세요."
              : "사용중지된 위치(또는 구역·창고)로는 옮길 수 없습니다. 다른 위치를 골라 주세요.",
          })
        }
      }
    })
    return ok
  }

  async function send(input: TransferFormInput) {
    let result: StockSaveResult
    try {
      result = await createTransfer(input)
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
      setWarnings(null)
      for (const [path, message] of Object.entries(result.fieldErrors)) {
        form.setError(path as FieldPath<TransferFormInput>, {
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

  /** Saves `input` (the values whose 보관온도 warnings were checked). */
  function sendNow(input: TransferFormInput) {
    if (submittingRef.current) return
    submittingRef.current = true
    startTransition(async () => {
      await send(input)
    })
  }

  function save() {
    if (submittingRef.current || isPending || isChecking) return
    void form.handleSubmit(
      () => {
        const input = form.getValues()
        if (!checkLines(input)) {
          toast.error(
            "입력한 내용을 확인해 주세요. 빨간 글씨로 표시된 항목이 있습니다."
          )
          setTimeout(focusFirstError, 0)
          return
        }
        // The database lists the 보관온도 mismatches (same rule as saving).
        startChecking(async () => {
          let found: StockWarning[]
          try {
            found = await previewTransferWarnings(
              input.lines.map((line) => ({
                lotId: line.lotId,
                toLocationId: line.toLocationId,
              }))
            )
          } catch (error) {
            unstable_rethrow(error)
            console.error(error)
            toast.error(
              "저장하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
            )
            return
          }
          if (inputSnapshot(form.getValues()) !== inputSnapshot(input)) {
            // Changed while the database was asked: check again.
            toast.error(
              "확인하는 사이에 내용이 바뀌었습니다. 다시 [저장 | F8]을 눌러 주세요."
            )
            return
          }
          if (found.length > 0) setWarnings({ warnings: found, input })
          else sendNow(input)
        })
      },
      () => {
        toast.error(
          "입력한 내용을 확인해 주세요. 빨간 글씨로 표시된 항목이 있습니다."
        )
        setTimeout(focusFirstError, 0)
      }
    )()
  }

  useHotkeys({
    F5: () => {},
    F8:
      warnings !== null
        ? undefined
        : () => {
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
      const row = rows.get(rowKey(line.lotId, line.fromLocationId))
      return row ? [row.balanceId] : []
    })
  )
  const busy = isPending || isChecking

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
      title="재고처간 이동등록"
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
            disabled={busy}
          >
            {busy && (
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
      >
        {/* Locked while the 보관온도 check and the save run, so what is
            saved is what was checked. */}
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
          <input type="hidden" {...register("requestId")} />
          <FormSection title="이동 정보">
            <div className="grid gap-x-5 gap-y-2 lg:grid-cols-2">
              <FormTable>
                <FormRow
                  label="이동일"
                  htmlFor={fieldDomId(FORM_ID, "docDate")}
                  required
                  error={errors.docDate?.message}
                  errorId={fieldErrorId(FORM_ID, "docDate")}
                  hint={docDateLimitHint(futureDocDays, today)}
                >
                  <Input
                    id={fieldDomId(FORM_ID, "docDate")}
                    type="date"
                    max={maxDocDate(futureDocDays, today)}
                    aria-required
                    aria-invalid={!!errors.docDate}
                    className="h-8 w-40 rounded-sm"
                    {...register("docDate")}
                  />
                  <ScheduledBadge
                    date={docDate}
                    today={today}
                    title="오늘 이후 날짜: 예정 이동으로 저장됩니다. 그 날짜에 보내는 위치에 남아 있는 재고만 옮길 수 있습니다."
                  />
                </FormRow>
                <FormRow
                  label="보내는 위치"
                  htmlFor={`${FORM_ID}-source`}
                  hint="재고 추가 때 이 위치부터 보여 줌"
                >
                  <StockPlaceField
                    id={`${FORM_ID}-source`}
                    value={sourcePlace?.id ?? null}
                    onChange={(place) =>
                      setSourcePlace(
                        place ? { level: place.level, id: place.id } : null
                      )
                    }
                    tree={places.tree}
                    treeStatus={places.status}
                    onReloadTree={places.reload}
                    reloading={places.reloading}
                    selectable="any"
                    purpose="filter"
                    placeholder="전체 위치"
                    clearable
                    clearLabel="전체 위치"
                    pickerTitle="보내는 위치 선택 (재고 찾기 조건)"
                    className="w-full max-w-sm"
                  />
                </FormRow>
              </FormTable>
              <FormTable>
                <FormRow
                  label="받는 위치"
                  htmlFor={`${FORM_ID}-default-to`}
                  hint="새 줄에 넣을 위치"
                >
                  <StockPlaceField
                    id={`${FORM_ID}-default-to`}
                    value={defaultToId}
                    onChange={(place) => changeDefaultTo(place?.id ?? null)}
                    tree={places.tree}
                    treeStatus={places.status}
                    onReloadTree={places.reload}
                    reloading={places.reloading}
                    selectable="location"
                    purpose="receive"
                    clearable
                    pickerTitle="받는 위치 선택"
                    className="w-full max-w-sm"
                  />
                  {defaultToId && fields.length > 0 && (
                    <ActionButton
                      variant="neutral"
                      size="sm"
                      onClick={applyDefaultToAll}
                    >
                      모든 줄에 적용
                    </ActionButton>
                  )}
                </FormRow>
                <FormRow
                  label="메모"
                  htmlFor={fieldDomId(FORM_ID, "memo")}
                  error={errors.memo?.message}
                  errorId={fieldErrorId(FORM_ID, "memo")}
                >
                  <Input
                    id={fieldDomId(FORM_ID, "memo")}
                    maxLength={STOCK_LIMITS.memoMaxLength}
                    placeholder="예: 냉장 B구역 정리"
                    aria-invalid={!!errors.memo}
                    className="h-8 rounded-sm"
                    {...register("memo")}
                  />
                </FormRow>
              </FormTable>
            </div>
          </FormSection>

          <FormSection
            title="옮길 재고"
            description="로트(기한)와 위치별로 한 줄씩입니다. 이동 수량은 기본으로 그 위치의 재고 전부입니다."
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
              aria-label="옮길 재고"
              containerClassName="max-h-[min(30rem,52dvh)]"
              // At least the sum of the column widths (see the 입고 table).
              className={fields.length > 0 ? "min-w-[95rem]" : undefined}
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
                  <DataGridHead className="w-48">보내는 위치</DataGridHead>
                  <DataGridHead className="w-24">현재 재고</DataGridHead>
                  <DataGridHead className="w-32">이동 수량</DataGridHead>
                  <DataGridHead className="w-72">받는 위치</DataGridHead>
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
                        <p>[재고 추가]로 옮길 로트를 고르세요.</p>
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
                    const row = rows.get(
                      rowKey(line.lotId, line.fromLocationId)
                    )
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
                          className={cn(
                            stickyLineCellClass,
                            "left-10 max-w-56"
                          )}
                        >
                          {row ? (
                            <span className="flex max-w-36 min-w-0 items-center gap-1 sm:max-w-52">
                              <span className="shrink-0 font-bold tabular-nums">
                                {row.productCode}
                              </span>
                              <span
                                className="truncate"
                                title={row.productName}
                              >
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
                          id={fieldDomId(
                            FORM_ID,
                            `lines.${index}.fromLocationId`
                          )}
                          className="max-w-64"
                        >
                          <span className="flex items-center gap-1">
                            <span
                              className="truncate"
                              title={row ? lotRowPlace(row) : undefined}
                            >
                              {row ? lotRowPlace(row) : "-"}
                            </span>
                            <ArrowRightIcon
                              aria-hidden="true"
                              className="ml-auto size-3.5 shrink-0 text-muted-foreground"
                            />
                          </span>
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
                                aria-label={`${lineLabel} 이동 수량`}
                                aria-required
                                aria-invalid={!!error("quantity")}
                                aria-describedby={describedBy("quantity")}
                                className={cellInputClass}
                              />
                            )}
                          />
                        </DataGridCell>
                        <DataGridCell
                          id={fieldDomId(
                            FORM_ID,
                            `lines.${index}.toLocationId`
                          )}
                          className="px-1 py-0.5"
                        >
                          <StockPlaceField
                            aria-label={`${lineLabel} 받는 위치`}
                            aria-describedby={describedBy("toLocationId")}
                            value={line.toLocationId || null}
                            onChange={(place) =>
                              form.setValue(
                                `lines.${index}.toLocationId`,
                                place?.id ?? "",
                                {
                                  shouldDirty: true,
                                  shouldValidate: form.formState.isSubmitted,
                                }
                              )
                            }
                            tree={places.tree}
                            treeStatus={places.status}
                            onReloadTree={places.reload}
                            reloading={places.reloading}
                            selectable="location"
                            purpose="receive"
                            productStorageType={row?.productStorageType ?? null}
                            invalid={!!error("toLocationId")}
                            size="sm"
                            pickerTitle={`${lineLabel} 받는 위치 선택`}
                          />
                        </DataGridCell>
                        <DataGridCell className="px-1 py-0.5">
                          <Input
                            id={fieldDomId(FORM_ID, `lines.${index}.memo`)}
                            maxLength={STOCK_LIMITS.memoMaxLength}
                            autoComplete="off"
                            aria-label={`${lineLabel} 메모`}
                            aria-invalid={!!error("memo")}
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
                {formatNumber(fields.length, 0)}줄 · 받는 위치의 ⚠는 상품
                보관온도와 다른 구역입니다(빨간색: 온도가 너무 높음).
              </p>
            )}
            <LineFormErrorList formId={FORM_ID} errors={formErrors} />
          </FormSection>
        </fieldset>
        {pickerOpen && (
          <LotPickerDialog
            title="옮길 재고 선택"
            initialPlace={sourcePlace}
            sort="location"
            addedBalanceIds={addedBalanceIds}
            onPick={addRows}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </form>

      {warnings && (
        <TransferWarningDialog
          warnings={warnings.warnings}
          pending={isPending}
          onCancel={() => setWarnings(null)}
          onConfirm={() => {
            setWarnings(null)
            if (
              inputSnapshot(form.getValues()) !== inputSnapshot(warnings.input)
            ) {
              // Not what was checked: check the current values again.
              save()
              return
            }
            sendNow(warnings.input)
          }}
        />
      )}
    </ErpDialog>
  )
}

/** Asks before moving lots into a 구역 of another 보관온도. */
function TransferWarningDialog({
  warnings,
  pending,
  onCancel,
  onConfirm,
}: {
  warnings: StockWarning[]
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const tooWarm = warnings.some((warning) => warning.tooWarm)
  useHotkeys({ F5: () => {}, F8: onConfirm })
  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title="보관온도 확인"
      size="md"
      footer={
        <>
          <ActionButton variant="secondary" size="lg" onClick={onCancel}>
            돌아가서 고치기
          </ActionButton>
          <ActionButton
            size="lg"
            keyHint="F8"
            disabled={pending}
            onClick={onConfirm}
          >
            그대로 저장
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        <p>
          상품의 보관온도와 다른 구역으로 옮기는 줄이{" "}
          <strong className="font-bold">{warnings.length}건</strong> 있습니다.
          {tooWarm && (
            <strong className="font-bold text-destructive">
              {" "}
              온도가 너무 높은 구역이 있습니다(빨간 줄). 상품이 상할 수
              있습니다.
            </strong>
          )}
        </p>
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto border border-grid-line p-2 text-[13px]">
          {warnings.map((warning, index) => (
            <li
              key={`${warning.line}-${warning.productId}-${index}`}
              className={
                warning.tooWarm ? "font-bold text-destructive" : undefined
              }
            >
              {warning.line}번째 줄 {warning.productCode} {warning.productName}
              {warning.lotNo ? ` (로트 ${warning.lotNo})` : ""}:{" "}
              {storageMismatchText(
                warning.productStorageType,
                warning.zoneStorageType,
                "둡니다"
              )}
              {warning.locationLabel && (
                <span className="text-muted-foreground">
                  {" "}
                  ({warning.locationLabel})
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-[13px] text-muted-foreground">
          그대로 저장하면 재고처별 재고현황과 대시보드에 ‘보관온도 불일치’로
          표시됩니다.
        </p>
      </div>
    </ErpDialog>
  )
}
