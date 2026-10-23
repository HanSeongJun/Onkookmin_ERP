"use client"

import { LoaderCircleIcon } from "lucide-react"
import Link from "next/link"
import { unstable_rethrow, useRouter, useSearchParams } from "next/navigation"
import {
  useLayoutEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react"
import { toast } from "sonner"

import {
  ActionBar,
  ActionButton,
  actionButtonClassName,
} from "@/components/erp/action-bar"
import { DataGridCount } from "@/components/erp/data-grid"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { SearchField, SearchPanel } from "@/components/erp/search-panel"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useColumnOrder } from "@/hooks/use-column-order"
import { useHotkeys } from "@/hooks/use-hotkeys"
import {
  setEmployeesActive,
  type EmployeeStatusActionResult,
} from "@/lib/employees/actions"
import type { EmployeeListRow } from "@/lib/employees/queries"
import {
  buildEmployeeExportHref,
  buildEmployeeListHref,
  buildEmployeeModalHref,
  defaultEmployeeListParams,
  EMPLOYEE_COLUMN_IDS,
  EMPLOYEE_COLUMN_ORDER_KEY,
  EMPLOYEE_DUTY_FILTERS,
  EMPLOYEE_EXPORT_MAX_ROWS,
  EMPLOYEE_PAGE_SIZES,
  EMPLOYEE_SEARCH_MAX_LENGTH,
  EMPLOYEE_STATUS_FILTERS,
  hasEmployeeListFilters,
  parseEmployeeModal,
  type EmployeeListParams,
  type EmployeeModalState,
  type EmployeePageSize,
} from "@/lib/employees/schema"
import { formatNumber } from "@/lib/format"

import { EmployeeDialog } from "./employee-dialog"
import { EmployeeGrid } from "./employee-grid"
import { EmployeePagination } from "./employee-pagination"

/**
 * Why the list is empty:
 * - "no-employees": nobody registered yet
 * - "no-match": nobody matches the search and filters
 * - "all-inactive": employees exist, but all are 퇴사 (default filter)
 */
export type EmployeeListEmptyState =
  "none" | "no-employees" | "no-match" | "all-inactive"

/** A 선택 퇴사 / 선택 재직 waiting for the user's OK. */
type StatusRequest = { isActive: boolean; ids: string[] }

/** Id of the search <form>; the 조회 button submits it with form="…". */
const SEARCH_FORM_ID = "employee-search"

/**
 * The 직원관리 screen below the page title, like a classic ERP list:
 * action buttons (조회 F4, 신규 F5, 선택 퇴사, 선택 재직, 엑셀 Ctrl+F9),
 * the 조회 conditions (검색어, 재직여부, 담당업무), "N건 / 총 M건", the
 * grid (sortable, columns can be dragged) and the page links, plus the
 * 직원 등록/수정 modal. Employees are never deleted.
 *
 * Everything that should survive a refresh or the back button is in the URL:
 * the conditions and page (?q=…&status=all&duty=delivery&page=2) and the
 * open modal (?modal=new or ?modal=edit&id=…). Opening the modal adds a
 * history entry without reloading the list, so the browser's back button
 * closes it.
 */
export function EmployeeListScreen({
  params,
  rows,
  total,
  pageCount,
  emptyState,
}: {
  /** Conditions of the loaded list (from the URL; page clamped). */
  params: EmployeeListParams
  rows: EmployeeListRow[]
  /** Employees matching the conditions (all pages). */
  total: number
  pageCount: number
  emptyState: EmployeeListEmptyState
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const modal = parseEmployeeModal(searchParams)

  const [isPending, startTransition] = useTransition()
  // The conditions as the user just chose them. While the new list is
  // loading, `params` is still the old one; the inputs show `shown` right
  // away, and a second quick change builds on the first instead of undoing it.
  const [shown, setShown] = useOptimistic(params)
  const searchFormRef = useRef<HTMLFormElement>(null)
  // The grid's column order as this browser's user arranged it.
  const columns = useColumnOrder(EMPLOYEE_COLUMN_ORDER_KEY, EMPLOYEE_COLUMN_IDS)

  // Checked rows (for 선택 퇴사 / 선택 재직) and the current row. When a new
  // list arrives (other page or conditions, a refresh), only the checks of
  // rows that are still shown are kept.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [shownRows, setShownRows] = useState(rows)
  if (rows !== shownRows) {
    setShownRows(rows)
    setCheckedIds(
      (current) =>
        new Set(rows.filter((row) => current.has(row.id)).map((row) => row.id))
    )
  }

  const [statusRequest, setStatusRequest] = useState<StatusRequest | null>(null)
  const [isStatusPending, startStatusTransition] = useTransition()
  const [isExporting, setIsExporting] = useState(false)

  // The modal URLs this screen added to the history (see closeModal).
  const pushedModalUrlsRef = useRef<string[]>([])

  // Next.js keeps this page (hidden) when the user goes to another page:
  // close the small confirm dialog then. (The 직원 modal follows the URL.)
  useLayoutEffect(() => {
    return () => setStatusRequest(null)
  }, [])

  // ---- 조회 -----------------------------------------------------------------

  function openList(next: EmployeeListParams) {
    const href = buildEmployeeListHref(next)
    startTransition(() => {
      setShown(next)
      // 조회 with unchanged conditions reads the list again.
      if (href === buildEmployeeListHref(params)) {
        router.refresh()
      } else {
        router.push(href)
      }
    })
  }

  /** The text in the 검색어 box (applied together with any other change). */
  function typedSearch(): string {
    const form = searchFormRef.current
    const q = form ? new FormData(form).get("q") : null
    return typeof q === "string" ? q.trim() : shown.q
  }

  /** Applies changed conditions, starting again at page 1. */
  function applyFilters(changes: Partial<EmployeeListParams>) {
    openList({ ...shown, q: typedSearch(), ...changes, page: 1 })
  }

  function resetFilters() {
    openList({
      ...defaultEmployeeListParams,
      sort: shown.sort,
      pageSize: shown.pageSize,
    })
  }

  // ---- Modal (in the URL) ---------------------------------------------------

  // Never router.refresh() while a modal address is shown: Next.js would
  // then stop following later pushState addresses. The modal reads fresh
  // data with Server Actions instead.
  function openModal(state: EmployeeModalState) {
    window.history.pushState(
      null,
      "",
      buildEmployeeModalHref(window.location.search, state)
    )
    // Remember it in the browser's own spelling, to compare it later.
    pushedModalUrlsRef.current.push(
      window.location.pathname + window.location.search
    )
  }

  function openNewModal() {
    openModal({ mode: "new" })
  }

  function closeModal() {
    const current = window.location.pathname + window.location.search
    const pushed = pushedModalUrlsRef.current
    const index = pushed.lastIndexOf(current)
    if (index >= 0) {
      // We added this entry: going back removes it, so the browser's back
      // button later does not reopen the modal.
      pushed.splice(index)
      window.history.back()
    } else {
      // Opened from a link or a refresh: just drop the modal from the URL.
      window.history.replaceState(
        null,
        "",
        buildEmployeeModalHref(window.location.search, null)
      )
    }
  }

  // ---- 선택 퇴사 / 선택 재직 --------------------------------------------------

  const checkedRows = rows.filter((row) => checkedIds.has(row.id))

  function requestStatusChange(isActive: boolean) {
    if (checkedRows.length === 0) {
      toast.info(
        isActive
          ? "재직으로 바꿀 직원을 먼저 체크해 주세요."
          : "퇴사로 바꿀 직원을 먼저 체크해 주세요."
      )
      return
    }
    setStatusRequest({ isActive, ids: checkedRows.map((row) => row.id) })
  }

  function confirmStatusChange() {
    if (!statusRequest || isStatusPending) return
    const { isActive, ids } = statusRequest
    const target = isActive ? "재직으로" : "퇴사로"
    const state = isActive ? "재직" : "퇴사"

    // In a transition, so a redirect from the server (e.g. to the login
    // page when the session has expired) is carried out by Next.js.
    startStatusTransition(async () => {
      let result: EmployeeStatusActionResult
      try {
        result = await setEmployeesActive(ids, isActive)
      } catch (error) {
        unstable_rethrow(error)
        console.error(error)
        toast.error(
          "재직여부를 바꾸지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
        )
        return
      }
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setStatusRequest(null)
      // Done with these rows: start the next selection from scratch.
      setCheckedIds(new Set())
      toast.success(
        result.changed > 0
          ? `${formatNumber(result.changed, 0)}명을 ${target} 바꿨습니다.`
          : "바뀐 직원이 없습니다.",
        {
          description:
            result.unchanged > 0
              ? `${formatNumber(result.unchanged, 0)}명은 이미 ${state} 상태였습니다.`
              : undefined,
        }
      )
    })
  }

  // ---- 엑셀 -----------------------------------------------------------------

  async function downloadExcel() {
    if (isExporting) return
    if (total === 0) {
      toast.info("내려받을 직원이 없습니다. 조회 조건을 확인해 주세요.")
      return
    }
    if (
      total > EMPLOYEE_EXPORT_MAX_ROWS &&
      !window.confirm(
        `조회된 직원이 ${formatNumber(total, 0)}명입니다. 엑셀에는 앞의 ${formatNumber(EMPLOYEE_EXPORT_MAX_ROWS, 0)}명만 담깁니다. 계속할까요?`
      )
    ) {
      return
    }

    setIsExporting(true)
    const toastId = toast.loading("엑셀 파일을 만드는 중입니다…")
    try {
      const response = await fetch(buildEmployeeExportHref(params), {
        cache: "no-store",
      })
      const contentType = response.headers.get("content-type") ?? ""
      // Signed out: the server answers 401, or sends the login page.
      if (
        response.status === 401 ||
        (response.ok && !contentType.includes("text/csv"))
      ) {
        toast.error(
          "로그인이 필요합니다. 페이지를 새로고침한 뒤 다시 로그인해 주세요.",
          { id: toastId }
        )
        return
      }
      if (!response.ok) throw new Error(`Export failed: ${response.status}`)

      const blob = await response.blob()
      const fileName =
        fileNameFromDisposition(response.headers.get("content-disposition")) ??
        "직원목록.csv"
      saveFile(blob, fileName)
      const rowCount = Number(response.headers.get("x-export-rows"))
      toast.success(
        Number.isFinite(rowCount)
          ? `엑셀 파일(${fileName})을 내려받았습니다. ${formatNumber(rowCount, 0)}명`
          : `엑셀 파일(${fileName})을 내려받았습니다.`,
        { id: toastId }
      )
    } catch (error) {
      console.error(error)
      toast.error(
        "엑셀 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
        { id: toastId }
      )
    } finally {
      setIsExporting(false)
    }
  }

  // ---- Keyboard ---------------------------------------------------------------

  // F4 = 조회, F5 = 신규 (instead of reloading the page), Ctrl+F9 = 엑셀.
  // Off while the 직원 modal is open (it has its own keys); ignored while
  // the confirm dialog is open on top of the list.
  const smallDialogOpen = statusRequest !== null
  useHotkeys(
    {
      F4: () => {
        if (!smallDialogOpen) searchFormRef.current?.requestSubmit()
      },
      F5: () => {
        if (!smallDialogOpen) openNewModal()
      },
      "Ctrl+F9": () => {
        if (!smallDialogOpen) void downloadExcel()
      },
    },
    { enabled: modal === null }
  )

  // ---- Screen ---------------------------------------------------------------

  const statusLabel = statusRequest?.isActive ? "재직" : "퇴사"

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <ActionBar
        end={
          <>
            <ActionButton
              variant="neutral"
              disabled={!hasEmployeeListFilters(shown)}
              onClick={resetFilters}
            >
              조건 초기화
            </ActionButton>
            <ActionButton
              keyHint="Ctrl+F9"
              disabled={isExporting}
              onClick={() => void downloadExcel()}
            >
              {isExporting && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              엑셀
            </ActionButton>
          </>
        }
      >
        <ActionButton type="submit" form={SEARCH_FORM_ID} keyHint="F4">
          조회
        </ActionButton>
        <ActionButton keyHint="F5" onClick={openNewModal}>
          신규
        </ActionButton>
        <ActionButton
          variant="secondary"
          onClick={() => requestStatusChange(false)}
        >
          선택 퇴사
        </ActionButton>
        <ActionButton
          variant="secondary"
          onClick={() => requestStatusChange(true)}
        >
          선택 재직
        </ActionButton>
      </ActionBar>

      <form
        ref={searchFormRef}
        id={SEARCH_FORM_ID}
        role="search"
        aria-label="직원 조회 조건"
        onSubmit={(event) => {
          event.preventDefault()
          applyFilters({})
        }}
      >
        <SearchPanel>
          <SearchField label="검색어" htmlFor="employee-search-q">
            {/* The key resets the box when the search changes from outside
                (조건 초기화, the back button). */}
            <SearchBox key={shown.q} initialValue={shown.q} />
          </SearchField>
          <SearchField label="재직여부">
            <FilterRadios
              name="status"
              label="재직여부"
              options={EMPLOYEE_STATUS_FILTERS}
              value={shown.status}
              onChange={(status) => applyFilters({ status })}
            />
          </SearchField>
          <SearchField label="담당업무">
            <FilterRadios
              name="duty"
              label="담당업무"
              options={EMPLOYEE_DUTY_FILTERS}
              value={shown.duty}
              onChange={(duty) => applyFilters({ duty })}
            />
          </SearchField>
        </SearchPanel>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <DataGridCount shown={rows.length} total={total} />
          {checkedRows.length > 0 && (
            <span className="text-[13px] text-muted-foreground">
              (체크 {formatNumber(checkedRows.length, 0)}명)
            </span>
          )}
          {isPending && (
            <LoaderCircleIcon
              className="size-4 animate-spin text-muted-foreground"
              aria-label="불러오는 중"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <ActionButton
            variant="neutral"
            disabled={columns.isDefault}
            onClick={() => {
              columns.reset()
              toast.success("열 순서를 처음 상태로 되돌렸습니다.")
            }}
          >
            열 순서 초기화
          </ActionButton>
          <PageSizeSelect
            value={shown.pageSize}
            onChange={(pageSize) => openList({ ...shown, pageSize, page: 1 })}
          />
        </div>
      </div>

      <div
        aria-busy={isPending}
        data-pending={isPending}
        className="flex min-w-0 flex-col gap-2.5 transition-opacity data-[pending=true]:opacity-60"
      >
        <EmployeeGrid
          rows={rows}
          checkedIds={checkedIds}
          onCheckedIdsChange={setCheckedIds}
          activeId={activeId}
          onActiveIdChange={setActiveId}
          onOpen={(id) => openModal({ mode: "edit", id })}
          columnOrder={columns.order}
          onColumnOrderChange={columns.setOrder}
          sort={shown.sort}
          onSortChange={(sort) => applyFilters({ sort })}
          empty={
            <EmptyMessage
              emptyState={emptyState}
              params={params}
              onCreate={openNewModal}
            />
          }
        />
        <EmployeePagination
          params={params}
          page={params.page}
          pageCount={pageCount}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        직원명을 누르거나 줄을 두 번 누르면(또는 줄을 고르고 Enter) 수정 창이
        열립니다. 열 제목을 누르면 정렬(▲→▼→기본), 끌어 놓으면 열 순서가
        바뀝니다(이 브라우저에 기억). 영업담당은 판매 플랫폼·영업 담당자,
        배송담당은 직배송 기사입니다. 담당 거래처 수는 그 직원이 영업담당이나
        배송담당인 거래처 수(미사용 거래처 포함)입니다.
      </p>

      {modal && (
        <EmployeeDialog
          key={modal.mode === "edit" ? `edit-${modal.id}` : "new"}
          modal={modal}
          onClose={closeModal}
        />
      )}

      <ErpDialog
        open={statusRequest !== null}
        onOpenChange={(open) => {
          if (!open && !isStatusPending) setStatusRequest(null)
        }}
        title={`선택 ${statusLabel}`}
        size="md"
        footer={
          <>
            <ActionButton
              variant="secondary"
              size="lg"
              disabled={isStatusPending}
              onClick={() => setStatusRequest(null)}
            >
              취소
            </ActionButton>
            <ActionButton
              size="lg"
              disabled={isStatusPending}
              onClick={confirmStatusChange}
            >
              {isStatusPending && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              {statusLabel}
            </ActionButton>
          </>
        }
      >
        {statusRequest && (
          <div className="flex flex-col gap-2 py-2 text-sm">
            <p>
              체크한{" "}
              <strong className="font-bold text-brand">
                {formatNumber(statusRequest.ids.length, 0)}명
              </strong>
              을 {statusRequest.isActive ? "재직으로" : "퇴사로"} 바꿀까요?
            </p>
            <p className="text-[13px] text-muted-foreground">
              {statusRequest.isActive
                ? "재직으로 바꾼 직원은 거래처의 영업담당·배송담당으로 다시 고를 수 있습니다(담당업무가 체크된 경우). 저장된 퇴사일은 지워집니다."
                : "직원은 지워지지 않습니다. 퇴사 직원은 거래처의 영업담당·배송담당으로 새로 고를 수 없고, 이미 담당인 거래처는 그대로 남습니다. 퇴사일은 직원 수정 창에서 넣을 수 있고, 재직여부를 ‘퇴사’로 조회해 [선택 재직]으로 언제든 되돌릴 수 있습니다."}
            </p>
          </div>
        )}
      </ErpDialog>
    </div>
  )
}

/** The 검색어 box (its text is read from the form when 조회 runs). */
function SearchBox({ initialValue }: { initialValue: string }) {
  const [value, setValue] = useState(initialValue)

  return (
    <Input
      id="employee-search-q"
      name="q"
      type="search"
      placeholder="직원코드, 직원명, 휴대폰, 차량번호"
      className="h-8 w-full max-w-md rounded-sm"
      value={value}
      maxLength={EMPLOYEE_SEARCH_MAX_LENGTH}
      enterKeyHint="search"
      autoComplete="off"
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        // Enter that only finishes a Korean syllable (IME) does not search
        // yet. keyCode 229: Safari's Enter while composing Korean.
        if (
          event.key === "Enter" &&
          (event.nativeEvent.isComposing || event.keyCode === 229)
        ) {
          event.preventDefault()
        }
      }}
    />
  )
}

/** Radio buttons of a list filter (재직여부, 담당업무); apply right away. */
function FilterRadios<Value extends string>({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string
  label: string
  options: readonly { value: Value; label: string }[]
  value: Value
  onChange: (value: Value) => void
}) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next !== value) onChange(next as Value)
      }}
      className="flex w-auto flex-wrap gap-x-4 gap-y-1"
    >
      {options.map((option) => {
        const id = `employee-search-${name}-${option.value}`
        return (
          <label
            key={option.value}
            htmlFor={id}
            className="flex min-h-7 cursor-pointer items-center gap-1.5 text-[13px]"
          >
            <RadioGroupItem id={id} value={option.value} />
            {option.label}
          </label>
        )
      })}
    </RadioGroup>
  )
}

/** "100명씩 보기" select next to the count. */
function PageSizeSelect({
  value,
  onChange,
}: {
  value: EmployeePageSize
  onChange: (pageSize: EmployeePageSize) => void
}) {
  const options = EMPLOYEE_PAGE_SIZES.map((size) => ({
    value: String(size),
    label: `${size}명씩 보기`,
  }))
  return (
    <Select
      items={options}
      value={String(value)}
      onValueChange={(next) => {
        if (next !== null && next !== String(value)) {
          onChange(Number(next) as EmployeePageSize)
        }
      }}
    >
      <SelectTrigger
        aria-label="한 페이지에 보일 직원 수"
        className="h-8 rounded-sm"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The message inside the empty grid, with the next step to take. */
function EmptyMessage({
  emptyState,
  params,
  onCreate,
}: {
  emptyState: EmployeeListEmptyState
  params: EmployeeListParams
  onCreate: () => void
}) {
  if (emptyState === "no-employees") {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="font-bold text-foreground">
          아직 등록된 직원이 없습니다.
        </p>
        <p>
          [신규 | F5]로 직원을 등록해 보세요. 담당업무를 체크한 직원은 거래처의
          영업담당·배송담당으로 고를 수 있습니다.
        </p>
        <ActionButton keyHint="F5" onClick={onCreate}>
          신규
        </ActionButton>
      </div>
    )
  }
  if (emptyState === "all-inactive") {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="font-bold text-foreground">재직 중인 직원이 없습니다.</p>
        <p>등록된 직원이 모두 퇴사 상태입니다.</p>
        <Link
          href={buildEmployeeListHref({
            ...defaultEmployeeListParams,
            status: "all",
            pageSize: params.pageSize,
          })}
          className={actionButtonClassName({ variant: "neutral" })}
        >
          퇴사 직원 포함해서 보기
        </Link>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="font-bold text-foreground">조건에 맞는 직원이 없습니다.</p>
      <p>검색어나 조회 조건을 바꾸거나, 조건을 초기화해 보세요.</p>
      <Link
        href={buildEmployeeListHref({
          ...defaultEmployeeListParams,
          sort: params.sort,
          pageSize: params.pageSize,
        })}
        className={actionButtonClassName({ variant: "neutral" })}
      >
        조건 초기화
      </Link>
    </div>
  )
}

/** The file name from a Content-Disposition header (filename* first). */
function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1])
    } catch {
      // Fall through to the plain file name.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header)
  return plain ? plain[1] : null
}

/** Lets the browser save `blob` as a file called `fileName`. */
function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Give the browser time to start the download before freeing the memory.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
