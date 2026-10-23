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

import { CategoryPickerDialog } from "@/components/category-picker-dialog"
import {
  ActionBar,
  ActionButton,
  actionButtonClassName,
} from "@/components/erp/action-bar"
import { DataGridCount } from "@/components/erp/data-grid"
import { ErpDialog } from "@/components/erp/erp-dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useColumnOrder } from "@/hooks/use-column-order"
import { useHotkeys } from "@/hooks/use-hotkeys"
import type { CategoryNode } from "@/lib/categories/tree"
import { formatNumber } from "@/lib/format"
import {
  countBundlesToDeactivate,
  loadProductCategories,
  setProductsActive,
  type ProductStatusActionResult,
} from "@/lib/products/actions"
import type { ProductListRow } from "@/lib/products/queries"
import {
  buildProductExportHref,
  buildProductListHref,
  buildProductModalHref,
  defaultProductListParams,
  hasProductListFilters,
  parseProductModal,
  PRODUCT_EXPORT_MAX_ROWS,
  PRODUCT_PAGE_SIZES,
  type ProductListParams,
  type ProductModalState,
  type ProductPageSize,
} from "@/lib/products/schema"

import { ProductDialog, type ProductDialogTab } from "./product-dialog"
import {
  PRODUCT_COLUMN_IDS,
  PRODUCT_COLUMN_ORDER_KEY,
  ProductGrid,
} from "./product-grid"
import { ProductPagination } from "./product-pagination"
import {
  PRODUCT_SEARCH_FORM_ID,
  ProductSearchForm,
} from "./product-search-form"

/**
 * Why the list is empty:
 * - "no-products": nothing registered yet
 * - "no-match": nothing matches the search and filters
 * - "all-inactive": products exist, but all are 사용중지 (default filter)
 */
export type ProductListEmptyState =
  "none" | "no-products" | "no-match" | "all-inactive"

/**
 * A 선택 사용중지 / 선택 사용 waiting for the user's OK. For 사용중지,
 * `bundleCount` = the 사용 묶음상품 (not checked) that will be switched off
 * together with the checked 기준상품: null while it is being counted, -1
 * when it could not be counted.
 */
type StatusRequest = {
  isActive: boolean
  ids: string[]
  bundleCount: number | null
}

/** A modal opened from another one, and the tab to show when coming back. */
type ReturnTo = { productId: string; tab: ProductDialogTab }

/**
 * The 상품관리 screen below the page title, like a classic ERP list:
 * action buttons (조회 F4, 신규 F5, 선택 사용중지, 선택 사용, 엑셀 Ctrl+F9),
 * the 조회 conditions, "N건 / 총 M건", the grid and the page links, plus the
 * 상품 등록/수정 modal.
 *
 * Everything that should survive a refresh or the back button is in the URL:
 * the conditions and page (?q=...&category=...&page=2) and the open modal
 * (?modal=new or ?modal=edit&id=…). Opening the modal adds a history entry
 * without reloading the list, so the browser's back button closes it.
 */
export function ProductListScreen({
  params,
  categories,
  rows,
  total,
  pageCount,
  emptyState,
}: {
  /** Conditions of the loaded list (from the URL; page clamped). */
  params: ProductListParams
  /** All categories, including switched-off ones. */
  categories: CategoryNode[]
  rows: ProductListRow[]
  /** Products matching the conditions (all pages). */
  total: number
  pageCount: number
  emptyState: ProductListEmptyState
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const modal = parseProductModal(searchParams)

  const [isPending, startTransition] = useTransition()
  // The conditions as the user just chose them. While the new list is
  // loading, `params` is still the old one; the inputs show `shown` right
  // away, and a second quick change builds on the first instead of undoing it.
  const [shown, setShown] = useOptimistic(params)
  const searchFormRef = useRef<HTMLFormElement>(null)
  // The grid's column order as this browser's user arranged it.
  const columns = useColumnOrder(PRODUCT_COLUMN_ORDER_KEY, PRODUCT_COLUMN_IDS)

  // Checked rows (for 선택 사용중지 / 선택 사용) and the current row. When a
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
  // Counting the 묶음상품 for the 사용중지 warning.
  const [, startCountTransition] = useTransition()
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [isReloading, startReload] = useTransition()
  // Categories read again when a picker opens (e.g. added meanwhile in the
  // 상품분류설정 tab). Used until the server sends a new `categories` list.
  const [reloaded, setReloaded] = useState<{
    from: CategoryNode[]
    tree: CategoryNode[]
  } | null>(null)
  const shownCategories =
    reloaded && reloaded.from === categories ? reloaded.tree : categories

  // The modal URLs this screen added to the history, oldest first (see
  // openModal / closeModal).
  const pushedModalUrlsRef = useRef<string[]>([])
  // Only the latest "how many 묶음상품" count is used.
  const bundleCountRequestRef = useRef(0)
  // A 기준상품 modal that opened another one (its 묶음상품 tab): show that
  // tab again when the user comes back to it.
  const [returnTo, setReturnTo] = useState<ReturnTo | null>(null)
  if (modal === null && returnTo !== null) setReturnTo(null)

  // Next.js keeps this page (hidden) when the user goes to another page.
  // Small dialogs are a passing step, not something to come back to: close
  // them when the page is hidden. (The 상품 modal follows the URL instead.)
  useLayoutEffect(() => {
    return () => {
      setStatusRequest(null)
      setCategoryPickerOpen(false)
    }
  }, [])

  // ---- 조회 -----------------------------------------------------------------

  function openList(next: ProductListParams) {
    const href = buildProductListHref(next)
    startTransition(() => {
      setShown(next)
      // 조회 with unchanged conditions reads the list again.
      if (href === buildProductListHref(params)) {
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
  function applyFilters(changes: Partial<ProductListParams>) {
    openList({ ...shown, q: typedSearch(), ...changes, page: 1 })
  }

  function resetFilters() {
    openList({
      ...defaultProductListParams,
      sort: shown.sort,
      pageSize: shown.pageSize,
    })
  }

  // ---- Modal (in the URL) ---------------------------------------------------

  function openModal(state: ProductModalState) {
    window.history.pushState(
      null,
      "",
      buildProductModalHref(window.location.search, state)
    )
    // Remember it in the browser's own spelling, to compare it later.
    pushedModalUrlsRef.current.push(
      window.location.pathname + window.location.search
    )
  }

  /** New product: 묶음상품 selected when the list shows only 묶음상품. */
  function openNewModal() {
    openModal({
      mode: "new",
      productType: shown.productType === "bundle" ? "bundle" : "base",
    })
  }

  /**
   * Another 상품 modal opened from the current one (a 묶음상품 from a
   * 기준상품's 묶음상품 tab, or a 기준상품 from a 묶음상품's 구성상품). It
   * gets its own history entry, so closing it (or the back button) returns
   * to the first modal, on `returnTab`.
   */
  function openModalFromModal(
    next: ProductModalState,
    returnTab: ProductDialogTab
  ) {
    if (modal?.mode === "edit") {
      setReturnTo({ productId: modal.id, tab: returnTab })
    }
    openModal(next)
  }

  function closeModal() {
    const current = window.location.pathname + window.location.search
    const pushed = pushedModalUrlsRef.current
    const index = pushed.lastIndexOf(current)
    if (index >= 0) {
      // We added this entry: going back removes it (back to the list, or to
      // the modal this one was opened from), so the browser's back button
      // later does not reopen it.
      pushed.splice(index)
      window.history.back()
    } else {
      // Opened from a link or a refresh: just drop the modal from the URL.
      window.history.replaceState(
        null,
        "",
        buildProductModalHref(window.location.search, null)
      )
    }
  }

  /** Reads the categories again (the pickers call this when they open). */
  function reloadCategories() {
    const from = categories
    startReload(async () => {
      try {
        const tree = await loadProductCategories()
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

  // ---- 선택 사용중지 / 선택 사용 ----------------------------------------------

  const checkedRows = rows.filter((row) => checkedIds.has(row.id))

  function requestStatusChange(isActive: boolean) {
    if (checkedRows.length === 0) {
      toast.info(
        isActive
          ? "사용으로 바꿀 상품을 먼저 체크해 주세요."
          : "사용중지할 상품을 먼저 체크해 주세요."
      )
      return
    }
    const ids = checkedRows.map((row) => row.id)
    // 사용중지 of a 기준상품 also switches off the 사용 묶음상품 that
    // contain it: count them for the warning. (Only 묶음상품 checked:
    // nothing else changes.)
    const needsCount =
      !isActive && checkedRows.some((row) => row.productType === "base")
    setStatusRequest({ isActive, ids, bundleCount: needsCount ? null : 0 })
    if (!needsCount) return

    const request = ++bundleCountRequestRef.current
    // In a transition, so a redirect from the server (e.g. to the login page
    // when the session has expired) is carried out by Next.js.
    startCountTransition(async () => {
      let count: number
      try {
        count = await countBundlesToDeactivate(ids)
      } catch (error) {
        unstable_rethrow(error)
        console.error(error)
        count = -1
      }
      if (request !== bundleCountRequestRef.current) return
      setStatusRequest((current) =>
        current?.ids === ids ? { ...current, bundleCount: count } : current
      )
    })
  }

  function confirmStatusChange() {
    if (!statusRequest || isStatusPending) return
    if (statusRequest.bundleCount === null) return
    const { isActive, ids } = statusRequest
    const stateLabel = isActive ? "사용" : "사용중지"

    startStatusTransition(async () => {
      let result: ProductStatusActionResult
      try {
        result = await setProductsActive(ids, isActive)
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
      const notes: string[] = []
      if (result.unchanged > 0) {
        notes.push(
          `${formatNumber(result.unchanged, 0)}개는 이미 ${stateLabel} 상태였습니다.`
        )
      }
      if (result.bundlesDeactivated > 0) {
        notes.push(
          `기준상품이 들어간 묶음상품 ${formatNumber(result.bundlesDeactivated, 0)}개도 함께 사용중지했습니다.`
        )
      }
      if (result.blocked > 0) {
        notes.push(
          `묶음상품 ${formatNumber(result.blocked, 0)}개는 사용중지된 기준상품이 들어 있어 바꾸지 못했습니다.`
        )
      }
      const title =
        result.changed > 0
          ? `${formatNumber(result.changed, 0)}개 상품을 ${stateLabel}${isActive ? "으로 바꿨습니다" : "했습니다"}.`
          : "바뀐 상품이 없습니다."
      const show = result.blocked > 0 ? toast.warning : toast.success
      show(title, {
        description: notes.length > 0 ? notes.join(" ") : undefined,
      })
    })
  }

  // ---- 엑셀 -----------------------------------------------------------------

  async function downloadExcel() {
    if (isExporting) return
    if (total === 0) {
      toast.info("내려받을 상품이 없습니다. 조회 조건을 확인해 주세요.")
      return
    }
    if (
      total > PRODUCT_EXPORT_MAX_ROWS &&
      !window.confirm(
        `조회된 상품이 ${formatNumber(total, 0)}건입니다. 엑셀에는 앞의 ${formatNumber(PRODUCT_EXPORT_MAX_ROWS, 0)}건만 담깁니다. 계속할까요?`
      )
    ) {
      return
    }

    setIsExporting(true)
    const toastId = toast.loading("엑셀 파일을 만드는 중입니다…")
    try {
      const response = await fetch(buildProductExportHref(params), {
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
          {
            id: toastId,
          }
        )
        return
      }
      if (!response.ok) throw new Error(`Export failed: ${response.status}`)

      const blob = await response.blob()
      const fileName =
        fileNameFromDisposition(response.headers.get("content-disposition")) ??
        "상품목록.csv"
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
  // Off while the 상품 modal is open (it has its own keys); ignored while a
  // smaller dialog is open on top of the list.
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

  const statusLabel = statusRequest?.isActive ? "사용" : "사용중지"

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <ActionBar
        end={
          <>
            <ActionButton
              variant="neutral"
              disabled={!hasProductListFilters(shown)}
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
        <ActionButton type="submit" form={PRODUCT_SEARCH_FORM_ID} keyHint="F4">
          조회
        </ActionButton>
        <ActionButton keyHint="F5" onClick={openNewModal}>
          신규
        </ActionButton>
        <ActionButton
          variant="secondary"
          onClick={() => requestStatusChange(false)}
        >
          선택 사용중지
        </ActionButton>
        <ActionButton
          variant="secondary"
          onClick={() => requestStatusChange(true)}
        >
          선택 사용
        </ActionButton>
      </ActionBar>

      <ProductSearchForm
        formRef={searchFormRef}
        shown={shown}
        categories={shownCategories}
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
        <ProductGrid
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
        <ProductPagination
          params={params}
          page={params.page}
          pageCount={pageCount}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        단가는 원 단위입니다. 부가세 포함은 입력한 금액, 부가세 별도는 자동
        계산한 금액(원 미만 부가세 버림)입니다. 부가세 포함 금액이 있는데 부가세
        별도가 &apos;-&apos;이면, 구성상품 중 가격이 비어 있는 혼합 묶음상품이라
        계산할 수 없는 경우입니다(상품을 열면 이유가 보입니다). 상품명을
        누르거나 줄을 두 번 누르면(또는 줄을 고르고 Enter) 수정 창이 열립니다.
        열 제목을 누르면 정렬(▲→▼→기본), 끌어 놓으면 열 순서가 바뀝니다(이
        브라우저에 기억).
      </p>

      {modal && (
        <ProductDialog
          key={
            modal.mode === "edit"
              ? `edit-${modal.id}`
              : `new-${modal.productType ?? "base"}-${modal.baseProductId ?? ""}`
          }
          modal={modal}
          initialTab={
            modal.mode === "edit" && returnTo?.productId === modal.id
              ? returnTo.tab
              : undefined
          }
          categories={shownCategories}
          onClose={closeModal}
          onOpenModal={openModalFromModal}
          onReloadCategories={reloadCategories}
          reloadingCategories={isReloading}
        />
      )}

      <CategoryPickerDialog
        open={categoryPickerOpen}
        onOpenChange={setCategoryPickerOpen}
        categories={shownCategories}
        value={shown.categoryId}
        purpose="filter"
        title="상품분류 선택 (조회 조건)"
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
              disabled={isStatusPending || statusRequest?.bundleCount === null}
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
              상품을 {statusLabel}
              {statusRequest.isActive ? "으로 바꿀까요?" : "할까요?"}
            </p>
            {!statusRequest.isActive && (
              <BundleCascadeNote count={statusRequest.bundleCount} />
            )}
            <p className="text-[13px] text-muted-foreground">
              {statusRequest.isActive
                ? "사용으로 바꾼 상품은 목록 기본 화면(사용여부 ‘사용’)에 다시 나타납니다. 묶음상품은 들어 있는 기준상품이 모두 사용 중일 때만 사용으로 바뀝니다."
                : "상품은 지워지지 않습니다. 사용중지한 상품은 목록 기본 화면에서 빠지고, 사용여부를 ‘사용중지’로 조회해 [선택 사용]으로 언제든 되돌릴 수 있습니다. 기준상품을 다시 사용으로 바꿔도 묶음상품은 자동으로 사용되지 않습니다."}
            </p>
          </div>
        )}
      </ErpDialog>
    </div>
  )
}

/**
 * 선택 사용중지: "체크한 기준상품이 들어간 묶음상품 N개도 함께
 * 사용중지됩니다" (`count` null = still counting, -1 = could not be counted).
 */
function BundleCascadeNote({ count }: { count: number | null }) {
  if (count === null) {
    return (
      <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <LoaderCircleIcon aria-hidden="true" className="size-4 animate-spin" />
        함께 사용중지될 묶음상품을 확인하는 중…
      </p>
    )
  }
  if (count < 0) {
    return (
      <p role="alert" className="text-[13px] font-bold text-destructive">
        기준상품을 사용중지하면 그 기준상품이 들어간 묶음상품도 함께
        사용중지됩니다. (몇 개인지 확인하지 못했습니다.)
      </p>
    )
  }
  if (count === 0) return null
  return (
    <p role="alert" className="text-[13px] font-bold text-destructive">
      체크한 기준상품이 들어간 묶음상품 {formatNumber(count, 0)}개도 함께
      사용중지됩니다.
    </p>
  )
}

/** "100개씩 보기" select next to the count. */
function PageSizeSelect({
  value,
  onChange,
}: {
  value: ProductPageSize
  onChange: (pageSize: ProductPageSize) => void
}) {
  const options = PRODUCT_PAGE_SIZES.map((size) => ({
    value: String(size),
    label: `${size}개씩 보기`,
  }))
  return (
    <Select
      items={options}
      value={String(value)}
      onValueChange={(next) => {
        if (next !== null && next !== String(value)) {
          onChange(Number(next) as ProductPageSize)
        }
      }}
    >
      <SelectTrigger
        aria-label="한 페이지에 보일 상품 수"
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
  emptyState: ProductListEmptyState
  params: ProductListParams
  onCreate: () => void
}) {
  if (emptyState === "no-products") {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="font-bold text-foreground">
          아직 등록된 상품이 없습니다.
        </p>
        <p>
          [신규 | F5]로 첫 상품을 등록해 보세요. 분류가 없어도 등록할 수
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
        <p className="font-bold text-foreground">사용 중인 상품이 없습니다.</p>
        <p>등록된 상품이 모두 사용중지 상태입니다.</p>
        <Link
          href={buildProductListHref({
            ...defaultProductListParams,
            status: "all",
            pageSize: params.pageSize,
          })}
          className={actionButtonClassName({ variant: "neutral" })}
        >
          사용중지된 상품 포함해서 보기
        </Link>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="font-bold text-foreground">조건에 맞는 상품이 없습니다.</p>
      <p>검색어나 조회 조건을 바꾸거나, 조건을 초기화해 보세요.</p>
      <Link
        href={buildProductListHref({
          ...defaultProductListParams,
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
