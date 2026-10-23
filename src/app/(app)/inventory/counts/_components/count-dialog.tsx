"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { LoaderCircleIcon, RefreshCwIcon, SearchIcon } from "lucide-react"
import { unstable_rethrow } from "next/navigation"
import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react"
import { flushSync } from "react-dom"
import {
  useFieldArray,
  useForm,
  useWatch,
  type FieldErrors,
  type FieldPath,
} from "react-hook-form"
import { toast } from "sonner"

import { BaseProductPickerDialog } from "@/components/base-product-picker-dialog"
import { ActionButton, ActionLink } from "@/components/erp/action-bar"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { FormRow, FormSection, FormTable } from "@/components/erp/form-table"
import { SearchField, SearchPanel } from "@/components/erp/search-panel"
import { newRequestId } from "@/components/inventory/dialog-helpers"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { EMPTY_VALUE, formatNumber } from "@/lib/format"
import {
  applyStockCount,
  loadCountSheet,
  loadInventorySettings,
  loadStockPlaces,
  type StockSaveResult,
} from "@/lib/inventory/actions"
import {
  formatPlacePath,
  STOCK_LIMITS,
  suggestExpiryDate,
} from "@/lib/inventory/constants"
import type {
  CountSheetLine,
  StockWarehouseNode,
} from "@/lib/inventory/queries"
import {
  countFormSchema,
  isCalendarDate,
  parseStockDocumentModal,
  todayInKorea,
  type CountFormInput,
  type CountFormValues,
  type CountLineInput,
} from "@/lib/inventory/schema"
import type { BaseProductOption } from "@/lib/products/bundle"
import { storageTypeLabel } from "@/lib/products/constants"

import { CountConfirmDialog, CountSummaryBar } from "./count-confirm-dialog"
import { differenceMilli, lineKey, quantityText } from "./count-helpers"
import {
  CountNewLots,
  emptyNewLot,
  NEW_LOT_ADD_ID,
  newLotQuantityId,
  type ScopeLocation,
} from "./count-new-lots"
import {
  countedInputId,
  CountSheetTable,
  type CountFormApi,
} from "./count-sheet-table"
import { summarize, type CountSummary } from "./count-summary"
import { SimpleSelect } from "./count-ui"

const FORM_ID = "count-form"
const MEMO_ID = "count-memo"

const UNSAVED_CHANGES_MESSAGE =
  "저장하지 않은 실사 내용은 사라집니다. 창을 닫을까요?"

/** Quick 사유 choices (they fill the 사유 box; it stays editable). */
const MEMO_SUGGESTIONS = [
  "정기 실사",
  "수시 실사",
  "분실",
  "파손 발견",
  "입력 오류 정정",
]

/** Select value meaning "no choice" / "all". */
const NONE = "none"
const ALL = "all"

/** What is read when the modal opens. */
type LoadState =
  | { status: "loading" }
  | { status: "ready"; places: StockWarehouseNode[]; warningDays: number }
  | { status: "error" }

/** A 실사 범위: one 창고, optionally one 구역 and one 위치 ("" = all). */
type Scope = { warehouseId: string; zoneId: string; locationId: string }

/** The 실사 목록 as read (the form's `lines` follow its order). */
type LoadedSheet = {
  version: number
  scope: Scope
  asOf: string
  lines: CountSheetLine[]
  /** lineKey → the 전산 수량 before the list was read again. */
  changedFrom: Map<string, number>
}

/** Which rows of the 실사 목록 are shown. */
type SheetView =
  "all" | "uncounted" | "counted" | "difference" | "changed" | "error"

type SheetFilter = {
  text: string
  view: SheetView
  /** Rows of `view` when it was chosen (null = all rows). */
  indexes: number[] | null
}

const ALL_ROWS: SheetFilter = { text: "", view: "all", indexes: null }

function sameScope(a: Scope, b: Scope): boolean {
  return (
    a.warehouseId === b.warehouseId &&
    a.zoneId === b.zoneId &&
    a.locationId === b.locationId
  )
}

/** "본사 물류센터 > 냉장 B구역 > C-01-01" (or "> 전체 구역"). */
function scopeLabel(places: readonly StockWarehouseNode[], scope: Scope) {
  const warehouse = places.find((item) => item.id === scope.warehouseId)
  if (!warehouse) return EMPTY_VALUE
  const zone = warehouse.zones.find((item) => item.id === scope.zoneId)
  if (!zone) return `${warehouse.name} (전체 구역)`
  const location = zone.locations.find((item) => item.id === scope.locationId)
  return formatPlacePath(warehouse.name, zone.name, location?.code ?? null)
}

/** The 사용 위치 inside a 범위 (where 발견 재고 may go), in screen order. */
function scopeLocations(
  places: readonly StockWarehouseNode[],
  scope: Scope
): ScopeLocation[] {
  const warehouse = places.find((item) => item.id === scope.warehouseId)
  if (!warehouse) return []
  return warehouse.zones
    .filter((zone) => !scope.zoneId || zone.id === scope.zoneId)
    .flatMap((zone) =>
      zone.locations
        .filter(
          (location) =>
            location.canReceive &&
            (!scope.locationId || location.id === scope.locationId)
        )
        .map((location) => ({
          id: location.id,
          label: `${zone.name} > ${location.code}`,
          zoneStorageType: zone.storageType,
        }))
    )
}

/**
 * Where a 발견 재고 of this product goes first: the first 사용 위치 of the
 * 범위 in a 구역 with the product's 보관온도 (the 기본 위치 comes first),
 * or else the first 사용 위치.
 */
function defaultLocationFor(
  product: BaseProductOption,
  locations: readonly ScopeLocation[]
): string {
  const fitting = locations.find(
    (location) => location.zoneStorageType === product.storageType
  )
  return (fitting ?? locations[0])?.id ?? ""
}

/** Every path with an error message, e.g. "lines.3.countedQuantity". */
function errorPaths(errors: FieldErrors<CountFormInput>): string[] {
  const paths: string[] = []
  function walk(value: unknown, path: string) {
    if (!value || typeof value !== "object") return
    const node = value as Record<string, unknown>
    if (typeof node.message === "string" && node.message) paths.push(path)
    for (const [key, child] of Object.entries(node)) {
      if (["message", "type", "ref", "types", "root"].includes(key)) continue
      walk(child, path ? `${path}.${key}` : key)
    }
    if (node.root && typeof node.root === "object") {
      walk(node.root, path)
    }
  }
  walk(errors, "")
  return paths
}

/** Error paths in screen order: 실사 lines, 발견 재고, 사유. */
function sortPaths(paths: readonly string[]): string[] {
  const rank = (path: string) => {
    const line = /^lines\.(\d+)/.exec(path)
    if (line) return 1000 + Number(line[1])
    if (path === "lines") return 500
    const lot = /^newLots\.(\d+)/.exec(path)
    if (lot) return 100_000 + Number(lot[1])
    if (path === "memo") return 1_000_000
    return 0
  }
  return [...paths].sort((a, b) => rank(a) - rank(b))
}

/** The message of the `lines` list as a whole (e.g. nothing counted). */
function listMessage(
  errors: FieldErrors<CountFormInput>["lines"]
): string | undefined {
  if (!errors) return undefined
  const node = errors as { message?: string; root?: { message?: string } }
  return node.message ?? node.root?.message
}

/**
 * 실사 등록 modal (?modal=new).
 *
 * 1. 실사 범위: 실사 일자 (today or earlier) and a 창고 (optionally one 구역
 *    and one 선반/위치) → [실사 목록 불러오기 | F4] reads every lot with
 *    stock there at the end of that day (전산 수량).
 * 2. 실사 수량: the counted quantity per line; an empty box means "not
 *    counted" and the line is left as it is. 차이 and its value show live.
 * 3. 발견 재고: stock that has no lot in the list → new lots.
 * 4. 사유 (required), then [저장 | F8] → a confirm with every change →
 *    저장 | F8. Only differences become adjustments.
 *
 * The database refuses the save when the stock of a counted line changed
 * after the list was read (another 전표 meanwhile): [실사 목록 다시
 * 불러오기] then reads the list again and keeps what was typed, marking
 * the lines whose 전산 수량 changed. Changing the 범위 or the date needs a
 * new list before saving. The same save sent twice (e.g. a retry after a
 * network error) makes one 전표 only (requestId).
 *
 * Esc / × / [취소] close it, asking first when something was typed.
 */
export function CountDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void
  /** The 전표 was saved: show it (the parent switches the modal to it). */
  onSaved: (documentId: string) => void
}) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [today] = useState(() => todayInKorea())
  const [draft, setDraft] = useState<Scope & { date: string }>(() => ({
    warehouseId: "",
    zoneId: "",
    locationId: "",
    date: todayInKorea(),
  }))
  const [sheet, setSheet] = useState<LoadedSheet | null>(null)
  const [sheetError, setSheetError] = useState<string | null>(null)
  // Typed values were carried into a list read again (so the form is not
  // "clean" even though it was reset).
  const [carried, setCarried] = useState(false)
  // The save was refused because stock changed after the list was read.
  const [stale, setStale] = useState(false)
  const [filter, setFilter] = useState<SheetFilter>(ALL_ROWS)
  const deferredText = useDeferredValue(filter.text)
  const [confirm, setConfirm] = useState<CountSummary | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [products, setProducts] = useState<
    ReadonlyMap<string, BaseProductOption>
  >(() => new Map())
  const [requestId] = useState(() => newRequestId())

  const [, startLoad] = useTransition()
  const [isLoadingSheet, startLoadSheet] = useTransition()
  const [isSaving, startSaving] = useTransition()
  // Set while a save is being sent, so F8 or a double click cannot send
  // the 실사 twice.
  const submittingRef = useRef(false)
  const versionRef = useRef(0)
  // False once this modal is gone (set again on mount: React may run
  // effects twice in development). See isStillShown.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /**
   * Whether this modal is still the one the user is looking at. After the
   * browser's back button during a save, its answer must not show errors
   * in (or switch) the screen shown by then. The address is checked too:
   * Next.js carries out a back navigation only after a running Server
   * Action has answered.
   */
  function isStillShown(): boolean {
    if (!mountedRef.current) return false
    const shown = parseStockDocumentModal(
      new URLSearchParams(window.location.search)
    )
    return shown?.mode === "new"
  }

  const form: CountFormApi = useForm<CountFormInput, unknown, CountFormValues>({
    resolver: zodResolver(countFormSchema),
    defaultValues: {
      requestId,
      docDate: "",
      memo: "",
      lines: [],
      newLots: [],
    },
    shouldFocusError: false,
  })
  const {
    formState: { errors, isDirty },
  } = form
  const newLots = useFieldArray({ control: form.control, name: "newLots" })
  const hasInput = isDirty || carried

  // Read the 창고 > 구역 > 위치 and the 기한 임박 기준일 when the modal opens.
  // In a transition, so a redirect from the server (e.g. to the login page
  // when the session has expired) is carried out by Next.js.
  useEffect(() => {
    let ignore = false
    startLoad(async () => {
      let places: StockWarehouseNode[]
      let warningDays: number
      try {
        const [placeTree, settings] = await Promise.all([
          loadStockPlaces(),
          loadInventorySettings(),
        ])
        places = placeTree
        warningDays = settings.expiryWarningDays
      } catch (error) {
        if (ignore) return
        unstable_rethrow(error)
        console.error(error)
        setLoad({ status: "error" })
        return
      }
      if (ignore) return
      setLoad({ status: "ready", places, warningDays })
      // With only one 사용 창고 there is nothing to choose.
      const active = places.filter((warehouse) => warehouse.isActive)
      if (active.length === 1) {
        setDraft((current) =>
          current.warehouseId
            ? current
            : { ...current, warehouseId: active[0].id }
        )
      }
    })
    return () => {
      ignore = true
    }
  }, [loadAttempt])

  // Closing the tab or reloading the page with typed values: the browser
  // asks first.
  useEffect(() => {
    if (!hasInput) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [hasInput])

  const places = load.status === "ready" ? load.places : []
  const warningDays = load.status === "ready" ? load.warningDays : 7
  const draftScope: Scope = {
    warehouseId: draft.warehouseId,
    zoneId: draft.zoneId,
    locationId: draft.locationId,
  }
  const scopeChanged =
    sheet !== null &&
    (!sameScope(sheet.scope, draftScope) || sheet.asOf !== draft.date)
  const locations = sheet ? scopeLocations(places, sheet.scope) : []

  // ---- 실사 목록 ----------------------------------------------------------------

  /** The 실사 수량 / 메모 typed so far in the lines of `list`, by lineKey. */
  function typedValues(
    list: LoadedSheet | null
  ): Map<string, { counted: string; memo: string }> {
    const typed = new Map<string, { counted: string; memo: string }>()
    if (!list) return typed
    const values = form.getValues("lines")
    list.lines.forEach((line, index) => {
      const value = values[index]
      if (!value) return
      if (value.countedQuantity.trim() !== "" || value.memo.trim() !== "") {
        typed.set(lineKey(line.lotId, line.locationId), {
          counted: value.countedQuantity,
          memo: value.memo,
        })
      }
    })
    return typed
  }

  /** [실사 목록 불러오기 | F4]: the list of the chosen 범위 and date. */
  function loadSheet() {
    if (load.status !== "ready" || isLoadingSheet || isSaving) return
    if (!draft.warehouseId) {
      setSheetError("실사할 창고를 골라 주세요.")
      return
    }
    if (!isCalendarDate(draft.date) || draft.date > todayInKorea()) {
      setSheetError(
        "실사 일자를 확인해 주세요. 오늘 이후의 날짜로는 실사할 수 없습니다."
      )
      return
    }
    readSheet(draftScope, draft.date)
  }

  /**
   * Reads the 실사 목록 of `scope` at the end of `date`. The same 범위 read
   * again keeps the typed 실사 수량 / 메모 of the lines that are still
   * there (lines whose 전산 수량 changed are marked); another 범위 starts
   * empty (asked first when something was typed).
   */
  function readSheet(scope: Scope, date: string) {
    const keep = sheet !== null && sameScope(sheet.scope, scope)
    const lotCount = form.getValues("newLots").length
    if (
      !keep &&
      (typedValues(sheet).size > 0 || lotCount > 0) &&
      !window.confirm(
        "다른 범위의 실사 목록을 불러오면 지금 입력한 실사 수량과 발견 재고가 지워집니다. 계속할까요?"
      )
    ) {
      return
    }
    setSheetError(null)
    const previous = sheet
    startLoadSheet(async () => {
      let result: Awaited<ReturnType<typeof loadCountSheet>>
      try {
        result = await loadCountSheet(
          {
            warehouseId: scope.warehouseId,
            zoneId: scope.zoneId || null,
            locationId: scope.locationId || null,
          },
          date
        )
      } catch (error) {
        unstable_rethrow(error)
        console.error(error)
        if (mountedRef.current) {
          setSheetError(
            "실사 목록을 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
          )
        }
        return
      }
      if (!mountedRef.current) return
      if (!result.ok) {
        setSheetError(result.message)
        return
      }
      applySheet(scope, result.asOf, result.lines, keep, previous)
    })
  }

  /**
   * Puts a 실사 목록 just read into the form. `keep`: the same 범위 was read
   * again — what was typed meanwhile (read now, so keys typed while the list
   * was loading count too) stays on the lines that are still there.
   */
  function applySheet(
    scope: Scope,
    asOf: string,
    lines: CountSheetLine[],
    keep: boolean,
    previous: LoadedSheet | null
  ) {
    const typed = keep ? typedValues(previous) : null
    const previousQuantity = new Map(
      (previous?.lines ?? []).map((line) => [
        lineKey(line.lotId, line.locationId),
        line.systemQuantity,
      ])
    )
    const changedFrom = new Map<string, number>()
    const keys = new Set<string>()
    const formLines: CountLineInput[] = lines.map((line) => {
      const key = lineKey(line.lotId, line.locationId)
      keys.add(key)
      const before = previousQuantity.get(key)
      if (typed && before !== undefined && before !== line.systemQuantity) {
        changedFrom.set(key, before)
      }
      const kept = typed?.get(key)
      return {
        lotId: line.lotId,
        locationId: line.locationId,
        unit: line.productUnit,
        systemQuantity: quantityText(line.systemQuantity),
        countedQuantity: kept?.counted ?? "",
        memo: kept?.memo ?? "",
      }
    })
    const dropped = typed
      ? [...typed.entries()].filter(
          ([key, value]) => !keys.has(key) && value.counted.trim() !== ""
        ).length
      : 0
    const current = form.getValues()
    const keptLots = typed ? current.newLots : []
    const anythingKept =
      formLines.some((line) => line.countedQuantity.trim() !== "") ||
      keptLots.length > 0 ||
      current.memo.trim() !== ""

    form.reset({
      requestId,
      docDate: asOf,
      memo: current.memo,
      lines: formLines,
      newLots: keptLots,
    })
    versionRef.current += 1
    setSheet({
      version: versionRef.current,
      scope,
      asOf,
      lines,
      changedFrom,
    })
    setDraft({ ...scope, date: asOf })
    setCarried(anythingKept)
    setStale(false)
    setFilter(ALL_ROWS)

    if (lines.length === 0) {
      toast.info(
        "이 범위에는 그 날짜에 재고가 없습니다. 창고에서 찾은 재고가 있으면 [발견 재고 추가]로 넣어 주세요."
      )
    } else if (changedFrom.size > 0) {
      toast.warning(
        `전산 수량이 바뀐 줄이 ${formatNumber(changedFrom.size, 0)}줄 있습니다. 노란색 줄의 실사 수량을 다시 확인해 주세요.`
      )
    } else if (typed) {
      toast.success(
        "실사 목록을 다시 불러왔습니다. 입력한 값은 그대로 두었습니다."
      )
    }
    if (dropped > 0) {
      toast.info(
        `입력한 실사 수량 중 ${formatNumber(dropped, 0)}줄은 새 목록에 없어(그 사이 재고가 모두 나감) 빠졌습니다.`
      )
    }
  }

  // ---- Rows shown ---------------------------------------------------------------

  function viewIndexes(view: SheetView): number[] | null {
    if (!sheet || view === "all") return null
    const values = form.getValues("lines")
    return sheet.lines.flatMap((line, index) => {
      const value = values[index]
      const typed = !!value && value.countedQuantity.trim() !== ""
      const difference = value
        ? differenceMilli(value.systemQuantity, value.countedQuantity)
        : null
      const matches =
        view === "uncounted"
          ? !typed
          : view === "counted"
            ? typed
            : view === "difference"
              ? typed && difference !== 0
              : view === "changed"
                ? sheet.changedFrom.has(lineKey(line.lotId, line.locationId))
                : !!errors.lines?.[index]
      return matches ? [index] : []
    })
  }

  // An emptied box applies at once (e.g. focusPath shows every row first).
  const searchText = (filter.text === "" ? "" : deferredText)
    .trim()
    .toLowerCase()
  const shownIndexes: number[] = sheet
    ? (filter.indexes ?? sheet.lines.map((_, index) => index)).filter(
        (index) => {
          if (!searchText) return true
          const line = sheet.lines[index]
          return [
            line.productCode,
            line.productName,
            line.lotNo,
            line.locationCode,
            line.zoneName,
          ].some((text) => text.toLowerCase().includes(searchText))
        }
      )
    : []

  function fillVisibleBlanks() {
    if (!sheet) return
    const values = form.getValues("lines")
    const blanks = shownIndexes.filter(
      (index) => values[index]?.countedQuantity.trim() === ""
    )
    if (blanks.length === 0) {
      toast.info("보이는 줄에 빈 실사 수량이 없습니다.")
      return
    }
    if (
      !window.confirm(
        `보이는 줄 중 실사 수량이 빈 ${formatNumber(blanks.length, 0)}줄에 전산 수량을 그대로 넣을까요? (직접 세어 맞는 것을 확인한 줄에만 쓰세요. 그 줄들은 ‘같음’으로 저장됩니다.)`
      )
    ) {
      return
    }
    for (const index of blanks) {
      form.setValue(
        `lines.${index}.countedQuantity`,
        quantityText(sheet.lines[index].systemQuantity),
        { shouldDirty: true }
      )
    }
  }

  function clearCounted() {
    if (!sheet) return
    const values = form.getValues("lines")
    const typed = values.filter((value) => value.countedQuantity.trim() !== "")
    if (typed.length === 0) return
    if (
      !window.confirm(
        `입력한 실사 수량 ${formatNumber(typed.length, 0)}줄을 모두 지울까요?`
      )
    ) {
      return
    }
    values.forEach((value, index) => {
      if (value.countedQuantity.trim() !== "") {
        form.setValue(`lines.${index}.countedQuantity`, "", {
          shouldDirty: true,
        })
      }
    })
  }

  // ---- 발견 재고 ------------------------------------------------------------------

  const usedLines = () =>
    form
      .getValues("lines")
      .filter((value) => value.countedQuantity.trim() !== "").length +
    form.getValues("newLots").length

  function addNewLots(picked: BaseProductOption[]) {
    setProducts((current) => {
      const next = new Map(current)
      for (const product of picked) next.set(product.id, product)
      return next
    })
    const room = STOCK_LIMITS.linesMax - usedLines()
    const lots = picked
      .slice(0, Math.max(room, 0))
      .map((product) =>
        emptyNewLot(product, defaultLocationFor(product, locations))
      )
    if (lots.length < picked.length) {
      toast.error(
        `실사 전표 하나에 ${formatNumber(STOCK_LIMITS.linesMax, 0)}줄까지 넣을 수 있어 ${formatNumber(picked.length - lots.length, 0)}개는 넣지 않았습니다.`
      )
    }
    if (lots.length === 0) return
    const first = newLots.fields.length
    newLots.append(lots, { shouldFocus: false })
    setTimeout(() => document.getElementById(newLotQuantityId(first))?.focus())
  }

  function removeNewLot(index: number) {
    newLots.remove(index)
    setTimeout(() => {
      const next =
        document.getElementById(newLotQuantityId(index)) ??
        document.getElementById(NEW_LOT_ADD_ID)
      next?.focus()
    })
  }

  // ---- Errors -------------------------------------------------------------------

  /** Shows the row (or field) of an error path and focuses it. */
  function focusPath(path: string) {
    const line = /^lines\.(\d+)/.exec(path)
    if (line) {
      const index = Number(line[1])
      flushSync(() => setFilter(ALL_ROWS))
      const input = document.getElementById(countedInputId(index))
      input?.scrollIntoView({ block: "center" })
      input?.focus()
      return
    }
    const lot = /^newLots\.(\d+)(?:\.(\w+))?/.exec(path)
    if (lot) {
      const index = Number(lot[1])
      const prefix = `count-new-lot-${index}`
      const ids: Record<string, string> = {
        locationId: `${prefix}-location`,
        quantity: newLotQuantityId(index),
        expiryKind: `${prefix}-expiry-kind`,
        expiryDate: `${prefix}-expiry-date`,
        manufacturedDate: `${prefix}-manufactured`,
        lotNo: `${prefix}-lot-no`,
        unitCostInclVat: `${prefix}-cost`,
        memo: `${prefix}-memo`,
      }
      const element =
        document.getElementById(ids[lot[2] ?? ""] ?? "") ??
        document.getElementById(newLotQuantityId(index))
      element?.scrollIntoView({ block: "center" })
      element?.focus()
      return
    }
    if (path === "memo") {
      form.setFocus("memo")
      return
    }
    if (path === "lines") {
      const first = document.getElementById(countedInputId(0))
      first?.focus()
    }
  }

  /** Checks the form says nothing about: 사유, 기한 of 발견 재고. */
  function checkExtra(values: CountFormInput): boolean {
    let ok = true
    if (values.memo.trim() === "") {
      form.setError("memo", {
        type: "manual",
        message: "사유를 입력해 주세요. (예: 정기 실사, 파손 발견)",
      })
      ok = false
    }
    values.newLots.forEach((lot, index) => {
      const product = products.get(lot.productId)
      if (
        lot.expiryKind !== "none" &&
        lot.expiryDate.trim() === "" &&
        !suggestExpiryDate(
          lot.manufacturedDate || null,
          product?.shelfLifeDays ?? null
        )
      ) {
        form.setError(`newLots.${index}.expiryDate`, {
          type: "manual",
          message: product?.shelfLifeDays
            ? "기한일이나 제조일자를 입력해 주세요. (기한이 없으면 기한 종류를 ‘없음’으로)"
            : "기한일을 입력해 주세요. 이 상품은 유통기한 기준일수가 없어 제조일자로 계산할 수 없습니다. (기한이 없으면 기한 종류를 ‘없음’으로)",
        })
        ok = false
      }
    })
    return ok
  }

  // ---- Save -----------------------------------------------------------------------

  function requestSave() {
    if (isSaving || submittingRef.current) return
    if (!sheet) {
      toast.info(
        "먼저 실사할 창고를 고르고 [실사 목록 불러오기 | F4]를 눌러 주세요."
      )
      return
    }
    if (scopeChanged) {
      toast.error(
        "실사 범위나 실사 일자를 바꿨습니다. [실사 목록 불러오기 | F4]를 다시 눌러 주세요. (불러온 목록과 다르면 저장할 수 없습니다.)"
      )
      return
    }
    void form.handleSubmit(
      () => {
        const values = form.getValues()
        if (!checkExtra(values)) {
          const first = sortPaths(errorPaths(form.formState.errors))[0]
          if (first) focusPath(first)
          toast.error(
            "입력한 내용을 확인해 주세요. 빨간 글씨로 표시된 항목이 있습니다."
          )
          return
        }
        const summary = summarize(
          sheet.lines,
          values.lines,
          values.newLots.length
        )
        if (summary.increased + summary.decreased + summary.newLots === 0) {
          toast.info(
            summary.counted === 0
              ? "실사 수량을 1줄 이상 입력하거나 발견 재고를 추가해 주세요."
              : "입력한 실사 수량이 모두 전산 수량과 같아 조정할 내용이 없습니다. (저장하지 않아도 됩니다.)"
          )
          return
        }
        setConfirm(summary)
      },
      (fieldErrors) => {
        checkExtra(form.getValues())
        const paths = sortPaths(errorPaths(fieldErrors))
        if (paths[0]) focusPath(paths[0])
        toast.error(
          listMessage(fieldErrors.lines) ??
            "입력한 내용을 확인해 주세요. 빨간 글씨로 표시된 항목이 있습니다."
        )
      }
    )()
  }

  function confirmSave() {
    if (!confirm || submittingRef.current) return
    submittingRef.current = true
    // Send what the user typed: the server checks it again with the same
    // rules (and the database once more), never trusting the browser.
    const input = form.getValues()
    startSaving(async () => {
      let result: StockSaveResult
      try {
        result = await applyStockCount(input)
      } catch (error) {
        submittingRef.current = false
        // A redirect from the server (e.g. to the login page when the
        // session has expired) is not an error: let Next.js carry it out.
        unstable_rethrow(error)
        console.error(error)
        toast.error(
          "저장했는지 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 [저장]을 눌러 주세요. (같은 실사를 다시 저장해도 전표는 하나만 생깁니다.)"
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
        setConfirm(null)
        const paths = Object.keys(result.fieldErrors)
        for (const [path, message] of Object.entries(result.fieldErrors)) {
          form.setError(path as FieldPath<CountFormInput>, {
            type: "server",
            message,
          })
        }
        if (paths.some((path) => path.endsWith(".systemQuantity"))) {
          setStale(true)
        }
        const first = sortPaths(paths)[0]
        if (first) focusPath(first)
        toast.error(result.message)
        return
      }

      const summary = result.countSummary
      toast.success(result.message, {
        description: summary
          ? `늘어남 ${formatNumber(summary.increased, 0)}줄 · 줄어듦 ${formatNumber(summary.decreased, 0)}줄 · 같음 ${formatNumber(summary.unchanged, 0)}줄${result.lots.length > 0 ? ` · 새 로트 ${result.lots.map((lot) => lot.lotNo).join(", ")}` : ""}`
          : undefined,
      })
      for (const warning of result.warnings) {
        toast.warning(
          `보관온도 확인: ${warning.productName} (${storageTypeLabel(warning.productStorageType)})이(가) ${warning.locationLabel} (${storageTypeLabel(warning.zoneStorageType)})에 들어갔습니다.`,
          { duration: 10_000 }
        )
      }
      // Saved, but the user already left this modal (e.g. the browser's
      // back button): switching now would change the screen they went to.
      if (stillShown) {
        setConfirm(null)
        onSaved(result.documentId)
      }
    })
  }

  // ---- Close --------------------------------------------------------------------

  function requestClose() {
    if (isSaving) return
    if (hasInput && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return
    onClose()
  }

  // F4 = 실사 목록 불러오기, F8 = 저장 (in the confirm: 저장 for real). F5
  // is caught so the browser does not reload the page and lose the count.
  useHotkeys({
    F5: () => {},
    F4: pickerOpen || confirm ? undefined : loadSheet,
    F8: pickerOpen ? undefined : confirm ? confirmSave : requestSave,
  })

  // ---- Screen ---------------------------------------------------------------------

  const warehouse = places.find((item) => item.id === draft.warehouseId)
  const zone = warehouse?.zones.find((item) => item.id === draft.zoneId)
  const linesMessage = listMessage(errors.lines)

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
      title="실사 등록"
      description="창고에서 직접 센 수량을 입력하면, 전산 수량과 다른 줄만 그 차이만큼 조정합니다. 빈 칸은 바뀌지 않습니다."
      footer={
        <>
          <ActionButton
            variant="secondary"
            size="lg"
            disabled={isSaving}
            onClick={requestClose}
          >
            취소
          </ActionButton>
          <ActionButton
            type="submit"
            form={FORM_ID}
            size="lg"
            keyHint="F8"
            disabled={!sheet || isSaving}
          >
            {isSaving && (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            )}
            {isSaving ? "저장 중…" : "저장"}
          </ActionButton>
        </>
      }
    >
      {load.status === "loading" ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <span className="sr-only">창고 목록을 불러오는 중…</span>
          <Skeleton className="h-6 w-40 rounded-sm" />
          <Skeleton className="h-20 w-full rounded-sm" />
          <Skeleton className="h-8 w-48 rounded-sm" />
        </div>
      ) : load.status === "error" ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-2 py-10 text-center"
        >
          <p className="font-bold">창고 목록을 불러오지 못했습니다</p>
          <p className="text-muted-foreground">
            인터넷 연결을 확인한 뒤 다시 시도해 주세요.
          </p>
          <ActionButton
            variant="neutral"
            onClick={() => {
              setLoad({ status: "loading" })
              setLoadAttempt((attempt) => attempt + 1)
            }}
          >
            다시 시도
          </ActionButton>
        </div>
      ) : places.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="font-bold">등록된 창고가 없습니다</p>
          <p className="text-muted-foreground">
            창고·로케이션 설정에서 창고와 구역을 먼저 만들어 주세요.
          </p>
          <ActionLink
            href="/inventory/settings"
            target="_blank"
            rel="noopener"
            variant="neutral"
          >
            창고·로케이션 설정 열기 (새 탭)
          </ActionLink>
        </div>
      ) : (
        // noValidate: our own Korean messages instead of the browser's.
        <form
          id={FORM_ID}
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            requestSave()
          }}
          onKeyDown={(event) => {
            // Enter in a box never saves (saving is F8 / [저장]).
            if (
              event.key === "Enter" &&
              event.target instanceof HTMLInputElement
            ) {
              event.preventDefault()
            }
          }}
        >
          <FormSection
            title="1. 실사 범위"
            description="창고 전체, 구역 하나, 또는 선반 하나를 실사할 수 있습니다. 실사 일자 마감 기준의 전산 수량을 불러옵니다."
          >
            <SearchPanel className="xl:grid-cols-2 2xl:grid-cols-4">
              <SearchField label="실사 일자" htmlFor="count-date">
                <Input
                  id="count-date"
                  type="date"
                  max={today}
                  value={draft.date}
                  disabled={isSaving}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      date: event.target.value,
                    }))
                  }
                  className="h-8 w-40 rounded-sm tabular-nums"
                />
                {draft.date !== today && isCalendarDate(draft.date) && (
                  <span className="text-xs text-muted-foreground">
                    지난 날짜로 실사
                  </span>
                )}
              </SearchField>
              <SearchField label="창고" htmlFor="count-warehouse">
                <SimpleSelect
                  id="count-warehouse"
                  value={draft.warehouseId || NONE}
                  disabled={isSaving}
                  options={[
                    ...(draft.warehouseId
                      ? []
                      : [{ value: NONE, label: "창고를 고르세요" }]),
                    ...places.map((item) => ({
                      value: item.id,
                      label: `${item.code} ${item.name}${item.isActive ? "" : " (사용중지)"} · 재고 ${formatNumber(item.stockRowCount, 0)}줄`,
                    })),
                  ]}
                  className="max-w-none"
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      warehouseId: value === NONE ? "" : value,
                      zoneId: "",
                      locationId: "",
                    }))
                  }
                />
              </SearchField>
              <SearchField label="구역" htmlFor="count-zone">
                <SimpleSelect
                  id="count-zone"
                  value={draft.zoneId || ALL}
                  disabled={!warehouse || isSaving}
                  options={[
                    { value: ALL, label: "전체 구역" },
                    ...(warehouse?.zones ?? []).map((item) => ({
                      value: item.id,
                      label: `${item.code} ${item.name} (${storageTypeLabel(item.storageType)})${item.isActive ? "" : " (사용중지)"} · ${formatNumber(item.stockRowCount, 0)}줄`,
                    })),
                  ]}
                  className="max-w-none"
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      zoneId: value === ALL ? "" : value,
                      locationId: "",
                    }))
                  }
                />
              </SearchField>
              <SearchField label="선반(위치)" htmlFor="count-location">
                <SimpleSelect
                  id="count-location"
                  value={draft.locationId || ALL}
                  disabled={!zone || isSaving}
                  options={[
                    { value: ALL, label: "전체 위치" },
                    ...(zone?.locations ?? []).map((item) => ({
                      value: item.id,
                      label: `${item.code}${item.name && item.name !== item.code ? ` ${item.name}` : ""}${item.isActive ? "" : " (사용중지)"} · ${formatNumber(item.stockRowCount, 0)}줄`,
                    })),
                  ]}
                  className="max-w-none"
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      locationId: value === ALL ? "" : value,
                    }))
                  }
                />
              </SearchField>
            </SearchPanel>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <ActionButton
                keyHint="F4"
                disabled={isLoadingSheet || isSaving}
                onClick={loadSheet}
              >
                {isLoadingSheet ? (
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="animate-spin"
                  />
                ) : (
                  <SearchIcon aria-hidden="true" />
                )}
                실사 목록 불러오기
              </ActionButton>
              {sheet && (
                <p className="text-[13px]">
                  불러온 목록:{" "}
                  <strong className="font-bold">
                    {scopeLabel(places, sheet.scope)}
                  </strong>{" "}
                  · <span className="tabular-nums">{sheet.asOf}</span> 마감 기준
                  · {formatNumber(sheet.lines.length, 0)}줄
                </p>
              )}
            </div>
            {sheet && scopeChanged && (
              <p role="alert" className="text-xs font-bold text-destructive">
                실사 범위나 실사 일자를 바꿨습니다. [실사 목록 불러오기 | F4]를
                다시 눌러야 저장할 수 있습니다.
              </p>
            )}
            {sheetError && (
              <p
                role="alert"
                className="text-[13px] font-bold text-destructive"
              >
                {sheetError}
              </p>
            )}
          </FormSection>

          {sheet && (
            <>
              <FormSection
                title="2. 실사 수량 입력"
                description="직접 센 수량을 넣으세요. 빈 칸(미입력)은 세지 않은 것으로 보고 바꾸지 않습니다. 0을 넣으면 재고가 없어진 것으로 조정합니다."
              >
                {stale && (
                  <div
                    role="alert"
                    className="flex flex-wrap items-center gap-2 border border-chart-4 bg-chart-4/15 px-3 py-2 text-[13px]"
                  >
                    <p className="min-w-0 flex-1">
                      실사 목록을 불러온 뒤 다른 전표(출고·이동 등)로 재고가
                      바뀌어 저장하지 않았습니다. 다시 불러오면 입력한 실사
                      수량은 그대로 두고 전산 수량만 새로 읽습니다. 바뀐 줄은
                      노란색으로 표시됩니다.
                    </p>
                    <ActionButton
                      variant="secondary"
                      disabled={isLoadingSheet}
                      onClick={() => readSheet(sheet.scope, sheet.asOf)}
                    >
                      <RefreshCwIcon aria-hidden="true" />
                      실사 목록 다시 불러오기
                    </ActionButton>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <Input
                    type="search"
                    aria-label="실사 목록에서 찾기"
                    placeholder="상품코드, 상품명, 로트번호, 위치로 찾기"
                    value={filter.text}
                    autoComplete="off"
                    onChange={(event) =>
                      setFilter((current) => ({
                        ...current,
                        text: event.target.value,
                      }))
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.preventDefault()
                    }}
                    className="h-8 w-full max-w-72 rounded-sm"
                  />
                  <SimpleSelect
                    aria-label="보일 줄"
                    value={filter.view}
                    options={[
                      { value: "all", label: "전체 줄" },
                      { value: "uncounted", label: "입력 안 한 줄" },
                      { value: "counted", label: "입력한 줄" },
                      { value: "difference", label: "차이 있는 줄" },
                      ...(sheet.changedFrom.size > 0
                        ? [{ value: "changed", label: "전산 수량이 바뀐 줄" }]
                        : []),
                      ...(errors.lines
                        ? [{ value: "error", label: "오류 있는 줄" }]
                        : []),
                    ]}
                    className="w-44"
                    onChange={(value) =>
                      setFilter((current) => ({
                        ...current,
                        view: value as SheetView,
                        indexes: viewIndexes(value as SheetView),
                      }))
                    }
                  />
                  {filter.view !== "all" && (
                    <ActionButton
                      size="sm"
                      variant="neutral"
                      title="고른 뒤에 입력한 값을 반영해 다시 고릅니다"
                      onClick={() =>
                        setFilter((current) => ({
                          ...current,
                          indexes: viewIndexes(current.view),
                        }))
                      }
                    >
                      <RefreshCwIcon aria-hidden="true" />
                      다시 고르기
                    </ActionButton>
                  )}
                  <span className="ml-auto flex flex-wrap gap-1.5">
                    <ActionButton
                      size="sm"
                      variant="neutral"
                      onClick={fillVisibleBlanks}
                    >
                      보이는 빈 칸 = 전산 수량
                    </ActionButton>
                    <ActionButton
                      size="sm"
                      variant="neutral"
                      onClick={clearCounted}
                    >
                      실사 수량 모두 지우기
                    </ActionButton>
                  </span>
                </div>

                <CountSummaryBar
                  form={form}
                  lines={sheet.lines}
                  shown={shownIndexes.length}
                />
                {linesMessage && (
                  <p
                    role="alert"
                    className="text-xs font-bold text-destructive"
                  >
                    {linesMessage}
                  </p>
                )}

                <CountSheetTable
                  form={form}
                  lines={sheet.lines}
                  indexes={shownIndexes}
                  version={sheet.version}
                  warningDays={warningDays}
                  changedFrom={sheet.changedFrom}
                  errors={errors.lines}
                  emptyMessage={
                    sheet.lines.length === 0
                      ? "이 범위에는 실사 일자에 재고가 없습니다. 창고에서 찾은 재고는 아래 [발견 재고 추가]로 넣어 주세요."
                      : "조건에 맞는 줄이 없습니다. 찾기 칸이나 ‘보일 줄’을 바꿔 보세요."
                  }
                />
                <p className="text-xs text-muted-foreground">
                  [=] 버튼은 그 줄의 실사 수량에 전산 수량을 넣습니다(세어 보니
                  맞음). 기한 경과는 빨간색, 기한 임박(D-{warningDays} 이내)은
                  노란색으로 표시됩니다.
                </p>
              </FormSection>

              <FormSection
                title="3. 발견 재고"
                description="실사 목록에 없는데 창고에서 찾은 재고 (기준상품만, 새 로트로 들어갑니다)"
              >
                <CountNewLots
                  form={form}
                  fields={newLots.fields}
                  products={products}
                  locations={locations}
                  countDate={sheet.asOf}
                  errors={errors.newLots}
                  canAdd={!isSaving}
                  onAdd={() => setPickerOpen(true)}
                  onRemove={removeNewLot}
                />
              </FormSection>

              <FormSection title="4. 사유">
                <FormTable>
                  <FormRow
                    label="사유"
                    htmlFor={MEMO_ID}
                    required
                    error={errors.memo?.message}
                    errorId={`${MEMO_ID}-error`}
                  >
                    <Input
                      id={MEMO_ID}
                      placeholder="예: 10월 정기 실사"
                      maxLength={STOCK_LIMITS.memoMaxLength}
                      autoComplete="off"
                      aria-required
                      aria-invalid={errors.memo ? true : undefined}
                      aria-describedby={
                        errors.memo ? `${MEMO_ID}-error` : undefined
                      }
                      className="h-8 w-full max-w-xl rounded-sm"
                      {...form.register("memo")}
                    />
                    <MemoSuggestions form={form} />
                  </FormRow>
                </FormTable>
              </FormSection>
            </>
          )}

          {/* Inside the 실사 dialog, so Esc closes only the picker. */}
          {pickerOpen && (
            <BaseProductPickerDialog
              addedIds={new Set()}
              capacity={Math.max(STOCK_LIMITS.linesMax - usedLines(), 1)}
              onAdd={addNewLots}
              onClose={() => setPickerOpen(false)}
            />
          )}

          {/* Inside the 실사 dialog, so Esc closes only the confirm. */}
          {confirm && sheet && (
            <CountConfirmDialog
              summary={confirm}
              form={form}
              products={products}
              locations={locations}
              scope={scopeLabel(places, sheet.scope)}
              asOf={sheet.asOf}
              saving={isSaving}
              onConfirm={confirmSave}
              onCancel={() => {
                if (!isSaving) setConfirm(null)
              }}
            />
          )}
        </form>
      )}
    </ErpDialog>
  )
}

/**
 * Quick 사유 buttons; a click fills the 사유 box (still editable). Watches
 * the 사유 itself, so typing it does not redraw the whole 실사 목록.
 */
function MemoSuggestions({ form }: { form: CountFormApi }) {
  const memo = useWatch({ control: form.control, name: "memo" })
  return (
    <span className="flex flex-wrap gap-1">
      {MEMO_SUGGESTIONS.map((suggestion) => (
        <ActionButton
          key={suggestion}
          size="sm"
          variant="neutral"
          aria-pressed={memo === suggestion}
          onClick={() => {
            form.setValue("memo", suggestion, { shouldDirty: true })
            form.clearErrors("memo")
          }}
        >
          {suggestion}
        </ActionButton>
      ))}
    </span>
  )
}
