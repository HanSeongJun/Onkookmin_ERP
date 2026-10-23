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
import { PartnerCategoryPickerDialog } from "@/components/partner-category-picker-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useColumnOrder } from "@/hooks/use-column-order"
import { useHotkeys } from "@/hooks/use-hotkeys"
import type { EmployeeOption } from "@/lib/employees/schema"
import { formatNumber } from "@/lib/format"
import { loadPartnerCategories } from "@/lib/partner-categories/actions"
import type { PartnerCategoryNode } from "@/lib/partner-categories/tree"
import {
  setPartnersActive,
  type PartnerStatusActionResult,
} from "@/lib/partners/actions"
import type { PartnerListRow } from "@/lib/partners/queries"
import {
  buildPartnerExportHref,
  buildPartnerListHref,
  buildPartnerModalHref,
  defaultPartnerListParams,
  hasPartnerListFilters,
  PARTNER_COLUMN_IDS,
  PARTNER_COLUMN_ORDER_KEY,
  PARTNER_EXPORT_MAX_ROWS,
  PARTNER_PAGE_SIZES,
  parsePartnerModal,
  type PartnerListParams,
  type PartnerModalState,
  type PartnerPageSize,
} from "@/lib/partners/schema"

import { PartnerDialog } from "./partner-dialog"
import { PartnerGrid } from "./partner-grid"
import { PartnerPagination } from "./partner-pagination"
import {
  PARTNER_SEARCH_FORM_ID,
  PartnerSearchForm,
} from "./partner-search-form"

/**
 * Why the list is empty:
 * - "no-partners": nothing registered yet
 * - "no-match": nothing matches the search and filters
 * - "all-inactive": partners exist, but all are 미사용 (default filter)
 */
export type PartnerListEmptyState =
  "none" | "no-partners" | "no-match" | "all-inactive"

/** A 선택 사용 / 선택 미사용 waiting for the user's OK. */
type StatusRequest = { isActive: boolean; ids: string[] }

/**
 * The 거래처관리 screen below the page title, like a classic ERP list:
 * action buttons (조회 F4, 신규 F5, 선택 사용, 선택 미사용, 엑셀 Ctrl+F9),
 * the 조회 conditions, "N건 / 총 M건", the grid and the page links, plus the
 * 거래처 등록/수정 modal.
 *
 * Everything that should survive a refresh or the back button is in the URL:
 * the conditions and page (?q=...&type=sales&page=2) and the open modal
 * (?modal=new or ?modal=edit&id=…). Opening the modal adds a history entry
 * without reloading the list, so the browser's back button closes it.
 */
export function PartnerListScreen({
  params,
  categories,
  employees,
  rows,
  total,
  pageCount,
  emptyState,
}: {
  /** Conditions of the loaded list (from the URL; page clamped). */
  params: PartnerListParams
  /** Every 거래처분류 as a tree, 사용 중지 too (for the filter). */
  categories: PartnerCategoryNode[]
  /** Every employee, 퇴사 too (for the 영업/배송담당 filters). */
  employees: EmployeeOption[]
  rows: PartnerListRow[]
  /** Partners matching the conditions (all pages). */
  total: number
  pageCount: number
  emptyState: PartnerListEmptyState
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const modal = parsePartnerModal(searchParams)

  const [isPending, startTransition] = useTransition()
  // The conditions as the user just chose them. While the new list is
  // loading, `params` is still the old one; the inputs show `shown` right
  // away, and a second quick change builds on the first instead of undoing it.
  const [shown, setShown] = useOptimistic(params)
  const searchFormRef = useRef<HTMLFormElement>(null)
  // The grid's column order as this browser's user arranged it.
  const columns = useColumnOrder(PARTNER_COLUMN_ORDER_KEY, PARTNER_COLUMN_IDS)

  // Checked rows (for 선택 사용 / 선택 미사용) and the current row. When a
  // new list arrives (other page or conditions, a refresh), only the checks
  // of rows that are still shown are kept.
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
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [isReloading, startReload] = useTransition()
  // Categories read again when the picker opens (e.g. changed meanwhile in
  // the 거래처분류설정 tab). Used until the server sends a new list.
  const [reloaded, setReloaded] = useState<{
    from: PartnerCategoryNode[]
    tree: PartnerCategoryNode[]
  } | null>(null)
  const shownCategories =
    reloaded && reloaded.from === categories ? reloaded.tree : categories

  // The modal URLs this screen added to the history, oldest first (see
  // openModal / closeModal).
  const pushedModalUrlsRef = useRef<string[]>([])

  // Next.js keeps this page (hidden) when the user goes to another page.
  // Small dialogs are a passing step, not something to come back to: close
  // them when the page is hidden. (The 거래처 modal follows the URL instead.)
  useLayoutEffect(() => {
    return () => {
      setStatusRequest(null)
      setCategoryPickerOpen(false)
    }
  }, [])

  // ---- 조회 -----------------------------------------------------------------

  function openList(next: PartnerListParams) {
    const href = buildPartnerListHref(next)
    startTransition(() => {
      setShown(next)
      // 조회 with unchanged conditions reads the list again.
      if (href === buildPartnerListHref(params)) {
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
  function applyFilters(changes: Partial<PartnerListParams>) {
    openList({ ...shown, q: typedSearch(), ...changes, page: 1 })
  }

  function resetFilters() {
    openList({
      ...defaultPartnerListParams,
      sort: shown.sort,
      pageSize: shown.pageSize,
    })
  }

  // ---- Modal (in the URL) ---------------------------------------------------

  // Never router.refresh() while a modal address is shown: Next.js would
  // then stop following later pushState addresses. The modal reads fresh
  // data with Server Actions instead.
  function openModal(state: PartnerModalState) {
    window.history.pushState(
      null,
      "",
      buildPartnerModalHref(window.location.search, state)
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
      // button later does not reopen it.
      pushed.splice(index)
      window.history.back()
    } else {
      // Opened from a link or a refresh: just drop the modal from the URL.
      window.history.replaceState(
        null,
        "",
        buildPartnerModalHref(window.location.search, null)
      )
    }
  }

  /** Reads the categories again (the picker calls this when it opens). */
  function reloadCategories() {
    const from = categories
    startReload(async () => {
      try {
        const tree = await loadPartnerCategories()
        startReload(() => setReloaded({ from, tree }))
      } catch (error) {
        unstable_rethrow(error)
        console.error(error)
        toast.error(
          "분류를 다시 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
        )
      }
    })
  }

  // ---- 선택 사용 / 선택 미사용 -------------------------------------------------

  const checkedRows = rows.filter((row) => checkedIds.has(row.id))

  function requestStatusChange(isActive: boolean) {
    if (checkedRows.length === 0) {
      toast.info(
        isActive
          ? "사용으로 바꿀 거래처를 먼저 체크해 주세요."
          : "미사용으로 바꿀 거래처를 먼저 체크해 주세요."
      )
      return
    }
    setStatusRequest({ isActive, ids: checkedRows.map((row) => row.id) })
  }

  function confirmStatusChange() {
    if (!statusRequest || isStatusPending) return
    const { isActive, ids } = statusRequest
    const stateLabel = isActive ? "사용" : "미사용"

    // In a transition, so a redirect from the server (e.g. to the login
    // page when the session has expired) is carried out by Next.js.
    startStatusTransition(async () => {
      let result: PartnerStatusActionResult
      try {
        result = await setPartnersActive(ids, isActive)
      } catch (error) {
        unstable_rethrow(error)
        console.error(error)
        toast.error(
          "사용 여부를 바꾸지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
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
          ? `${formatNumber(result.changed, 0)}개 거래처를 ${stateLabel}으로 바꿨습니다.`
          : "바뀐 거래처가 없습니다.",
        {
          description:
            result.unchanged > 0
              ? `${formatNumber(result.unchanged, 0)}개는 이미 ${stateLabel} 상태였습니다.`
              : undefined,
        }
      )
    })
  }

  // ---- 엑셀 -----------------------------------------------------------------

  async function downloadExcel() {
    if (isExporting) return
    if (total === 0) {
      toast.info("내려받을 거래처가 없습니다. 조회 조건을 확인해 주세요.")
      return
    }
    if (
      total > PARTNER_EXPORT_MAX_ROWS &&
      !window.confirm(
        `조회된 거래처가 ${formatNumber(total, 0)}건입니다. 엑셀에는 앞의 ${formatNumber(PARTNER_EXPORT_MAX_ROWS, 0)}건만 담깁니다. 계속할까요?`
      )
    ) {
      return
    }

    setIsExporting(true)
    const toastId = toast.loading("엑셀 파일을 만드는 중입니다…")
    try {
      const response = await fetch(buildPartnerExportHref(params), {
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
        "거래처목록.csv"
      saveFile(blob, fileName)
      const rowCount = Number(response.headers.get("x-export-rows"))
      toast.success(
        Number.isFinite(rowCount)
          ? `엑셀 파일(${fileName})을 내려받았습니다. ${formatNumber(rowCount, 0)}건`
          : `엑셀 파일(${fileName})을 내려받았습니다.`,
        { id: toastId }
      )
    } catch (error) {
      console.error(error)
      toast.error(
        "엑셀 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
        {
          id: toastId,
        }
      )
    } finally {
      setIsExporting(false)
    }
  }

  // ---- Keyboard ---------------------------------------------------------------

  // F4 = 조회, F5 = 신규 (instead of reloading the page), Ctrl+F9 = 엑셀.
  // Off while the 거래처 modal is open (it has its own keys); ignored while
  // the confirm dialog is open on top of the list.
  const smallDialogOpen = statusRequest !== null || categoryPickerOpen
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

  const statusLabel = statusRequest?.isActive ? "사용" : "미사용"

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <ActionBar
        end={
          <>
            <ActionButton
              variant="neutral"
              disabled={!hasPartnerListFilters(shown)}
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
        <ActionButton type="submit" form={PARTNER_SEARCH_FORM_ID} keyHint="F4">
          조회
        </ActionButton>
        <ActionButton keyHint="F5" onClick={openNewModal}>
          신규
        </ActionButton>
        <ActionButton
          variant="secondary"
          onClick={() => requestStatusChange(true)}
        >
          선택 사용
        </ActionButton>
        <ActionButton
          variant="secondary"
          onClick={() => requestStatusChange(false)}
        >
          선택 미사용
        </ActionButton>
      </ActionBar>

      <PartnerSearchForm
        formRef={searchFormRef}
        shown={shown}
        categories={shownCategories}
        employees={employees}
        onSearch={(q) => applyFilters({ q })}
        onChange={applyFilters}
        onOpenCategoryPicker={() => {
          setCategoryPickerOpen(true)
          reloadCategories()
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <DataGridCount shown={rows.length} total={total} />
          {checkedRows.length > 0 && (
            <span className="text-[13px] text-muted-foreground">
              (체크 {formatNumber(checkedRows.length, 0)}건)
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
        <PartnerGrid
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
        <PartnerPagination
          params={params}
          page={params.page}
          pageCount={pageCount}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        거래처명을 누르거나 줄을 두 번 누르면(또는 줄을 고르고 Enter) 수정 창이
        열립니다. 열 제목을 누르면 정렬(▲→▼→기본), 끌어 놓으면 열 순서가
        바뀝니다(이 브라우저에 기억). 구분 ‘매출처’·‘매입처’로 조회하면
        매출·매입 거래처도 함께 나옵니다.
      </p>

      {modal && (
        <PartnerDialog
          key={modal.mode === "edit" ? `edit-${modal.id}` : "new"}
          modal={modal}
          onClose={closeModal}
        />
      )}

      <PartnerCategoryPickerDialog
        open={categoryPickerOpen}
        onOpenChange={setCategoryPickerOpen}
        categories={shownCategories}
        value={shown.categoryId}
        purpose="filter"
        title="거래처분류 선택 (조회 조건)"
        onConfirm={(category) =>
          applyFilters({ categoryId: category.id, uncategorized: false })
        }
        onReload={reloadCategories}
        reloading={isReloading}
      />

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
                {formatNumber(statusRequest.ids.length, 0)}개
              </strong>{" "}
              거래처를 {statusLabel}으로 바꿀까요?
            </p>
            <p className="text-[13px] text-muted-foreground">
              {statusRequest.isActive
                ? "사용으로 바꾼 거래처는 목록 기본 화면(사용여부 ‘사용’)에 다시 나타납니다."
                : "거래처는 지워지지 않습니다. 미사용 거래처는 목록 기본 화면에서 빠지고, 사용여부를 ‘미사용’으로 조회해 [선택 사용]으로 언제든 되돌릴 수 있습니다."}
            </p>
          </div>
        )}
      </ErpDialog>
    </div>
  )
}

/** "100개씩 보기" select next to the count. */
function PageSizeSelect({
  value,
  onChange,
}: {
  value: PartnerPageSize
  onChange: (pageSize: PartnerPageSize) => void
}) {
  const options = PARTNER_PAGE_SIZES.map((size) => ({
    value: String(size),
    label: `${size}개씩 보기`,
  }))
  return (
    <Select
      items={options}
      value={String(value)}
      onValueChange={(next) => {
        if (next !== null && next !== String(value)) {
          onChange(Number(next) as PartnerPageSize)
        }
      }}
    >
      <SelectTrigger
        aria-label="한 페이지에 보일 거래처 수"
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
  emptyState: PartnerListEmptyState
  params: PartnerListParams
  onCreate: () => void
}) {
  if (emptyState === "no-partners") {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="font-bold text-foreground">
          아직 등록된 거래처가 없습니다.
        </p>
        <p>
          [신규 | F5]로 첫 거래처를 등록해 보세요. 분류가 없어도 등록할 수
          있습니다(미분류).
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
        <p className="font-bold text-foreground">
          사용 중인 거래처가 없습니다.
        </p>
        <p>등록된 거래처가 모두 미사용 상태입니다.</p>
        <Link
          href={buildPartnerListHref({
            ...defaultPartnerListParams,
            status: "all",
            pageSize: params.pageSize,
          })}
          className={actionButtonClassName({ variant: "neutral" })}
        >
          미사용 거래처 포함해서 보기
        </Link>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="font-bold text-foreground">
        조건에 맞는 거래처가 없습니다.
      </p>
      <p>검색어나 조회 조건을 바꾸거나, 조건을 초기화해 보세요.</p>
      <Link
        href={buildPartnerListHref({
          ...defaultPartnerListParams,
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
