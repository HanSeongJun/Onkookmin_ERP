"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { LoaderCircleIcon, PlusIcon, SearchCheckIcon } from "lucide-react"
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
} from "@/components/inventory/line-table-parts"
import { StockQuantityInput } from "@/components/inventory/number-inputs"
import { placeFilterIds } from "@/components/inventory/place-tree"
import type { StockNewDialogProps } from "@/components/inventory/stock-document-list-screen"
import { StockPartnerField } from "@/components/inventory/stock-partner-field"
import { StockPlaceField } from "@/components/inventory/stock-place-field"
import {
  bundleCompositionLabel,
  ProductTypeBadge,
  StockProductPickerDialog,
} from "@/components/inventory/stock-product-picker-dialog"
import { useFocusAfterAppend } from "@/components/inventory/use-focus-after-append"
import { useNewModalStillShown } from "@/components/inventory/use-new-modal-still-shown"
import { useStockPlaces } from "@/components/inventory/use-stock-places"
import { Input } from "@/components/ui/input"
import { useHotkeys } from "@/hooks/use-hotkeys"
import {
  createIssue,
  previewIssue,
  type IssuePlan,
  type StockSaveResult,
} from "@/lib/inventory/actions"
import { formatStockQuantity, STOCK_LIMITS } from "@/lib/inventory/constants"
import type {
  StockPartnerOption,
  StockProductOption,
} from "@/lib/inventory/queries"
import {
  emptyIssueLineInput,
  issueFormSchema,
  todayInKorea,
  type IssueFormInput,
  type IssueFormValues,
} from "@/lib/inventory/schema"
import { EMPTY_VALUE, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

import { IssuePlanTable, shortageText } from "./issue-plan-table"

const FORM_ID = "issue-form"

const HEADER_FIELDS: [string, string][] = [
  ["docDate", "출고일"],
  ["partnerId", "거래처"],
  ["memo", "메모"],
]

const LINE_FIELDS: [string, string][] = [
  ["productId", "상품"],
  ["quantity", "수량"],
  ["warehouseId", "출고 위치"],
  ["zoneId", "출고 위치"],
  ["locationId", "출고 위치"],
  ["memo", "메모"],
]

const LINE_COLUMN_COUNT = 8

/** A preview (or the plan of the 출고 확정 confirm) and the form values it was made for. */
type PlanState = { snapshot: string; plan: IssuePlan }

const CHANGED_DURING_PLAN_MESSAGE =
  "배정을 계산하는 사이에 내용이 바뀌었습니다. 다시 [저장 | F8]을 눌러 주세요. (저장하지 않았습니다.)"

/** The parts of the form a FEFO plan depends on. */
function planSnapshot(values: IssueFormInput): string {
  return JSON.stringify({
    docDate: values.docDate,
    lines: values.lines.map((line) => [
      line.productId,
      line.quantity,
      line.warehouseId,
      line.zoneId,
      line.locationId,
    ]),
  })
}

/**
 * 출고 등록 modal (?modal=new on /inventory/issues): a manual 출고 that
 * uses the same FEFO allocation as the future 주문 module.
 *
 * - 머리: 출고일 (default today, earlier allowed), 거래처 (any 사용
 *   거래처, optional; a 매입처 for 반품), 메모.
 * - 줄: [상품 추가] (기준상품 and 묶음상품 — a 묶음상품 goes out as its
 *   구성상품), 수량, 출고 위치 (optional: only stock in that 창고 / 구역 /
 *   위치), 메모. The 현재 출고 가능 column is the stock now minus 기한 경과.
 * - [배정 미리보기 | F7] shows which lots and 위치 FEFO takes (기한 빠른
 *   로트부터, 기한 경과 제외) and where stock is short. [저장 | F8] makes
 *   the preview again and asks to confirm it; the database chooses the
 *   lots once more at the moment of saving (stock may have changed) and
 *   refuses the whole 전표 when any line lacks stock. The form is locked
 *   while that plan is made, and [출고 확정] sends exactly the values the
 *   confirmed plan was made for (changed meanwhile → nothing is sent; press
 *   저장 again).
 */
export function IssueDialog({
  onClose,
  onSaved,
  expiryWarningDays,
}: StockNewDialogProps) {
  const [requestId] = useState(() => newRequestId())
  const today = todayInKorea()
  const places = useStockPlaces()
  const isStillShown = useNewModalStillShown()

  const [products, setProducts] = useState<
    ReadonlyMap<string, StockProductOption>
  >(() => new Map())
  const [partner, setPartner] = useState<StockPartnerOption | null>(null)
  const [picker, setPicker] = useState<
    { mode: "add" } | { mode: "replace"; index: number } | null
  >(null)
  const [plan, setPlan] = useState<PlanState | null>(null)
  // The plan shown in the confirm dialog (저장), with the values it is for.
  const [confirmPlan, setConfirmPlan] = useState<PlanState | null>(null)
  const [isPlanning, startPlanning] = useTransition()
  // 저장's own plan: the form is locked meanwhile.
  const [isSavePlanning, startSavePlanning] = useTransition()
  const [isPending, startTransition] = useTransition()
  const submittingRef = useRef(false)

  const form = useForm<IssueFormInput, unknown, IssueFormValues>({
    resolver: zodResolver(issueFormSchema),
    defaultValues: {
      requestId,
      docDate: today,
      partnerId: "",
      memo: "",
      lines: [],
    },
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
  const currentSnapshot = planSnapshot({
    requestId,
    docDate,
    partnerId: "",
    memo: "",
    lines,
  })
  const planIsCurrent = plan !== null && plan.snapshot === currentSnapshot

  useEffect(() => {
    if (!isDirty) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [isDirty])

  // ---- Products -------------------------------------------------------------

  function pickProducts(picked: StockProductOption[]) {
    if (!picker) return
    setProducts((current) => {
      const next = new Map(current)
      for (const product of picked) next.set(product.id, product)
      return next
    })
    if (picker.mode === "replace") {
      const [product] = picked
      if (!product) return
      const options = {
        shouldDirty: true,
        shouldValidate: form.formState.isSubmitted,
      }
      form.setValue(`lines.${picker.index}.productId`, product.id, options)
      form.setValue(`lines.${picker.index}.unit`, product.unit, options)
      return
    }
    const room = STOCK_LIMITS.linesMax - fields.length
    append(
      picked.slice(0, Math.max(room, 0)).map((product) => ({
        ...emptyIssueLineInput(),
        productId: product.id,
        unit: product.unit,
      })),
      { shouldFocus: false }
    )
    focusLine(`lines.${fields.length}.quantity`)
  }

  // ---- Errors ---------------------------------------------------------------

  function focusFirstError() {
    const first = orderedFormErrors(form.formState.errors, {
      headerFields: HEADER_FIELDS,
      listName: "lines",
      lineFields: LINE_FIELDS,
    })[0]
    if (!first) return
    if (first.path === "lines") {
      document.getElementById(`${FORM_ID}-add-product`)?.focus()
      return
    }
    // The three filter ids share one box.
    const path = first.path.replace(/\.(warehouseId|zoneId)$/, ".locationId")
    focusField(FORM_ID, path)
  }

  function showServerErrors(fieldErrors: Record<string, string>) {
    for (const [path, message] of Object.entries(fieldErrors)) {
      form.setError(path as FieldPath<IssueFormInput>, {
        type: "server",
        message,
      })
    }
    setTimeout(focusFirstError, 0)
  }

  // ---- 배정 미리보기 ---------------------------------------------------------

  /**
   * Validates the form, then asks the database for the FEFO plan.
   * `then` gets the plan and the snapshot of the values it was made for.
   */
  function runPreview(
    then: (plan: IssuePlan, snapshot: string) => void,
    start: typeof startPlanning = startPlanning
  ) {
    void form.handleSubmit(
      () => {
        const input = form.getValues()
        const snapshot = planSnapshot(input)
        start(async () => {
          let result: Awaited<ReturnType<typeof previewIssue>>
          try {
            result = await previewIssue(input)
          } catch (error) {
            unstable_rethrow(error)
            console.error(error)
            toast.error(
              "배정을 미리 보지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
            )
            return
          }
          if (!result.ok) {
            toast.error(result.message)
            showServerErrors(result.fieldErrors)
            return
          }
          setPlan({ snapshot, plan: result.plan })
          then(result.plan, snapshot)
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

  function preview() {
    if (isPlanning || isSavePlanning || isPending) return
    runPreview((next) => {
      if (!next.ok) {
        toast.error("재고가 모자란 줄이 있습니다. 빨간 줄을 확인해 주세요.")
      }
      setTimeout(
        () =>
          document
            .getElementById(`${FORM_ID}-plan`)
            ?.scrollIntoView({ block: "nearest" }),
        0
      )
    })
  }

  // ---- Close and save -------------------------------------------------------

  function requestClose() {
    if (isPending) return
    if (isDirty && !window.confirm(UNSAVED_STOCK_MESSAGE)) return
    onClose()
  }

  /**
   * 저장: a fresh plan (the form is locked meanwhile), then the confirm
   * dialog — only when the form still holds the values it was made for.
   */
  function save() {
    if (isPlanning || isSavePlanning || isPending || submittingRef.current)
      return
    runPreview((next, snapshot) => {
      if (planSnapshot(form.getValues()) !== snapshot) {
        toast.error(CHANGED_DURING_PLAN_MESSAGE)
        return
      }
      setConfirmPlan({ snapshot, plan: next })
    }, startSavePlanning)
  }

  async function send(input: IssueFormInput) {
    let result: StockSaveResult
    try {
      result = await createIssue(input)
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
      setConfirmPlan(null)
      // The stock may have changed since the preview: show the new plan.
      setPlan(null)
      toast.error(result.message)
      showServerErrors(result.fieldErrors)
      return
    }
    if (stillShown) onSaved(result)
    else toast.success(result.message)
  }

  function confirmSave() {
    if (submittingRef.current || isPending || !confirmPlan) return
    const input = form.getValues()
    // Only the lines the confirmed plan was made for (the 메모 and 거래처
    // are not part of it and are sent as they are now).
    if (planSnapshot(input) !== confirmPlan.snapshot) {
      setConfirmPlan(null)
      setPlan(null)
      toast.error(CHANGED_DURING_PLAN_MESSAGE)
      return
    }
    submittingRef.current = true
    startTransition(async () => {
      await send(input)
    })
  }

  useHotkeys({
    F5: () => {},
    F7:
      confirmPlan !== null
        ? undefined
        : () => {
            if (!isNestedDialogOpen()) preview()
          },
    F8:
      confirmPlan !== null
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
  const productIds = new Set(lines.map((line) => line.productId))

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
      title="출고 등록"
      footer={
        <>
          <ActionButton variant="secondary" size="lg" onClick={requestClose}>
            취소
          </ActionButton>
          <ActionButton
            variant="neutral"
            size="lg"
            keyHint="F7"
            disabled={
              isPlanning || isSavePlanning || isPending || fields.length === 0
            }
            onClick={preview}
          >
            {isPlanning ? (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            ) : (
              <SearchCheckIcon aria-hidden="true" />
            )}
            배정 미리보기
          </ActionButton>
          <ActionButton
            type="submit"
            form={FORM_ID}
            size="lg"
            keyHint="F8"
            disabled={isPlanning || isSavePlanning || isPending}
          >
            {(isPending || isSavePlanning) && (
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
        {/* Locked while 저장 makes its plan and while saving, so the
            confirm shows exactly what is saved. */}
        <fieldset
          disabled={isSavePlanning || isPending}
          className="flex min-w-0 flex-col gap-4"
        >
          <input type="hidden" {...register("requestId")} />
          <FormSection title="출고 정보">
            <div className="grid gap-x-5 gap-y-2 lg:grid-cols-2">
              <FormTable>
                <FormRow
                  label="출고일"
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
                    aria-describedby={
                      errors.docDate
                        ? fieldErrorId(FORM_ID, "docDate")
                        : undefined
                    }
                    className="h-8 w-40 rounded-sm"
                    {...register("docDate")}
                  />
                </FormRow>
                <FormRow
                  label="거래처"
                  htmlFor={fieldDomId(FORM_ID, "partnerId")}
                  error={errors.partnerId?.message}
                  errorId={fieldErrorId(FORM_ID, "partnerId")}
                >
                  <StockPartnerField
                    id={fieldDomId(FORM_ID, "partnerId")}
                    kind="any"
                    value={partner}
                    invalid={!!errors.partnerId}
                    placeholder="선택 안 함"
                    onChange={(next) => {
                      setPartner(next)
                      form.setValue("partnerId", next?.id ?? "", {
                        shouldDirty: true,
                        shouldValidate: form.formState.isSubmitted,
                      })
                    }}
                  />
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
                    placeholder="예: 10/23 직배송, 반품"
                    aria-invalid={!!errors.memo}
                    className="h-8 rounded-sm"
                    {...register("memo")}
                  />
                </FormRow>
              </FormTable>
            </div>
          </FormSection>

          <FormSection
            title="출고 상품"
            description="로트는 직접 고르지 않습니다. 기한이 빠른 로트부터 자동으로 나갑니다(FEFO)."
            actions={
              <ActionButton
                id={`${FORM_ID}-add-product`}
                size="sm"
                onClick={() => setPicker({ mode: "add" })}
              >
                <PlusIcon aria-hidden="true" />
                상품 추가
              </ActionButton>
            }
          >
            <DataGrid
              aria-label="출고 상품"
              containerClassName="max-h-[min(26rem,45dvh)]"
              className={fields.length > 0 ? "min-w-[70rem]" : undefined}
            >
              <DataGridHeader>
                <tr>
                  <DataGridHead className="w-10">줄</DataGridHead>
                  <DataGridHead className="min-w-64">상품</DataGridHead>
                  <DataGridHead className="w-14">단위</DataGridHead>
                  <DataGridHead className="w-28">현재 출고 가능</DataGridHead>
                  <DataGridHead className="w-32">수량</DataGridHead>
                  <DataGridHead className="w-72">출고 위치 (선택)</DataGridHead>
                  <DataGridHead className="min-w-40">메모</DataGridHead>
                  <DataGridHead className="w-12">삭제</DataGridHead>
                </tr>
              </DataGridHeader>
              <DataGridBody>
                {fields.length === 0 ? (
                  <DataGridEmpty colSpan={LINE_COLUMN_COUNT}>
                    <div className="flex flex-col items-center gap-2">
                      <p>[상품 추가]로 출고할 상품을 고르세요.</p>
                      <ActionButton onClick={() => setPicker({ mode: "add" })}>
                        <PlusIcon aria-hidden="true" />
                        상품 추가
                      </ActionButton>
                    </div>
                  </DataGridEmpty>
                ) : (
                  fields.map((field, index) => {
                    const line = lines[index] ?? field
                    const product = products.get(line.productId)
                    const error = (name: string) =>
                      lineErrorMessage(lineErrors, index, name)
                    const placeError =
                      error("locationId") ??
                      error("zoneId") ??
                      error("warehouseId")
                    const describedBy = (name: string) =>
                      error(name)
                        ? fieldErrorId(FORM_ID, `lines.${index}.${name}`)
                        : undefined
                    const lineLabel = `${index + 1}번째 줄`
                    const placeId =
                      line.locationId || line.zoneId || line.warehouseId || null
                    const available = product?.availableQuantity ?? null
                    return (
                      <DataGridRow key={field.id}>
                        <DataGridCell numeric>{index + 1}</DataGridCell>
                        <DataGridCell className="px-1 py-0.5">
                          <button
                            id={fieldDomId(FORM_ID, `lines.${index}.productId`)}
                            type="button"
                            aria-haspopup="dialog"
                            aria-label={`${lineLabel} 상품: ${product ? `${product.code} ${product.name}` : "선택 안 됨"} (바꾸기)`}
                            aria-describedby={describedBy("productId")}
                            onClick={() =>
                              setPicker({ mode: "replace", index })
                            }
                            className={cn(
                              "flex h-7 w-full max-w-80 min-w-0 items-center gap-1.5 rounded-sm border border-transparent px-1 text-left text-[13px] outline-none hover:border-input focus-visible:ring-2 focus-visible:ring-ring",
                              error("productId") && "border-destructive"
                            )}
                          >
                            {product ? (
                              <>
                                <ProductTypeBadge type={product.productType} />
                                <span className="shrink-0 font-bold tabular-nums">
                                  {product.code}
                                </span>
                                <span className="truncate" title={product.name}>
                                  {product.name}
                                </span>
                                {product.productType === "bundle" && (
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    ({bundleCompositionLabel(product)})
                                  </span>
                                )}
                              </>
                            ) : (
                              <span className="text-muted-foreground">
                                상품 선택
                              </span>
                            )}
                          </button>
                        </DataGridCell>
                        <DataGridCell align="center">
                          {product?.unit ?? line.unit ?? ""}
                        </DataGridCell>
                        <DataGridCell
                          numeric
                          title={
                            product?.productType === "bundle"
                              ? "묶음상품은 [배정 미리보기]에서 구성상품별로 확인합니다."
                              : "지금 재고에서 기한이 지난 재고를 뺀 수량입니다."
                          }
                        >
                          {available === null
                            ? EMPTY_VALUE
                            : formatStockQuantity(available, "")}
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
                                unit={product?.unit ?? line.unit}
                                aria-label={`${lineLabel} 수량`}
                                aria-required
                                aria-invalid={!!error("quantity")}
                                aria-describedby={describedBy("quantity")}
                                className={cellInputClass}
                              />
                            )}
                          />
                        </DataGridCell>
                        <DataGridCell
                          id={fieldDomId(FORM_ID, `lines.${index}.locationId`)}
                          className="px-1 py-0.5"
                        >
                          <StockPlaceField
                            aria-label={`${lineLabel} 출고 위치`}
                            aria-describedby={
                              placeError
                                ? fieldErrorId(
                                    FORM_ID,
                                    `lines.${index}.locationId`
                                  )
                                : undefined
                            }
                            value={placeId}
                            onChange={(place) => {
                              const ids = placeFilterIds(place)
                              const options = {
                                shouldDirty: true,
                                shouldValidate: form.formState.isSubmitted,
                              }
                              form.setValue(
                                `lines.${index}.warehouseId`,
                                ids.warehouseId ?? "",
                                options
                              )
                              form.setValue(
                                `lines.${index}.zoneId`,
                                ids.zoneId ?? "",
                                options
                              )
                              form.setValue(
                                `lines.${index}.locationId`,
                                ids.locationId ?? "",
                                options
                              )
                            }}
                            tree={places.tree}
                            treeStatus={places.status}
                            onReloadTree={places.reload}
                            reloading={places.reloading}
                            selectable="any"
                            purpose="filter"
                            productStorageType={product?.storageType ?? null}
                            placeholder="전체 (기한 빠른 순)"
                            clearable
                            clearLabel="전체 위치"
                            invalid={!!placeError}
                            size="sm"
                            pickerTitle={`${lineLabel} 출고 위치 제한`}
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
            <LineFormErrorList formId={FORM_ID} errors={formErrors} />
          </FormSection>

          <section
            id={`${FORM_ID}-plan`}
            aria-label="배정 미리보기"
            className="flex flex-col gap-2"
          >
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="text-[15px] font-bold">배정 미리보기 (FEFO)</h3>
              {plan && !planIsCurrent && (
                <span className="text-xs font-bold text-destructive">
                  내용이 바뀌었습니다. [배정 미리보기 | F7]를 다시 눌러 주세요.
                </span>
              )}
              {plan && planIsCurrent && (
                <span
                  className={cn(
                    "text-xs font-bold",
                    plan.plan.ok ? "text-brand" : "text-destructive"
                  )}
                >
                  {plan.plan.ok
                    ? "모든 줄을 출고할 수 있습니다."
                    : "재고가 모자란 줄이 있습니다."}
                </span>
              )}
            </div>
            {plan ? (
              <div className={cn(!planIsCurrent && "opacity-50")}>
                <IssuePlanTable
                  plan={plan.plan}
                  expiryWarningDays={expiryWarningDays}
                />
              </div>
            ) : (
              <p className="border border-dashed border-input px-3 py-4 text-center text-[13px] text-muted-foreground">
                상품과 수량을 넣고 [배정 미리보기 | F7]를 누르면 어느
                로트·위치에서 나갈지 보여 줍니다. 기한이 지난 재고는 나가지
                않습니다.
              </p>
            )}
          </section>
        </fieldset>

        {picker && (
          <StockProductPickerDialog
            includeBundles
            includeInactiveWithStock
            title={
              picker.mode === "add"
                ? "출고할 상품 선택"
                : `${picker.index + 1}번째 줄 상품 바꾸기`
            }
            multiple={picker.mode === "add"}
            addedIds={productIds}
            onPick={pickProducts}
            onClose={() => setPicker(null)}
          />
        )}
      </form>

      {confirmPlan && (
        <IssueConfirmDialog
          plan={confirmPlan.plan}
          expiryWarningDays={expiryWarningDays}
          pending={isPending}
          onCancel={() => setConfirmPlan(null)}
          onConfirm={confirmSave}
        />
      )}
    </ErpDialog>
  )
}

/** 저장: shows the FEFO plan once more and asks for [출고 확정]. */
function IssueConfirmDialog({
  plan,
  expiryWarningDays,
  pending,
  onCancel,
  onConfirm,
}: {
  plan: IssuePlan
  expiryWarningDays: number
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useHotkeys({ F5: () => {}, F8: plan.ok ? onConfirm : undefined })
  const shortages = plan.lines.flatMap((line) =>
    line.demands
      .filter((demand) => demand.shortage > 0)
      .map((demand) => ({ line: line.line, demand }))
  )
  const lotCount = plan.lines.reduce(
    (sum, line) =>
      sum +
      line.demands.reduce(
        (count, demand) => count + demand.allocations.length,
        0
      ),
    0
  )
  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel()
      }}
      title={plan.ok ? "출고 확정" : "재고 부족"}
      size="lg"
      footer={
        <>
          <ActionButton
            variant="secondary"
            size="lg"
            disabled={pending}
            onClick={onCancel}
          >
            돌아가서 고치기
          </ActionButton>
          {plan.ok && (
            <ActionButton
              size="lg"
              keyHint="F8"
              disabled={pending}
              onClick={onConfirm}
            >
              {pending && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              출고 확정
            </ActionButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        {plan.ok ? (
          <p>
            아래 로트에서 출고합니다 (
            <strong className="font-bold">
              {formatNumber(plan.lines.length, 0)}줄 · 로트×위치{" "}
              {formatNumber(lotCount, 0)}건
            </strong>
            , 출고일 {plan.docDate}). 저장하는 순간 재고를 한 번 더 확인하므로,
            그 사이 다른 직원이 꺼낸 재고가 있으면 배정이 조금 달라질 수
            있습니다.
          </p>
        ) : (
          <div
            role="alert"
            className="flex flex-col gap-1 border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px] font-bold text-destructive"
          >
            <p>
              재고가 모자라 저장할 수 없습니다. 수량을 줄이거나 줄을 빼 주세요.
            </p>
            <ul className="flex flex-col gap-0.5">
              {shortages.map(({ line, demand }) => (
                <li key={`${line}-${demand.productId}`}>
                  {line}번째 줄 {demand.code} {demand.name}:{" "}
                  {shortageText(demand)}
                </li>
              ))}
            </ul>
          </div>
        )}
        <IssuePlanTable plan={plan} expiryWarningDays={expiryWarningDays} />
      </div>
    </ErpDialog>
  )
}
