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
import {
  fieldDomId,
  fieldErrorId,
  focusField,
  lineErrorMessage,
  LineFormErrorList,
  orderedFormErrors,
} from "@/components/inventory/line-form-errors"
import { ExpiryBadge } from "@/components/inventory/expiry-badge"
import {
  cellInputClass,
  LineIconButton,
  LineNoteRow,
  stickyLineCellClass,
  stickyLineHeadClass,
} from "@/components/inventory/line-table-parts"
import {
  StockAmountInput,
  StockQuantityInput,
} from "@/components/inventory/number-inputs"
import {
  findStockLocation,
  stockPlacePath,
} from "@/components/inventory/place-tree"
import type { StockNewDialogProps } from "@/components/inventory/stock-document-list-screen"
import { StockPartnerField } from "@/components/inventory/stock-partner-field"
import { StockPlaceField } from "@/components/inventory/stock-place-field"
import {
  ProductTypeBadge,
  StockProductPickerDialog,
} from "@/components/inventory/stock-product-picker-dialog"
import { ScheduledBadge } from "@/components/inventory/scheduled-badge"
import { storageMismatchText } from "@/components/inventory/storage-fit"
import { useFocusAfterAppend } from "@/components/inventory/use-focus-after-append"
import { useNewModalStillShown } from "@/components/inventory/use-new-modal-still-shown"
import { useStockPlaces } from "@/components/inventory/use-stock-places"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { useHotkeys } from "@/hooks/use-hotkeys"
import {
  createReceipt,
  loadProductTaxTypes,
  type StockSaveResult,
} from "@/lib/inventory/actions"
import {
  docDateLimitHint,
  EXPIRY_KINDS,
  expiryKindLabel,
  formatStockQuantity,
  maxDocDate,
  STOCK_LIMITS,
  storageFit,
  suggestExpiryDate,
  type ExpiryKind,
} from "@/lib/inventory/constants"
import type {
  StockPartnerOption,
  StockProductOption,
} from "@/lib/inventory/queries"
import {
  emptyReceiptLineInput,
  isCalendarDate,
  makeReceiptFormSchema,
  todayInKorea,
  type ReceiptFormInput,
  type ReceiptFormValues,
  type ReceiptLineInput,
} from "@/lib/inventory/schema"
import { daysUntil, EMPTY_VALUE, formatNumber } from "@/lib/format"
import type { StorageType, TaxType } from "@/lib/products/constants"
import { formatPriceInput } from "@/lib/products/schema"
import { cn } from "@/lib/utils"

import { receiptLineParts, type ReceiptLinePart } from "./receipt-lines"

const FORM_ID = "receipt-form"

const HEADER_FIELDS: [string, string][] = [
  ["docDate", "입고일"],
  ["partnerId", "매입처"],
  ["memo", "메모"],
]

// In the order of the line table's columns.
const LINE_FIELDS: [string, string][] = [
  ["productId", "상품"],
  ["quantity", "수량"],
  ["unitCostInclVat", "입고단가"],
  ["locationId", "위치"],
  ["manufacturedDate", "제조일자"],
  ["expiryKind", "기한 종류"],
  ["expiryDate", "기한일"],
  ["lotNo", "로트번호"],
  ["supplierLotNo", "공급처 로트"],
  ["origin", "원산지"],
  ["memo", "메모"],
]

/** Columns of the line table (for the note rows). */
const LINE_COLUMN_COUNT = 16

type PickerTarget = { mode: "add" } | { mode: "replace"; index: number }

/** A 보관온도 mismatch found before saving. */
type StorageWarning = {
  line: number
  productName: string
  productStorage: StorageType
  zoneStorage: StorageType
  place: string
  tooWarm: boolean
}

/** A lot whose 기한 is already past or near (기한 임박), found before saving. */
type ExpiryWarning = {
  line: number
  productName: string
  /** "소비기한" / "유통기한". */
  expiryLabel: string
  expiryDate: string
  daysLeft: number
  expired: boolean
}

/** What the confirm before saving asks about, and the input it was made for. */
type SaveWarnings = {
  storage: StorageWarning[]
  expiry: ExpiryWarning[]
  input: ReceiptFormInput
}

/**
 * The days left of the 기한 a 입고 line's lots get, counted from the 입고일
 * (`receivedDate`, the 전표 date; a 예정 입고 of tomorrow counts from
 * tomorrow): the earliest of its 기준상품 (a 묶음상품 may get one per
 * 구성상품), or null.
 */
function earliestExpiry(
  preview: ReturnType<typeof receiptLineParts> | null,
  receivedDate: string
): { date: string; daysLeft: number } | null {
  let earliest: { date: string; daysLeft: number } | null = null
  for (const part of preview?.parts ?? []) {
    if (!part.expiryDate) continue
    const daysLeft = daysUntil(part.expiryDate, receivedDate)
    if (daysLeft === null) continue
    if (!earliest || daysLeft < earliest.daysLeft) {
      earliest = { date: part.expiryDate, daysLeft }
    }
  }
  return earliest
}

const EXPIRY_KIND_OPTIONS = EXPIRY_KINDS.map(({ value, label }) => ({
  value,
  label,
}))

/**
 * 입고 등록 modal (?modal=new on /inventory/receipts).
 *
 * - 머리: 입고일 (default today; earlier dates allowed, later ones up to
 *   today + the 재고 설정's days = a 예정 입고, whose stock no 전표 dated
 *   before it can use), 매입처
 *   (매입처 / 매출·매입 거래처, optional), 기본 입고 위치 (filled into new
 *   lines), 메모.
 * - 줄: [상품 추가] opens the product picker (기준상품 and 묶음상품). Each
 *   line: 수량, 위치 (사용 위치 only), 제조일자, 기한 종류 (소비기한 /
 *   유통기한 / 없음), 기한일 (filled from 제조일자 + the product's 유통기한
 *   기준일수 when empty; editable), 로트번호 (empty = automatic), 입고단가
 *   (부가세 포함, default 기본 매입가) with the 부가세 별도 amount, 금액,
 *   공급처 로트, 원산지, 메모. A 묶음상품 line shows how it becomes 기준상품
 *   lots (quantity × 구성 수량, its share of the 단가, each 기한).
 * - 보관온도: a 구역 of another 보관온도 is marked on the line; saving asks
 *   first (red when the 구역 is too warm).
 * - 기한: the 기한일 shows its D-day badge (기한 경과 red, 기한 임박 amber,
 *   counted from the 입고일); saving asks first when a lot is already past
 *   its 기한 on the 입고일 or near it (it is saved anyway when confirmed —
 *   e.g. 반품 or a typo the user wants to keep).
 * - Columns: 줄 and 상품 stay pinned on the left; 수량 and 입고단가 come
 *   right after them, the rarely used 공급처 로트 / 원산지 / 메모 last.
 * - F8 = 저장; Enter moves to the next box. The database checks everything
 *   again and saves all lines or nothing.
 */
export function ReceiptDialog({
  onClose,
  onSaved,
  expiryWarningDays,
  futureDocDays,
}: StockNewDialogProps) {
  const [requestId] = useState(() => newRequestId())
  const today = todayInKorea()
  const [schema] = useState(() => makeReceiptFormSchema(futureDocDays))
  const places = useStockPlaces()
  const isStillShown = useNewModalStillShown()

  const [products, setProducts] = useState<
    ReadonlyMap<string, StockProductOption>
  >(() => new Map())
  const [taxTypes, setTaxTypes] = useState<Readonly<Record<string, TaxType>>>(
    {}
  )
  const [, startTaxLoad] = useTransition()
  // The 기한일 each line got automatically (by field id), to update it when
  // the 제조일자 changes — but never over a date the user typed.
  const [autoExpiry, setAutoExpiry] = useState<
    Readonly<Record<string, string>>
  >({})
  const [partner, setPartner] = useState<StockPartnerOption | null>(null)
  const [defaultLocationId, setDefaultLocationId] = useState<string | null>(
    null
  )
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [warnings, setWarnings] = useState<SaveWarnings | null>(null)
  const [isPending, startTransition] = useTransition()
  const submittingRef = useRef(false)

  const form = useForm<ReceiptFormInput, unknown, ReceiptFormValues>({
    resolver: zodResolver(schema),
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
  const { fields, append, insert, remove } = useFieldArray({
    control,
    name: "lines",
  })
  const lines = useWatch({ control, name: "lines" })
  const docDate = useWatch({ control, name: "docDate" })
  // The 입고일 the D-day badges count from (today while the box is empty).
  const receivedDate = isCalendarDate(docDate) ? docDate : today
  const focusLine = useFocusAfterAppend(FORM_ID, fields.length)

  // Closing the tab or reloading with unsaved lines: the browser asks first.
  useEffect(() => {
    if (!isDirty) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [isDirty])

  // ---- Products -------------------------------------------------------------

  /** Remembers picked products and reads the 과세구분 of their 기준상품. */
  function rememberProducts(picked: StockProductOption[]) {
    setProducts((current) => {
      const next = new Map(current)
      for (const product of picked) next.set(product.id, product)
      return next
    })
    const ids = picked.flatMap((product) =>
      product.productType === "base"
        ? [product.id]
        : product.components.map((component) => component.productId)
    )
    const missing = ids.filter((id) => !(id in taxTypes))
    if (missing.length === 0) return
    startTaxLoad(async () => {
      try {
        const loaded = await loadProductTaxTypes(missing)
        setTaxTypes((current) => ({ ...current, ...loaded }))
      } catch (error) {
        unstable_rethrow(error)
        // Only the 부가세 별도 preview needs it: show "-" instead.
        console.error(error)
      }
    })
  }

  function lineFromProduct(
    product: StockProductOption,
    base: ReceiptLineInput = emptyReceiptLineInput()
  ): ReceiptLineInput {
    return {
      ...base,
      productId: product.id,
      unit: product.unit,
      locationId: base.locationId || defaultLocationId || "",
      unitCostInclVat: formatPriceInput(product.purchasePriceInclVat),
    }
  }

  function pickProducts(picked: StockProductOption[]) {
    if (!picker) return
    rememberProducts(picked)
    if (picker.mode === "replace") {
      const [product] = picked
      if (!product) return
      // setValue (not update): the line keeps its row and field id.
      const index = picker.index
      const next = lineFromProduct(product, form.getValues(`lines.${index}`))
      const options = {
        shouldDirty: true,
        shouldValidate: form.formState.isSubmitted,
      }
      form.setValue(`lines.${index}.productId`, next.productId, options)
      form.setValue(`lines.${index}.unit`, next.unit, options)
      form.setValue(`lines.${index}.locationId`, next.locationId, options)
      form.setValue(
        `lines.${index}.unitCostInclVat`,
        next.unitCostInclVat,
        options
      )
      const id = fields[index]?.id
      if (id) refreshAutoExpiry(id, index, next, product)
      return
    }
    const room = STOCK_LIMITS.linesMax - fields.length
    if (picked.length > room) {
      toast.error(
        `전표 하나에 ${formatNumber(STOCK_LIMITS.linesMax, 0)}줄까지 넣을 수 있습니다.`
      )
    }
    append(
      picked
        .slice(0, Math.max(room, 0))
        .map((product) => lineFromProduct(product)),
      { shouldFocus: false }
    )
    // Start with the 수량 of the first new line.
    focusLine(`lines.${fields.length}.quantity`)
  }

  // ---- 기한일 from 제조일자 -------------------------------------------------

  /**
   * After a change of 제조일자 / 기한 종류 / 상품 of a 기준상품 line: fills
   * the 기한일 with 제조일자 + (N − 1) days when it is empty or was filled
   * automatically before. 묶음상품 lines keep the 기한일 empty (each
   * 기준상품 gets its own, see the line's note) unless the user types one.
   */
  function refreshAutoExpiry(
    fieldId: string,
    index: number,
    line: ReceiptLineInput,
    product: StockProductOption | undefined = products.get(line.productId)
  ) {
    const previousAuto = autoExpiry[fieldId]
    const current = line.expiryDate
    const wasAuto = current === "" || current === previousAuto
    if (!wasAuto) return
    const suggestion =
      product?.productType === "base" && line.expiryKind !== "none"
        ? suggestExpiryDate(line.manufacturedDate, product.shelfLifeDays)
        : null
    const next = suggestion ?? ""
    if (next !== current) {
      form.setValue(`lines.${index}.expiryDate`, next, {
        shouldDirty: true,
        shouldValidate: form.formState.isSubmitted,
      })
    }
    setAutoExpiry((currentAuto) => {
      const updated = { ...currentAuto }
      if (suggestion) updated[fieldId] = suggestion
      else delete updated[fieldId]
      return updated
    })
  }

  // ---- 기본 입고 위치 ---------------------------------------------------------

  function changeDefaultLocation(locationId: string | null) {
    setDefaultLocationId(locationId)
    if (!locationId) return
    // Lines without a 위치 get it right away.
    form.getValues("lines").forEach((line, index) => {
      if (!line.locationId) {
        form.setValue(`lines.${index}.locationId`, locationId, {
          shouldDirty: true,
          shouldValidate: form.formState.isSubmitted,
        })
      }
    })
  }

  function applyDefaultLocationToAll() {
    if (!defaultLocationId) return
    form.getValues("lines").forEach((_, index) => {
      form.setValue(`lines.${index}.locationId`, defaultLocationId, {
        shouldDirty: true,
        shouldValidate: form.formState.isSubmitted,
      })
    })
    toast.success("모든 줄의 위치를 기본 입고 위치로 바꿨습니다.")
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
      document.getElementById(`${FORM_ID}-add-product`)?.focus()
    } else {
      focusField(FORM_ID, first.path)
    }
  }

  /** Checks the browser can do before sending (the database checks again). */
  function checkLines(values: ReceiptFormInput): boolean {
    let ok = true
    values.lines.forEach((line, index) => {
      const product = products.get(line.productId)
      if (!product) return
      if (line.expiryKind !== "none" && !line.expiryDate) {
        const missing = receiptLineParts(product, line, taxTypes).parts.filter(
          (part) => part.expiryDate === null
        )
        if (missing.length > 0) {
          ok = false
          form.setError(`lines.${index}.expiryDate`, {
            type: "client",
            message: line.manufacturedDate
              ? `${missing.map((part) => part.name).join(", ")}의 유통기한 기준일수가 없어 기한일을 계산할 수 없습니다. 기한일을 입력해 주세요.`
              : "기한일을 입력하거나, 제조일자를 넣어 자동으로 계산해 주세요. (기한이 없는 상품은 기한 종류 ‘없음’)",
          })
        }
      }
      if (places.tree && line.locationId) {
        const found = findStockLocation(places.tree, line.locationId)
        if (!found) {
          ok = false
          form.setError(`lines.${index}.locationId`, {
            type: "client",
            message: "위치를 찾을 수 없습니다. 위치를 다시 골라 주세요.",
          })
        } else if (!found.location.canReceive) {
          ok = false
          form.setError(`lines.${index}.locationId`, {
            type: "client",
            message:
              "사용중지된 위치(또는 구역·창고)에는 입고할 수 없습니다. 다른 위치를 골라 주세요.",
          })
        }
      }
    })
    return ok
  }

  function storageWarnings(values: ReceiptFormInput): StorageWarning[] {
    if (!places.tree) return []
    const found: StorageWarning[] = []
    values.lines.forEach((line, index) => {
      const product = products.get(line.productId)
      const location = findStockLocation(places.tree!, line.locationId)
      if (!product || !location) return
      for (const part of receiptLineParts(product, line, taxTypes).parts) {
        if (!part.storageType) continue
        const fit = storageFit(part.storageType, location.zone.storageType)
        if (!fit.mismatch) continue
        found.push({
          line: index + 1,
          productName: part.name,
          productStorage: part.storageType,
          zoneStorage: location.zone.storageType,
          place: stockPlacePath(location),
          tooWarm: fit.tooWarm,
        })
      }
    })
    return found
  }

  /**
   * Lots whose 기한 is past or within the 기한 임박 기준일, counted from the
   * 입고일 (the 전표 date: a 예정 입고 of tomorrow from tomorrow).
   */
  function expiryWarnings(values: ReceiptFormInput): ExpiryWarning[] {
    const found: ExpiryWarning[] = []
    const receivedDate = isCalendarDate(values.docDate) ? values.docDate : today
    values.lines.forEach((line, index) => {
      const product = products.get(line.productId)
      if (!product || line.expiryKind === "none") return
      for (const part of receiptLineParts(product, line, taxTypes).parts) {
        if (!part.expiryDate) continue
        const daysLeft = daysUntil(part.expiryDate, receivedDate)
        if (daysLeft === null || daysLeft > expiryWarningDays) continue
        found.push({
          line: index + 1,
          productName: part.name,
          expiryLabel: expiryKindLabel(line.expiryKind as ExpiryKind),
          expiryDate: part.expiryDate,
          daysLeft,
          expired: daysLeft < 0,
        })
      }
    })
    return found
  }

  async function send(input: ReceiptFormInput) {
    let result: StockSaveResult
    try {
      result = await createReceipt(input)
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
        form.setError(path as FieldPath<ReceiptFormInput>, {
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

  function sendNow(input: ReceiptFormInput) {
    submittingRef.current = true
    startTransition(async () => {
      await send(input)
    })
  }

  function save() {
    if (submittingRef.current || isPending) return
    submittingRef.current = true
    void form.handleSubmit(
      () => {
        submittingRef.current = false
        const input = form.getValues()
        if (!checkLines(input)) {
          toast.error(
            "입력한 내용을 확인해 주세요. 빨간 글씨로 표시된 항목이 있습니다."
          )
          setTimeout(focusFirstError, 0)
          return
        }
        const storage = storageWarnings(input)
        const expiry = expiryWarnings(input)
        if (storage.length > 0 || expiry.length > 0) {
          setWarnings({ storage, expiry, input })
          return
        }
        sendNow(input)
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
  const productIds = new Set(lines.map((line) => line.productId))
  const previews = lines.map((line) => {
    const product = products.get(line.productId)
    return product ? receiptLineParts(product, line, taxTypes) : null
  })
  const totalIncl = previews.reduce(
    (sum, preview) => sum + (preview?.amountInclVat ?? 0),
    0
  )
  const totalExcl = previews.every(
    (preview) =>
      !preview ||
      preview.amountInclVat === null ||
      preview.amountExclVat !== null
  )
    ? previews.reduce((sum, preview) => sum + (preview?.amountExclVat ?? 0), 0)
    : null
  const unknownCost = previews.some(
    (preview) => preview !== null && preview.amountInclVat === null
  )

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
      title="입고 등록"
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
        <FormSection title="입고 정보">
          <div className="grid gap-x-5 gap-y-2 lg:grid-cols-2">
            <FormTable>
              <FormRow
                label="입고일"
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
                  aria-describedby={
                    errors.docDate
                      ? fieldErrorId(FORM_ID, "docDate")
                      : undefined
                  }
                  className="h-8 w-40 rounded-sm"
                  {...register("docDate")}
                />
                <ScheduledBadge
                  date={docDate}
                  today={today}
                  title="오늘 이후 날짜: 예정 입고로 저장됩니다. 이 재고는 그 날짜부터 출고·이동할 수 있습니다."
                />
              </FormRow>
              <FormRow
                label="매입처"
                htmlFor={fieldDomId(FORM_ID, "partnerId")}
                error={errors.partnerId?.message}
                errorId={fieldErrorId(FORM_ID, "partnerId")}
              >
                <StockPartnerField
                  id={fieldDomId(FORM_ID, "partnerId")}
                  kind="supplier"
                  value={partner}
                  invalid={!!errors.partnerId}
                  aria-describedby={
                    errors.partnerId
                      ? fieldErrorId(FORM_ID, "partnerId")
                      : undefined
                  }
                  placeholder="선택 안 함 (매입처 없이 입고)"
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
                label="기본 입고 위치"
                htmlFor={`${FORM_ID}-default-location`}
                hint="새 줄에 넣을 위치"
              >
                <StockPlaceField
                  id={`${FORM_ID}-default-location`}
                  value={defaultLocationId}
                  onChange={(place) => changeDefaultLocation(place?.id ?? null)}
                  tree={places.tree}
                  treeStatus={places.status}
                  onReloadTree={places.reload}
                  reloading={places.reloading}
                  selectable="location"
                  purpose="receive"
                  clearable
                  pickerTitle="기본 입고 위치 선택"
                  className="w-full max-w-sm"
                />
                {defaultLocationId && fields.length > 0 && (
                  <ActionButton
                    variant="neutral"
                    size="sm"
                    onClick={applyDefaultLocationToAll}
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
                  placeholder="예: 10/23 오전 냉동차 입고"
                  aria-invalid={!!errors.memo}
                  className="h-8 rounded-sm"
                  {...register("memo")}
                />
              </FormRow>
            </FormTable>
          </div>
        </FormSection>

        <FormSection
          title="입고 상품"
          description="같은 상품도 기한이 다르면 줄을 나눠 넣어 주세요(줄마다 로트가 하나씩 생깁니다)."
          actions={
            <ActionButton
              id={`${FORM_ID}-add-product`}
              size="sm"
              aria-describedby={
                errors.lines?.message || errors.lines?.root?.message
                  ? fieldErrorId(FORM_ID, "lines")
                  : undefined
              }
              onClick={() => setPicker({ mode: "add" })}
            >
              <PlusIcon aria-hidden="true" />
              상품 추가
            </ActionButton>
          }
        >
          <DataGrid
            aria-label="입고 상품"
            containerClassName="max-h-[min(34rem,58dvh)]"
            // At least the sum of the column widths: the columns keep their
            // widths (the pinned 줄 must stay 2.5rem for 상품's offset).
            className={fields.length > 0 ? "min-w-[130rem]" : undefined}
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
                <DataGridHead className="w-28">수량</DataGridHead>
                <DataGridHead className="w-28">입고단가(포함)</DataGridHead>
                <DataGridHead className="w-20">단가(별도)</DataGridHead>
                <DataGridHead className="w-56">위치</DataGridHead>
                <DataGridHead className="w-36">제조일자</DataGridHead>
                <DataGridHead className="w-24">기한 종류</DataGridHead>
                <DataGridHead
                  className="w-52"
                  title="D-day는 입고일부터 셉니다."
                >
                  기한일
                </DataGridHead>
                <DataGridHead className="w-32">로트번호</DataGridHead>
                <DataGridHead className="w-28">금액(포함)</DataGridHead>
                <DataGridHead className="w-28">금액(별도)</DataGridHead>
                <DataGridHead className="w-32">공급처 로트</DataGridHead>
                <DataGridHead className="w-28">원산지</DataGridHead>
                <DataGridHead className="min-w-40">메모</DataGridHead>
                <DataGridHead className="w-20">관리</DataGridHead>
              </tr>
            </DataGridHeader>
            <DataGridBody>
              {fields.length === 0 ? (
                <DataGridEmpty colSpan={LINE_COLUMN_COUNT}>
                  <div className="flex flex-col items-center gap-2">
                    <p>[상품 추가]로 입고할 상품을 고르세요.</p>
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
                  const preview = previews[index]
                  const location = places.tree
                    ? findStockLocation(places.tree, line.locationId)
                    : null
                  const error = (name: string) =>
                    lineErrorMessage(lineErrors, index, name)
                  const describedBy = (name: string) =>
                    error(name)
                      ? fieldErrorId(FORM_ID, `lines.${index}.${name}`)
                      : undefined
                  const isAuto =
                    !!line.expiryDate &&
                    autoExpiry[field.id] === line.expiryDate
                  const lineLabel = `${index + 1}번째 줄`
                  const expiry =
                    line.expiryKind === "none"
                      ? null
                      : earliestExpiry(preview, receivedDate)
                  return (
                    <ReceiptLineRows
                      key={field.id}
                      index={index}
                      product={product}
                      preview={preview}
                      location={location ? stockPlacePath(location) : null}
                      zoneStorage={location?.zone.storageType ?? null}
                      line={line}
                      isAutoExpiry={isAuto}
                    >
                      <DataGridCell
                        numeric
                        className={cn(stickyLineCellClass, "left-0")}
                      >
                        <span className="block w-6">{index + 1}</span>
                      </DataGridCell>
                      <DataGridCell
                        className={cn(
                          stickyLineCellClass,
                          "left-10 px-1 py-0.5"
                        )}
                      >
                        <button
                          id={fieldDomId(FORM_ID, `lines.${index}.productId`)}
                          type="button"
                          aria-haspopup="dialog"
                          aria-label={`${lineLabel} 상품: ${product ? `${product.code} ${product.name}` : "선택 안 됨"} (바꾸기)`}
                          aria-describedby={describedBy("productId")}
                          onClick={() => setPicker({ mode: "replace", index })}
                          className={cn(
                            "flex h-7 w-full max-w-38 min-w-0 items-center gap-1.5 rounded-sm border border-transparent px-1 text-left text-[13px] outline-none hover:border-input focus-visible:ring-2 focus-visible:ring-ring sm:max-w-54",
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
                            </>
                          ) : (
                            <span className="text-muted-foreground">
                              상품 선택
                            </span>
                          )}
                        </button>
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
                              unit={line.unit || product?.unit}
                              aria-label={`${lineLabel} 수량`}
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
                          name={`lines.${index}.unitCostInclVat`}
                          render={({ field: input }) => (
                            <StockAmountInput
                              id={fieldDomId(
                                FORM_ID,
                                `lines.${index}.unitCostInclVat`
                              )}
                              ref={input.ref}
                              name={input.name}
                              value={input.value}
                              onChange={input.onChange}
                              onBlur={input.onBlur}
                              placeholder="모름"
                              aria-label={`${lineLabel} 입고단가 (부가세 포함${product?.productType === "bundle" ? ", 묶음상품 1개당" : ""})`}
                              aria-invalid={!!error("unitCostInclVat")}
                              aria-describedby={describedBy("unitCostInclVat")}
                              className={cellInputClass}
                            />
                          )}
                        />
                      </DataGridCell>
                      <DataGridCell numeric className="text-muted-foreground">
                        {formatNumber(preview?.unitCostExclVat ?? null, 0)}
                      </DataGridCell>
                      <DataGridCell
                        id={fieldDomId(FORM_ID, `lines.${index}.locationId`)}
                        className="px-1 py-0.5"
                      >
                        <StockPlaceField
                          aria-label={`${lineLabel} 위치`}
                          aria-describedby={describedBy("locationId")}
                          value={line.locationId || null}
                          onChange={(place) =>
                            form.setValue(
                              `lines.${index}.locationId`,
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
                          productStorageType={product?.storageType ?? null}
                          invalid={!!error("locationId")}
                          size="sm"
                          pickerTitle={`${lineLabel} 입고 위치 선택`}
                        />
                      </DataGridCell>
                      <DataGridCell className="px-1 py-0.5">
                        <Input
                          id={fieldDomId(
                            FORM_ID,
                            `lines.${index}.manufacturedDate`
                          )}
                          type="date"
                          max={docDate || today}
                          aria-label={`${lineLabel} 제조일자`}
                          aria-invalid={!!error("manufacturedDate")}
                          aria-describedby={describedBy("manufacturedDate")}
                          className={cellInputClass}
                          {...register(`lines.${index}.manufacturedDate`, {
                            onChange: () =>
                              refreshAutoExpiry(
                                field.id,
                                index,
                                form.getValues(`lines.${index}`)
                              ),
                          })}
                        />
                      </DataGridCell>
                      <DataGridCell className="px-1 py-0.5">
                        <Controller
                          control={control}
                          name={`lines.${index}.expiryKind`}
                          render={({ field: input }) => (
                            <Select
                              items={EXPIRY_KIND_OPTIONS}
                              value={input.value}
                              onValueChange={(next) => {
                                if (!next || next === input.value) return
                                input.onChange(next)
                                if (next === "none") {
                                  form.setValue(
                                    `lines.${index}.expiryDate`,
                                    "",
                                    {
                                      shouldDirty: true,
                                    }
                                  )
                                }
                                refreshAutoExpiry(field.id, index, {
                                  ...form.getValues(`lines.${index}`),
                                  expiryKind: next,
                                })
                              }}
                            >
                              <SelectTrigger
                                id={fieldDomId(
                                  FORM_ID,
                                  `lines.${index}.expiryKind`
                                )}
                                ref={input.ref}
                                aria-label={`${lineLabel} 기한 종류`}
                                aria-invalid={!!error("expiryKind")}
                                size="sm"
                                className="h-7 w-full rounded-sm text-[13px]"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {EXPIRY_KIND_OPTIONS.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </DataGridCell>
                      <DataGridCell className="px-1 py-0.5">
                        <span className="flex items-center gap-1">
                          <Input
                            id={fieldDomId(
                              FORM_ID,
                              `lines.${index}.expiryDate`
                            )}
                            type="date"
                            disabled={line.expiryKind === "none"}
                            aria-label={`${lineLabel} 기한일`}
                            aria-invalid={!!error("expiryDate")}
                            aria-describedby={describedBy("expiryDate")}
                            className={cellInputClass}
                            {...register(`lines.${index}.expiryDate`)}
                          />
                          {expiry && (
                            <ExpiryBadge
                              daysLeft={expiry.daysLeft}
                              warningDays={expiryWarningDays}
                              className="min-w-10 shrink-0"
                            />
                          )}
                          {isAuto && (
                            <span
                              className="shrink-0 text-[11px] text-muted-foreground"
                              title={`제조일자 + 유통기한 기준일수 ${product?.shelfLifeDays ?? ""}일로 계산했습니다 (제조일이 1일째). 고칠 수 있습니다.`}
                            >
                              자동
                            </span>
                          )}
                        </span>
                      </DataGridCell>
                      <DataGridCell className="px-1 py-0.5">
                        <Input
                          id={fieldDomId(FORM_ID, `lines.${index}.lotNo`)}
                          maxLength={STOCK_LIMITS.lotNoMaxLength}
                          placeholder="자동"
                          autoComplete="off"
                          aria-label={`${lineLabel} 로트번호 (비우면 자동)`}
                          aria-invalid={!!error("lotNo")}
                          aria-describedby={describedBy("lotNo")}
                          className={cellInputClass}
                          {...register(`lines.${index}.lotNo`)}
                        />
                      </DataGridCell>
                      <DataGridCell numeric>
                        {formatNumber(preview?.amountInclVat ?? null, 0)}
                      </DataGridCell>
                      <DataGridCell numeric className="text-muted-foreground">
                        {formatNumber(preview?.amountExclVat ?? null, 0)}
                      </DataGridCell>
                      <DataGridCell className="px-1 py-0.5">
                        <Input
                          id={fieldDomId(
                            FORM_ID,
                            `lines.${index}.supplierLotNo`
                          )}
                          maxLength={STOCK_LIMITS.supplierLotNoMaxLength}
                          autoComplete="off"
                          aria-label={`${lineLabel} 공급처 로트번호`}
                          aria-invalid={!!error("supplierLotNo")}
                          className={cellInputClass}
                          {...register(`lines.${index}.supplierLotNo`)}
                        />
                      </DataGridCell>
                      <DataGridCell className="px-1 py-0.5">
                        <Input
                          id={fieldDomId(FORM_ID, `lines.${index}.origin`)}
                          maxLength={STOCK_LIMITS.originMaxLength}
                          autoComplete="off"
                          aria-label={`${lineLabel} 원산지`}
                          aria-invalid={!!error("origin")}
                          className={cellInputClass}
                          {...register(`lines.${index}.origin`)}
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
                        <span className="inline-flex">
                          <LineIconButton
                            kind="copy"
                            label={`${lineLabel} 복사`}
                            disabled={fields.length >= STOCK_LIMITS.linesMax}
                            onClick={() =>
                              insert(index + 1, {
                                ...form.getValues(`lines.${index}`),
                                lotNo: "",
                              })
                            }
                          />
                          <LineIconButton
                            kind="remove"
                            label={`${lineLabel} 삭제`}
                            onClick={() => remove(index)}
                          />
                        </span>
                      </DataGridCell>
                    </ReceiptLineRows>
                  )
                })
              )}
            </DataGridBody>
          </DataGrid>

          {fields.length > 0 && (
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[13px]">
              <span>{formatNumber(fields.length, 0)}줄</span>
              <span>
                금액 합계(부가세 포함){" "}
                <strong className="font-bold tabular-nums">
                  {formatNumber(totalIncl, 0)}원
                </strong>
              </span>
              <span className="text-muted-foreground">
                부가세 별도{" "}
                <span className="tabular-nums">
                  {totalExcl === null
                    ? EMPTY_VALUE
                    : `${formatNumber(totalExcl, 0)}원`}
                </span>
              </span>
              {unknownCost && (
                <span className="text-xs text-muted-foreground">
                  단가를 비운 줄은 금액에서 빠집니다.
                </span>
              )}
            </div>
          )}
          <LineFormErrorList formId={FORM_ID} errors={formErrors} />
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs text-muted-foreground marker:text-brand">
            <li>
              입고단가는 부가세 포함 금액으로 넣습니다(기본값: 상품의 기본
              매입가). 부가세 별도 금액은 과세구분에 따라 자동으로 계산합니다.
              모르면 비워 둬도 됩니다.
            </li>
            <li>
              기한일을 비우고 제조일자를 넣으면 ‘제조일자 + 상품의 유통기한
              기준일수 − 1일’(제조일이 1일째)로 계산합니다. 로트번호를 비우면
              ‘L입고일-번호’로 자동으로 붙습니다.
            </li>
            <li>
              묶음상품은 구성표대로 기준상품마다 로트가 생기고, 입고단가는
              기준상품의 기본 매입가 비율로 나눕니다(기본 매입가가 없는
              구성상품이 있으면 수량 비율).
            </li>
          </ul>
        </FormSection>

        {picker && (
          <StockProductPickerDialog
            includeBundles
            title={
              picker.mode === "add"
                ? "입고할 상품 선택"
                : `${picker.index + 1}번째 줄 상품 바꾸기`
            }
            multiple={picker.mode === "add"}
            addedIds={productIds}
            onPick={pickProducts}
            onClose={() => setPicker(null)}
          />
        )}
      </form>

      {warnings && (
        <ReceiptWarningDialog
          warnings={warnings}
          warningDays={expiryWarningDays}
          receivedDate={
            isCalendarDate(warnings.input.docDate)
              ? warnings.input.docDate
              : today
          }
          pending={isPending}
          onCancel={() => setWarnings(null)}
          onConfirm={() => {
            setWarnings(null)
            sendNow(warnings.input)
          }}
        />
      )}
    </ErpDialog>
  )
}

/**
 * One line of the table plus its note row: how a 묶음상품 becomes
 * 기준상품 lots, and the 보관온도 warning of the chosen 위치.
 */
function ReceiptLineRows({
  index,
  product,
  preview,
  location,
  zoneStorage,
  line,
  isAutoExpiry,
  children,
}: {
  index: number
  product: StockProductOption | undefined
  preview: ReturnType<typeof receiptLineParts> | null
  location: string | null
  zoneStorage: StorageType | null
  line: ReceiptLineInput
  isAutoExpiry: boolean
  children: React.ReactNode
}) {
  const mismatches =
    preview && zoneStorage
      ? preview.parts.filter(
          (part) =>
            part.storageType &&
            storageFit(part.storageType, zoneStorage).mismatch
        )
      : []
  const showBundle = product?.productType === "bundle" && preview
  return (
    <>
      <DataGridRow>{children}</DataGridRow>
      {(showBundle || mismatches.length > 0) && (
        <LineNoteRow colSpan={LINE_COLUMN_COUNT}>
          {showBundle && (
            <BundleConversion
              bundleUnit={product.unit}
              parts={preview.parts}
              rule={preview.rule}
              expiryTyped={!!line.expiryDate && !isAutoExpiry}
              expiryKind={line.expiryKind}
            />
          )}
          {mismatches.map((part) => (
            <p
              key={part.productId}
              className={cn(
                "font-bold",
                zoneStorage &&
                  part.storageType &&
                  storageFit(part.storageType, zoneStorage).tooWarm
                  ? "text-destructive"
                  : "text-foreground"
              )}
            >
              ⚠ {index + 1}번째 줄 보관온도 확인: {part.name} —{" "}
              {part.storageType && zoneStorage
                ? storageMismatchText(part.storageType, zoneStorage, "둡니다")
                : ""}
              {location ? ` (${location})` : ""}
            </p>
          ))}
        </LineNoteRow>
      )}
    </>
  )
}

/** "→ 기준상품으로 입고: SPAM 스팸 48개 (단가 23,000원, 기한 …)". */
function BundleConversion({
  bundleUnit,
  parts,
  rule,
  expiryTyped,
  expiryKind,
}: {
  /** The 묶음상품's own 단위, e.g. "박스". */
  bundleUnit: string
  parts: ReceiptLinePart[]
  rule: "direct" | "price_weight" | "quantity"
  expiryTyped: boolean
  expiryKind: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p>
        <span className="font-bold">→ 기준상품으로 입고:</span>{" "}
        {parts
          .map((part) => {
            const quantity =
              part.quantity === null
                ? `1${bundleUnit}당 ${formatStockQuantity(part.quantityPerUnit, part.unit)}`
                : formatStockQuantity(part.quantity, part.unit)
            const cost =
              part.unitCost === null
                ? "단가 없음"
                : `단가 ${formatNumber(part.unitCost, 0)}원/${part.unit}`
            const expiry =
              expiryKind === "none"
                ? "기한 없음"
                : part.expiryDate
                  ? `기한 ${part.expiryDate}`
                  : "기한일 필요"
            return `${part.code} ${part.name} ${quantity} (${cost}, ${expiry})`
          })
          .join(" · ")}
      </p>
      <p className="text-muted-foreground">
        {rule === "price_weight"
          ? "입고단가는 구성상품의 기본 매입가 비율로 나눴습니다(원 단위 반올림)."
          : rule === "quantity"
            ? "기본 매입가가 없는 구성상품이 있어 입고단가를 수량 비율로 나눴습니다."
            : null}
        {rule !== "direct" &&
          " 전표 금액은 입력한 단가 × 수량 그대로이고, 재고금액은 나눈 단가로 계산해 수량이 많으면 몇 원~몇천 원 다를 수 있습니다."}
        {expiryKind !== "none" &&
          (expiryTyped
            ? " 입력한 기한일이 모든 구성상품에 들어갑니다."
            : " 기한일을 비워 두면 구성상품마다 제조일자 + 유통기한 기준일수로 계산합니다.")}
      </p>
    </div>
  )
}

/**
 * Asks before saving: lines whose 구역 has another 보관온도 (red when the
 * 구역 is too warm), and lots that are already past their 기한 (red) or
 * near it (기한 임박). Saving anyway is allowed (e.g. 반품 of old stock).
 */
function ReceiptWarningDialog({
  warnings,
  warningDays,
  receivedDate,
  pending,
  onCancel,
  onConfirm,
}: {
  warnings: SaveWarnings
  warningDays: number
  /** The 입고일 the 기한 are counted from. */
  receivedDate: string
  pending: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const { storage, expiry } = warnings
  const tooWarm = storage.some((warning) => warning.tooWarm)
  const expiredCount = expiry.filter((warning) => warning.expired).length
  const imminentCount = expiry.length - expiredCount
  useHotkeys({ F5: () => {}, F8: onConfirm })
  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title="저장 전 확인"
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
      <div className="flex flex-col gap-3 text-sm">
        {expiry.length > 0 && (
          <section aria-label="기한 확인" className="flex flex-col gap-1.5">
            <p>
              {expiredCount > 0 && (
                <strong className="font-bold text-destructive">
                  기한이 이미 지난 로트 {expiredCount}건
                </strong>
              )}
              {expiredCount > 0 && imminentCount > 0 && " · "}
              {imminentCount > 0 && (
                <strong className="font-bold">
                  기한 임박({warningDays}일 이내) 로트 {imminentCount}건
                </strong>
              )}
              이 있습니다(입고일 {receivedDate} 기준). 기한일을 잘못 넣지
              않았는지 확인해 주세요. 기한이 지난 재고는 출고(FEFO)에서
              빠집니다.
            </p>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto border border-grid-line p-2 text-[13px]">
              {expiry.map((warning, index) => (
                <li
                  key={`${warning.line}-${warning.productName}-${index}`}
                  className={cn(
                    "flex flex-wrap items-center gap-x-1.5",
                    warning.expired && "font-bold text-destructive"
                  )}
                >
                  <span>
                    {warning.line}번째 줄 {warning.productName}:{" "}
                    {warning.expiryLabel} {warning.expiryDate}
                  </span>
                  <ExpiryBadge
                    daysLeft={warning.daysLeft}
                    warningDays={warningDays}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
        {storage.length > 0 && (
          <section aria-label="보관온도 확인" className="flex flex-col gap-1.5">
            <p>
              상품의 보관온도와 다른 구역에 넣는 줄이{" "}
              <strong className="font-bold">{storage.length}건</strong>{" "}
              있습니다.
              {tooWarm && (
                <strong className="font-bold text-destructive">
                  {" "}
                  온도가 너무 높은 구역이 있습니다(빨간 줄). 상품이 상할 수
                  있습니다.
                </strong>
              )}
            </p>
            <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto border border-grid-line p-2 text-[13px]">
              {storage.map((warning, index) => (
                <li
                  key={`${warning.line}-${warning.productName}-${index}`}
                  className={
                    warning.tooWarm ? "font-bold text-destructive" : undefined
                  }
                >
                  {warning.line}번째 줄 {warning.productName}:{" "}
                  {storageMismatchText(
                    warning.productStorage,
                    warning.zoneStorage,
                    "둡니다"
                  )}{" "}
                  <span className="text-muted-foreground">
                    ({warning.place})
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[13px] text-muted-foreground">
              그대로 저장해도 재고처별 재고현황과 대시보드에 ‘보관온도 불일치’로
              표시됩니다. 나중에 재고처간 이동등록으로 옮길 수 있습니다.
            </p>
          </section>
        )}
      </div>
    </ErpDialog>
  )
}
