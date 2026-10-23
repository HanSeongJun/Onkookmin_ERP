"use client"

import {
  ExternalLinkIcon,
  LoaderCircleIcon,
  MinusIcon,
  PlusIcon,
  RotateCwIcon,
  SearchIcon,
} from "lucide-react"
import { useId, useState } from "react"

import { PARTNER_CATEGORY_SETTINGS_HREF } from "@/app/(app)/partners/categories/settings-link"
import { ActionButton, ActionLink } from "@/components/erp/action-bar"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { Input } from "@/components/ui/input"
import { formatNumber } from "@/lib/format"
import {
  CATEGORY_LEVEL_LABELS,
  countPartnersInSubtree,
  findCategoryPath,
  flattenCategoryTree,
  formatCategoryPath,
  isCategorySelectable,
  type PartnerCategoryNode,
} from "@/lib/partner-categories/tree"
import { cn } from "@/lib/utils"

/**
 * What the picker is used for:
 * - "assign": put partners into a category (거래처 등록·수정, 분류적용).
 *   Only categories that are 사용 together with every category above them
 *   can be chosen; a switched-off category hides its whole subtree. The
 *   partner's saved category (`keepCategoryId`) stays choosable even when
 *   it was switched off later, and the ones above it stay visible.
 * - "filter": search the partner list. Every category can be chosen
 *   (partners may still be in switched-off ones); they are marked
 *   "사용 중지".
 */
export type PartnerCategoryPickerPurpose = "assign" | "filter"

/**
 * 거래처분류 선택 dialog: the 대분류 → 중분류 → 소분류 tree with +/− to
 * open and close levels, and a search box that lists every matching
 * category with its full path. Any level can be chosen; [확인] (or a
 * double-click) returns the chosen category.
 *
 * The tree comes in as a prop, so this component never reads the database
 * itself. `onReload` (e.g. calling loadPartnerCategories) shows a
 * "다시 불러오기" button for categories just changed in another tab.
 *
 * @example
 * <PartnerCategoryPickerDialog
 *   open={pickerOpen}
 *   onOpenChange={setPickerOpen}
 *   categories={categories}
 *   value={categoryId}
 *   purpose="assign"
 *   onConfirm={(category) => setCategoryId(category.id)}
 * />
 */
export function PartnerCategoryPickerDialog({
  open,
  onOpenChange,
  categories,
  value,
  keepCategoryId = null,
  onConfirm,
  purpose = "assign",
  title = "거래처분류 선택",
  description,
  confirmLabel = "확인",
  onReload,
  reloading = false,
  settingsHref = PARTNER_CATEGORY_SETTINGS_HREF,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Every category as a tree, including switched-off ones. */
  categories: PartnerCategoryNode[]
  /** The category chosen now (pre-selected when it opens), or null. */
  value: string | null
  /**
   * purpose "assign": the partner's saved category. It stays choosable
   * even if it (or one above it) was switched off meanwhile.
   */
  keepCategoryId?: string | null
  onConfirm: (category: PartnerCategoryNode) => void
  purpose?: PartnerCategoryPickerPurpose
  title?: string
  /** Grey note under the title (default: what can be chosen). */
  description?: React.ReactNode
  /** Label of the confirm button, e.g. "분류적용". */
  confirmLabel?: string
  /** Reloads `categories` from the server (shows "다시 불러오기"). */
  onReload?: () => void
  /** True while `onReload` is running. */
  reloading?: boolean
  /**
   * Where [분류값 설정] goes (a new tab, so unsaved forms survive). null
   * hides it (e.g. on the 거래처분류설정 screen itself).
   */
  settingsHref?: string | null
}) {
  const idPrefix = useId()
  const [selectedId, setSelectedId] = useState<string | null>(value)
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    initialExpanded(categories, value)
  )

  // Start fresh every time the dialog opens: the current value selected and
  // its branch opened, no search text. (Adjusting state while rendering when
  // a prop changes, as the React docs recommend, avoids a flash of old state.)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setSelectedId(value)
      setQuery("")
      setExpanded(initialExpanded(categories, value))
    }
  }

  // The saved category's branch (it and the categories above it) stays
  // visible even when switched off.
  const keptPathIds = new Set(
    keepCategoryId
      ? findCategoryPath(categories, keepCategoryId).map((node) => node.id)
      : []
  )

  function isChoosable(node: PartnerCategoryNode): boolean {
    if (purpose === "filter") return true
    return (
      node.id === keepCategoryId || isCategorySelectable(categories, node.id)
    )
  }

  function isVisible(node: PartnerCategoryNode): boolean {
    return isChoosable(node) || keptPathIds.has(node.id)
  }

  const allNodes = flattenCategoryTree(categories).filter(isVisible)
  const searchText = normalizeSearch(query)
  const selected = allNodes.find((node) => node.id === selectedId) ?? null
  const canConfirm = selected !== null && isChoosable(selected)

  // Rows to show: the matching categories (with their full path) while
  // searching, otherwise the tree with closed branches left out.
  const rows: { node: PartnerCategoryNode; pathText: string | null }[] =
    searchText
      ? allNodes
          .filter((node) => normalizeSearch(node.name).includes(searchText))
          .map((node) => ({
            node,
            pathText: formatCategoryPath(findCategoryPath(categories, node.id)),
          }))
      : visibleTreeRows(categories, isVisible, expanded).map((node) => ({
          node,
          pathText: null,
        }))

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function confirm(node: PartnerCategoryNode | null) {
    if (!node || !isChoosable(node)) return
    onConfirm(node)
    onOpenChange(false)
  }

  const listId = `${idPrefix}-list`
  const radioName = `${idPrefix}-category`

  return (
    <ErpDialog
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      title={title}
      size="md"
      description={
        description ??
        (purpose === "assign"
          ? "대분류·중분류·소분류 중 어느 단계든 고를 수 있습니다. 사용 중지된 분류는 보이지 않습니다."
          : "고른 분류와 그 아래 분류의 거래처를 모두 찾습니다.")
      }
      footer={
        <>
          <ActionButton
            variant="secondary"
            size="lg"
            onClick={() => onOpenChange(false)}
          >
            취소
          </ActionButton>
          <ActionButton
            size="lg"
            disabled={!canConfirm}
            onClick={() => confirm(selected)}
          >
            {confirmLabel}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="relative min-w-48 flex-1">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              type="search"
              aria-label="분류명 검색"
              aria-controls={listId}
              placeholder="분류명으로 찾기"
              className="pl-8"
              value={query}
              maxLength={30}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Enter must not submit a form around the dialog.
                if (event.key === "Enter") event.preventDefault()
              }}
            />
          </div>
          {onReload && (
            <ActionButton
              variant="neutral"
              onClick={onReload}
              disabled={reloading}
            >
              {reloading ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <RotateCwIcon aria-hidden="true" />
              )}
              다시 불러오기
            </ActionButton>
          )}
          {settingsHref && (
            <ActionLink
              variant="neutral"
              href={settingsHref}
              target="_blank"
              rel="noopener"
              title="거래처분류설정의 분류값 설정이 새 탭에서 열립니다"
            >
              분류값 설정
              <ExternalLinkIcon aria-hidden="true" />
              <span className="sr-only">(새 탭에서 열림)</span>
            </ActionLink>
          )}
        </div>

        <div
          id={listId}
          role="radiogroup"
          aria-label="거래처분류"
          className="max-h-[min(24rem,50dvh)] min-h-40 overflow-y-auto border border-input"
        >
          {allNodes.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
              {categories.length === 0
                ? "아직 만든 거래처분류가 없습니다."
                : "고를 수 있는 분류가 없습니다. 모든 분류가 사용 중지 상태입니다."}
              <br />
              {settingsHref
                ? "[분류값 설정]에서 분류를 만든 뒤 [다시 불러오기]를 눌러 주세요."
                : "[분류값 설정]에서 분류를 만들어 주세요."}
              {purpose === "assign" && (
                <>
                  <br />
                  분류가 없는 거래처는 미분류로 표시됩니다.
                </>
              )}
            </p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-8 text-center text-[13px] text-muted-foreground">
              ‘{query.trim()}’이(가) 들어간 분류가 없습니다.
            </p>
          ) : (
            <ul className="py-1">
              {rows.map(({ node, pathText }) => {
                const choosable = isChoosable(node)
                const hasChildren =
                  !pathText && node.children.some((child) => isVisible(child))
                const isExpanded = expanded.has(node.id)
                const radioId = `${idPrefix}-${node.id}`
                const partnerCount = countPartnersInSubtree(node)
                return (
                  <li
                    key={node.id}
                    className="flex items-center gap-1 pr-2"
                    style={{
                      paddingLeft: pathText
                        ? "0.5rem"
                        : `${0.5 + (node.depth - 1) * 1.25}rem`,
                    }}
                  >
                    {pathText ? null : hasChildren ? (
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={`${node.name} 하위 분류 ${isExpanded ? "접기" : "펼치기"}`}
                        onClick={() => toggle(node.id)}
                        className="flex size-5 shrink-0 items-center justify-center rounded-sm border border-input bg-background text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {isExpanded ? (
                          <MinusIcon aria-hidden="true" className="size-3" />
                        ) : (
                          <PlusIcon aria-hidden="true" className="size-3" />
                        )}
                      </button>
                    ) : (
                      <span aria-hidden="true" className="size-5 shrink-0" />
                    )}
                    <label
                      htmlFor={radioId}
                      onDoubleClick={() => confirm(node)}
                      className={cn(
                        "flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-2 text-[13px] hover:bg-row-hover has-checked:bg-brand-tint has-checked:font-bold has-checked:text-brand-active has-focus-visible:ring-2 has-focus-visible:ring-ring",
                        !choosable &&
                          "cursor-default text-muted-foreground hover:bg-transparent"
                      )}
                    >
                      <input
                        id={radioId}
                        type="radio"
                        name={radioName}
                        value={node.id}
                        checked={selectedId === node.id}
                        disabled={!choosable}
                        onChange={() => setSelectedId(node.id)}
                        className="size-3.5 shrink-0 accent-brand outline-none"
                      />
                      <span className="min-w-0 truncate">
                        {pathText ?? node.name}
                      </span>
                      <span className="shrink-0 text-xs font-normal text-muted-foreground">
                        {CATEGORY_LEVEL_LABELS[node.depth]}
                        {!node.isActive && " · 사용 중지"}
                        {` · 거래처 ${formatNumber(partnerCount, 0)}`}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <p className="text-[13px]" aria-live="polite">
          <span className="font-bold">선택한 분류: </span>
          {selected
            ? formatCategoryPath(findCategoryPath(categories, selected.id))
            : "없음"}
        </p>
      </div>
    </ErpDialog>
  )
}

/** The branch of `value` opened (all 대분류 closed when there is no value). */
function initialExpanded(
  categories: PartnerCategoryNode[],
  value: string | null
): Set<string> {
  if (!value) return new Set()
  // Open every category above the value (not the value itself).
  return new Set(
    findCategoryPath(categories, value)
      .slice(0, -1)
      .map((node) => node.id)
  )
}

/** The tree top-down, leaving out hidden categories and closed branches. */
function visibleTreeRows(
  nodes: PartnerCategoryNode[],
  isVisible: (node: PartnerCategoryNode) => boolean,
  expanded: Set<string>
): PartnerCategoryNode[] {
  return nodes
    .filter(isVisible)
    .flatMap((node) => [
      node,
      ...(expanded.has(node.id)
        ? visibleTreeRows(node.children, isVisible, expanded)
        : []),
    ])
}

/** Search text in one form: Unicode NFC, no outer spaces, lower case. */
function normalizeSearch(text: string): string {
  return text.normalize("NFC").trim().toLowerCase()
}
