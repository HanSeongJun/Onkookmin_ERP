"use client"

import { LoaderCircleIcon } from "lucide-react"
import Link from "next/link"
import { unstable_rethrow, useRouter } from "next/navigation"
import {
  useEffect,
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
import {
  loadPartnerCategories,
  setPartnersCategory,
  type PartnerCategoryAssignResult,
} from "@/lib/partner-categories/actions"
import type { PartnerCategoryNode } from "@/lib/partner-categories/tree"
import type { PartnerListRow } from "@/lib/partners/queries"
import {
  buildPartnerListHref,
  defaultPartnerListParams,
  hasPartnerListFilters,
  PARTNER_CATEGORIES_PATH,
  PARTNER_CATEGORY_SCREEN_COLUMN_IDS,
  PARTNER_CATEGORY_SCREEN_COLUMN_ORDER_KEY,
  PARTNER_CATEGORY_SCREEN_COLUMNS,
  PARTNER_PAGE_SIZES,
  partnerColumnTitle,
  type PartnerCategoryScreenColumnId,
  type PartnerColumnId,
  type PartnerListParams,
  type PartnerPageSize,
} from "@/lib/partners/schema"

import { PartnerGrid } from "../_components/partner-grid"
import type { PartnerListEmptyState } from "../_components/partner-list-screen"
import { PartnerPagination } from "../_components/partner-pagination"
import { PartnerCategorySettingsDialog } from "./partner-category-settings-dialog"
import {
  PARTNER_CATEGORY_SEARCH_FORM_ID,
  PartnerCategorySearchForm,
} from "./partner-category-search-form"
import { PARTNER_CATEGORY_SETTINGS_PARAM } from "./settings-link"

/** Title of a grid column on this screen ("category" is 적용분류). */
function screenColumnTitle(id: PartnerColumnId): string {
  return (
    PARTNER_CATEGORY_SCREEN_COLUMNS.find((column) => column.id === id)?.title ??
    partnerColumnTitle(id)
  )
}

function isScreenColumn(
  id: PartnerColumnId
): id is PartnerCategoryScreenColumnId {
  return (PARTNER_CATEGORY_SCREEN_COLUMN_IDS as readonly string[]).includes(id)
}

/**
 * The 거래처분류설정 screen below the page title, like the reference
 * screen:
 * - action buttons [조회 | F4] [분류적용 | F8] [분류해제], and on the right
 *   [조건 초기화] [분류값 설정];
 * - the 조회 conditions, "N건 / 총 M건", the partner grid (거래처코드,
 *   거래처명, 구분, 영업담당, 배송담당, 적용분류, 사용여부; sort and move
 *   columns like the other lists) and the page links.
 *
 * 분류적용 opens the 3-level picker (사용 categories only) and puts every
 * checked partner into the chosen category in one request; 분류해제 asks
 * first, then makes them 미분류. The conditions and page are in the URL
 * (/partners/categories?q=…&category=…&page=2), like 거래처관리.
 */
export function PartnerCategoryScreen({
  params,
  categories,
  employees,
  rows,
  total,
  pageCount,
  emptyState,
  openSettingsOnLoad,
}: {
  /** Conditions of the loaded list (from the URL; page clamped). */
  params: PartnerListParams
  /** Every 거래처분류 as a tree, 사용 중지 too. */
  categories: PartnerCategoryNode[]
  /** Every employee, 퇴사 too (for the 영업담당 filter). */
  employees: EmployeeOption[]
  rows: PartnerListRow[]
  /** Partners matching the conditions (all pages). */
  total: number
  pageCount: number
  emptyState: PartnerListEmptyState
  /** Open 분류값 설정 right away (?settings=1, e.g. from another tab). */
  openSettingsOnLoad: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // The conditions as the user just chose them (see PartnerListScreen).
  const [shown, setShown] = useOptimistic(params)
  const searchFormRef = useRef<HTMLFormElement>(null)
  const columns = useColumnOrder(
    PARTNER_CATEGORY_SCREEN_COLUMN_ORDER_KEY,
    PARTNER_CATEGORY_SCREEN_COLUMN_IDS
  )

  // Checked rows and the current row. When a new list arrives, only the
  // checks of rows that are still shown are kept.
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

  // Which picker is open: the 적용분류 filter, or 분류적용 for the
  // checked partners.
  const [picker, setPicker] = useState<"filter" | "assign" | null>(null)
  // 분류해제 waiting for the user's OK (the checked partners' ids).
  const [clearRequest, setClearRequest] = useState<string[] | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(openSettingsOnLoad)
  const [isAssigning, startAssign] = useTransition()

  const [isReloading, startReload] = useTransition()
  // Categories read again when a picker opens (e.g. changed in another
  // tab). Used until the server sends a new list.
  const [reloaded, setReloaded] = useState<{
    from: PartnerCategoryNode[]
    tree: PartnerCategoryNode[]
  } | null>(null)
  const shownCategories =
    reloaded && reloaded.from === categories ? reloaded.tree : categories

  // ?settings=1 opened 분류값 설정: take it out of the address, so a
  // refresh after closing the window does not open it again.
  useEffect(() => {
    if (!openSettingsOnLoad) return
    const url = new URL(window.location.href)
    if (!url.searchParams.has(PARTNER_CATEGORY_SETTINGS_PARAM)) return
    url.searchParams.delete(PARTNER_CATEGORY_SETTINGS_PARAM)
    window.history.replaceState(null, "", url.pathname + url.search)
  }, [openSettingsOnLoad])

  // Next.js keeps this page (hidden) when the user goes to another page:
  // close the small dialogs then. (분류값 설정 asks before it closes, so it
  // stays.)
  useLayoutEffect(() => {
    return () => {
      setPicker(null)
      setClearRequest(null)
    }
  }, [])

  // ---- 조회 -----------------------------------------------------------------

  function openList(next: PartnerListParams) {
    const href = buildPartnerListHref(next, PARTNER_CATEGORIES_PATH)
    startTransition(() => {
      setShown(next)
      // 조회 with unchanged conditions reads the list again.
      if (href === buildPartnerListHref(params, PARTNER_CATEGORIES_PATH)) {
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

  /** Reads the categories again (the pickers call this when they open). */
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

  function openPicker(kind: "filter" | "assign") {
    setPicker(kind)
    reloadCategories()
  }

  // ---- 분류적용 / 분류해제 ------------------------------------------------------

  const checkedRows = rows.filter((row) => checkedIds.has(row.id))

  function requestAssign() {
    if (isAssigning) return
    if (checkedRows.length === 0) {
      toast.info("분류를 적용할 거래처를 먼저 체크해 주세요.")
      return
    }
    openPicker("assign")
  }

  function requestClear() {
    if (isAssigning) return
    if (checkedRows.length === 0) {
      toast.info("분류를 해제할 거래처를 먼저 체크해 주세요.")
      return
    }
    setClearRequest(checkedRows.map((row) => row.id))
  }

  /** 분류적용 (a category id) or 분류해제 (null) for these partners. */
  function assign(ids: string[], categoryId: string | null) {
    // In a transition, so a redirect from the server (e.g. to the login
    // page when the session has expired) is carried out by Next.js.
    startAssign(async () => {
      let result: PartnerCategoryAssignResult
      try {
        result = await setPartnersCategory(ids, categoryId)
      } catch (error) {
        unstable_rethrow(error)
        console.error(error)
        toast.error(
          categoryId === null
            ? "분류를 해제하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
            : "분류를 적용하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
        )
        return
      }
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      setClearRequest(null)
      // Done with these rows: start the next selection from scratch.
      setCheckedIds(new Set())
      toast.success(result.message)
    })
  }

  // ---- Keyboard ---------------------------------------------------------------

  // F4 = 조회, F8 = 분류적용. Off while a dialog is open (분류값 설정 has
  // its own F8 = 저장).
  useHotkeys(
    {
      F4: () => searchFormRef.current?.requestSubmit(),
      F8: requestAssign,
    },
    { enabled: picker === null && clearRequest === null && !settingsOpen }
  )

  // ---- Screen ---------------------------------------------------------------

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
            <ActionButton onClick={() => setSettingsOpen(true)}>
              분류값 설정
            </ActionButton>
          </>
        }
      >
        <ActionButton
          type="submit"
          form={PARTNER_CATEGORY_SEARCH_FORM_ID}
          keyHint="F4"
        >
          조회
        </ActionButton>
        <ActionButton
          keyHint="F8"
          disabled={isAssigning}
          onClick={requestAssign}
        >
          분류적용
        </ActionButton>
        <ActionButton
          variant="secondary"
          disabled={isAssigning}
          onClick={requestClear}
        >
          분류해제
        </ActionButton>
      </ActionBar>

      <PartnerCategorySearchForm
        formRef={searchFormRef}
        shown={shown}
        categories={shownCategories}
        employees={employees}
        onSearch={(q) => applyFilters({ q })}
        onChange={applyFilters}
        onOpenCategoryPicker={() => openPicker("filter")}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex items-center gap-2">
          <DataGridCount shown={rows.length} total={total} />
          {checkedRows.length > 0 && (
            <span className="text-[13px] text-muted-foreground">
              (체크 {formatNumber(checkedRows.length, 0)}건)
            </span>
          )}
          {(isPending || isAssigning) && (
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
          ariaLabel="거래처분류 적용 목록"
          rows={rows}
          checkedIds={checkedIds}
          onCheckedIdsChange={setCheckedIds}
          activeId={activeId}
          onActiveIdChange={setActiveId}
          columnOrder={columns.order}
          onColumnOrderChange={(order) =>
            columns.setOrder(order.filter(isScreenColumn))
          }
          columnTitle={screenColumnTitle}
          className="min-w-[56rem]"
          sort={shown.sort}
          onSortChange={(sort) => applyFilters({ sort })}
          empty={<EmptyMessage emptyState={emptyState} params={params} />}
        />
        <PartnerPagination
          params={params}
          page={params.page}
          pageCount={pageCount}
          basePath={PARTNER_CATEGORIES_PATH}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        거래처를 체크한 뒤 [분류적용]을 누르면 고른 분류(대분류·중분류·소분류
        어느 단계든)에 한 번에 들어갑니다. 적용분류로 조회하면 그 아래 분류의
        거래처도 함께 나옵니다. 거래처명을 누르면 새 탭에서 거래처 수정 창이
        열립니다.
      </p>

      <PartnerCategoryPickerDialog
        open={picker === "filter"}
        onOpenChange={(open) => {
          if (!open) setPicker(null)
        }}
        categories={shownCategories}
        value={shown.categoryId}
        purpose="filter"
        title="적용분류 선택 (조회 조건)"
        settingsHref={null}
        onConfirm={(category) =>
          applyFilters({ categoryId: category.id, uncategorized: false })
        }
        onReload={reloadCategories}
        reloading={isReloading}
      />

      <PartnerCategoryPickerDialog
        open={picker === "assign"}
        onOpenChange={(open) => {
          if (!open) setPicker(null)
        }}
        categories={shownCategories}
        value={null}
        purpose="assign"
        title="분류적용"
        confirmLabel="분류적용"
        description={`체크한 거래처 ${formatNumber(checkedRows.length, 0)}개를 고른 분류에 넣습니다. 대분류·중분류·소분류 중 어느 단계든 고를 수 있고, 사용 중지된 분류는 보이지 않습니다.`}
        settingsHref={null}
        onConfirm={(category) =>
          assign(
            checkedRows.map((row) => row.id),
            category.id
          )
        }
        onReload={reloadCategories}
        reloading={isReloading}
      />

      <ErpDialog
        open={clearRequest !== null}
        onOpenChange={(open) => {
          if (!open && !isAssigning) setClearRequest(null)
        }}
        title="분류해제"
        size="md"
        footer={
          <>
            <ActionButton
              variant="secondary"
              size="lg"
              disabled={isAssigning}
              onClick={() => setClearRequest(null)}
            >
              취소
            </ActionButton>
            <ActionButton
              size="lg"
              disabled={isAssigning}
              onClick={() => {
                if (clearRequest) assign(clearRequest, null)
              }}
            >
              {isAssigning && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              분류해제
            </ActionButton>
          </>
        }
      >
        {clearRequest && (
          <div className="flex flex-col gap-2 py-2 text-sm">
            <p>
              체크한{" "}
              <strong className="font-bold text-brand">
                {formatNumber(clearRequest.length, 0)}개
              </strong>{" "}
              거래처의 분류를 해제할까요?
            </p>
            <p className="text-[13px] text-muted-foreground">
              분류를 해제한 거래처는 ‘미분류’가 됩니다. 거래처 자체는 그대로
              남고, 언제든 [분류적용]으로 다시 분류에 넣을 수 있습니다.
            </p>
          </div>
        )}
      </ErpDialog>

      {settingsOpen && (
        <PartnerCategorySettingsDialog onClose={() => setSettingsOpen(false)} />
      )}
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
}: {
  emptyState: PartnerListEmptyState
  params: PartnerListParams
}) {
  if (emptyState === "no-partners") {
    return (
      <div className="flex flex-col items-center gap-2">
        <p className="font-bold text-foreground">
          아직 등록된 거래처가 없습니다.
        </p>
        <p>거래처 → 거래처관리에서 거래처를 먼저 등록해 주세요.</p>
        <Link
          href="/partners"
          className={actionButtonClassName({ variant: "neutral" })}
        >
          거래처관리로 가기
        </Link>
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
          href={buildPartnerListHref(
            {
              ...defaultPartnerListParams,
              status: "all",
              pageSize: params.pageSize,
            },
            PARTNER_CATEGORIES_PATH
          )}
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
        href={buildPartnerListHref(
          {
            ...defaultPartnerListParams,
            sort: params.sort,
            pageSize: params.pageSize,
          },
          PARTNER_CATEGORIES_PATH
        )}
        className={actionButtonClassName({ variant: "neutral" })}
      >
        조건 초기화
      </Link>
    </div>
  )
}
