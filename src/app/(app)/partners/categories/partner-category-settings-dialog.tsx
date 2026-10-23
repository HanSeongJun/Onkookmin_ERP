"use client"

import {
  ChevronDownIcon,
  ChevronRightIcon,
  LoaderCircleIcon,
  MenuIcon,
  PlusIcon,
  RotateCwIcon,
} from "lucide-react"
import { unstable_rethrow } from "next/navigation"
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react"
import { toast } from "sonner"

import { ActionButton } from "@/components/erp/action-bar"
import { DataGridCheckbox } from "@/components/erp/data-grid"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { formatNumber } from "@/lib/format"
import {
  loadPartnerCategorySettings,
  savePartnerCategories,
  type PartnerCategorySaveResult,
} from "@/lib/partner-categories/actions"
import {
  addDraftCategory,
  buildPartnerCategoryChanges,
  canAddDraftChild,
  CATEGORY_LEVEL_LABELS,
  draftDeleteBlockReason,
  findDraftCategory,
  hasPartnerCategoryChanges,
  moveDraftCategory,
  PARTNER_CATEGORY_NAME_MAX_LENGTH,
  removeDraftCategories,
  toPartnerCategoryDraft,
  updateDraftCategory,
  validatePartnerCategoryDraft,
  type PartnerCategoryDraftNode,
  type PartnerCategoryNode,
} from "@/lib/partner-categories/tree"
import { cn } from "@/lib/utils"

const UNSAVED_CHANGES_MESSAGE =
  "저장하지 않은 분류 변경 내용은 사라집니다. 창을 닫을까요?"

/** What happens while the categories are read. */
type LoadState =
  | { status: "loading" }
  | {
      status: "ready"
      /** The tree as saved (what the draft is compared with). */
      saved: PartnerCategoryNode[]
      /** Hand back to savePartnerCategories (refuses if it changed). */
      version: string
    }
  | { status: "error" }

/**
 * A message above the tree: a problem to fix (red, `key` = the row whose
 * name box gets the focus) or a note (grey). `treeChanged`: someone else
 * changed the categories meanwhile; offer [다시 불러오기].
 */
type Notice = {
  tone: "error" | "info"
  message: string
  key?: string
  treeChanged?: boolean
}

/** One row of the tree as shown (closed branches left out). */
type VisibleRow = {
  node: PartnerCategoryDraftNode
  /** The parent's key (null for a 대분류). */
  parentKey: string | null
  /** Position among its siblings (0 = first) and how many there are. */
  index: number
  siblingCount: number
  /** False when a category above it is switched off. */
  parentsActive: boolean
}

/**
 * A row being dragged by its ≡ handle: where it would land among its
 * siblings (`slot` 0…n = in front of the sibling with that index, n = at
 * the end), or null while it would not move.
 */
type DragState = { key: string; parentKey: string | null; slot: number | null }

/**
 * 분류값 설정: the 거래처분류 tree (대분류 > 중분류 > 소분류) edited in one
 * window, like the reference screen, and saved all at once.
 *
 * - [대분류 추가] adds a 대분류 at the end; "+하위" on a 대분류 or 중분류 adds
 *   a sub-category (a 소분류 has none). The new row's name box gets the
 *   focus.
 * - Names are edited right in the row. ▸/▾ open and close a branch.
 * - The ≡ handle drags a row up or down among the categories with the same
 *   parent (it never moves to another parent); ↑ / ↓ on a focused handle do
 *   the same.
 * - The switch turns a category 사용 / 사용 중지 (a switched-off category
 *   hides its whole branch from the pickers; partners keep it).
 * - Check rows, then [분류삭제]: only categories without partners, and
 *   only together with every sub-category.
 *
 * Nothing is saved until [저장 | F8] (off while nothing changed): every
 * add, rename, new order, 사용 / 사용 중지 and delete goes to the database
 * in one request and one transaction (savePartnerCategories), all or
 * nothing. If someone else changed the categories since the window opened,
 * saving is refused and [다시 불러오기] reads them again. [취소], Esc and ×
 * ask first when something changed.
 *
 * Mount it only while it is shown, so every opening starts fresh.
 */
export function PartnerCategorySettingsDialog({
  onClose,
}: {
  /** Closes the window (after saving, or when the user confirmed). */
  onClose: () => void
}) {
  const idPrefix = useId()
  const [load, setLoad] = useState<LoadState>({ status: "loading" })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [, startLoad] = useTransition()
  const [draft, setDraft] = useState<PartnerCategoryDraftNode[]>([])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [notice, setNotice] = useState<Notice | null>(null)
  const [isSaving, startSave] = useTransition()
  const [drag, setDrag] = useState<DragState | null>(null)
  // Read by screen readers after a row moved.
  const [announcement, setAnnouncement] = useState("")

  // The drag, known right away (the state follows a moment later).
  const dragRef = useRef<DragState | null>(null)
  const nextKeyRef = useRef(1)
  const tableRef = useRef<HTMLTableElement>(null)
  // After a change: the name box to focus (a new row, a problem) or the
  // handle to focus again (a row moved with ↑ / ↓).
  const focusRef = useRef<{ kind: "name" | "handle"; key: string } | null>(null)

  // Read the tree and its version. In a transition, so a redirect from the
  // server (e.g. to the login page when the session expired) is carried
  // out by Next.js.
  useEffect(() => {
    let ignore = false
    startLoad(async () => {
      try {
        const { tree, version } = await loadPartnerCategorySettings()
        if (ignore) return
        setLoad({ status: "ready", saved: tree, version })
        setDraft(toPartnerCategoryDraft(tree))
        setCollapsed(new Set())
        setChecked(new Set())
      } catch (error) {
        if (ignore) return
        unstable_rethrow(error)
        console.error(error)
        setLoad({ status: "error" })
      }
    })
    return () => {
      ignore = true
    }
  }, [loadAttempt])

  // What is sent when saving: compared with the tree as saved, so every
  // category whose order number is not its place (1, 2, 3, …) gets it.
  const changes =
    load.status === "ready"
      ? buildPartnerCategoryChanges(load.saved, draft)
      : null
  // What the user changed: compared with the saved tree numbered 1, 2, 3, …
  // per level. (Categories made before may have other order numbers, e.g.
  // all 0; that alone is no change, so 저장 stays off until the user edits.)
  const userChanges =
    load.status === "ready"
      ? buildPartnerCategoryChanges(numberSortOrders(load.saved), draft)
      : null
  const isDirty =
    changes !== null &&
    userChanges !== null &&
    hasPartnerCategoryChanges(userChanges)

  // Closing or reloading the browser tab with unsaved changes: the browser
  // asks first.
  useEffect(() => {
    if (!isDirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [isDirty])

  // Focus what the last change asked for (see focusRef).
  useLayoutEffect(() => {
    const target = focusRef.current
    if (!target) return
    focusRef.current = null
    const attribute =
      target.kind === "name" ? "data-name-key" : "data-handle-key"
    const element = tableRef.current?.querySelector<HTMLElement>(
      `[${attribute}="${CSS.escape(target.key)}"]`
    )
    element?.focus()
    element?.scrollIntoView({ block: "nearest" })
  }, [draft, collapsed, notice])

  // Esc while dragging cancels the drag (and does not close the window).
  const isDragging = drag !== null
  useEffect(() => {
    if (!isDragging) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      dragRef.current = null
      setDrag(null)
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [isDragging])

  // ---- Editing the draft -------------------------------------------------------

  /** Replaces the draft; an old message no longer applies. */
  function changeDraft(next: PartnerCategoryDraftNode[]) {
    setDraft(next)
    setNotice(null)
  }

  function newKey(): string {
    const key = `new-${nextKeyRef.current}`
    nextKeyRef.current += 1
    return key
  }

  function addTopLevel() {
    const key = newKey()
    changeDraft(addDraftCategory(draft, null, key))
    focusRef.current = { kind: "name", key }
  }

  function addChild(parent: PartnerCategoryDraftNode) {
    if (!canAddDraftChild(parent)) return
    const key = newKey()
    changeDraft(addDraftCategory(draft, parent.key, key))
    // Open the parent, so the new row shows.
    setCollapsed((current) => {
      const next = new Set(current)
      next.delete(parent.key)
      return next
    })
    focusRef.current = { kind: "name", key }
  }

  function rename(key: string, name: string) {
    setDraft(updateDraftCategory(draft, key, { name }))
    // A problem with this row's name is being fixed: hide its message.
    if (notice?.key === key) setNotice(null)
  }

  function setActive(key: string, isActive: boolean) {
    changeDraft(updateDraftCategory(draft, key, { isActive }))
  }

  function toggleBranch(key: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  function toggleChecked(key: string, isChecked: boolean) {
    setChecked((current) => {
      const next = new Set(current)
      if (isChecked) {
        next.add(key)
      } else {
        next.delete(key)
      }
      return next
    })
  }

  /** [분류삭제]: takes the checked rows out of the draft (saved later). */
  function deleteChecked() {
    // Rows that are still in the draft (a checked row may have been
    // removed with its parent already).
    const keys = new Set(
      [...checked].filter((key) => findDraftCategory(draft, key) !== null)
    )
    if (keys.size === 0) {
      toast.info("삭제할 분류를 먼저 체크해 주세요.")
      return
    }
    const blocked = draftDeleteBlockReason(draft, keys)
    if (blocked) {
      setNotice({ tone: "error", message: blocked })
      return
    }
    changeDraft(removeDraftCategories(draft, keys))
    setChecked(new Set())
    setNotice({
      tone: "info",
      message: `분류 ${formatNumber(keys.size, 0)}개를 목록에서 뺐습니다. [저장]을 눌러야 실제로 삭제됩니다. (잘못 뺐다면 [취소]로 창을 닫으면 됩니다.)`,
    })
  }

  // ---- Moving rows (≡ handle) ----------------------------------------------------

  function siblingsOf(parentKey: string | null): PartnerCategoryDraftNode[] {
    if (parentKey === null) return draft
    return findDraftCategory(draft, parentKey)?.children ?? []
  }

  /** Moves a row to `toIndex` among its siblings (0 = first). */
  function moveRow(
    node: PartnerCategoryDraftNode,
    toIndex: number,
    siblingCount: number
  ) {
    changeDraft(moveDraftCategory(draft, node.key, toIndex))
    setAnnouncement(
      `‘${node.name.trim() || "이름 없는 분류"}’을(를) ${siblingCount}개 중 ${toIndex + 1}번째로 옮겼습니다.`
    )
  }

  /** ↑ / ↓ on a focused handle: one place up or down. */
  function handleHandleKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    row: VisibleRow
  ) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    event.preventDefault()
    const to = row.index + (event.key === "ArrowUp" ? -1 : 1)
    if (to < 0 || to >= row.siblingCount) {
      setAnnouncement(
        to < 0 ? "이미 맨 위입니다." : "이미 같은 단계의 맨 아래입니다."
      )
      return
    }
    focusRef.current = { kind: "handle", key: row.node.key }
    moveRow(row.node, to, row.siblingCount)
  }

  /**
   * Where a dragged row would land for the pointer at height `clientY`:
   * in front of the first sibling whose row's middle is below the pointer,
   * or at the end. Null when that is its own place.
   */
  function slotAt(clientY: number, state: DragState): number | null {
    const siblings = siblingsOf(state.parentKey)
    const from = siblings.findIndex((node) => node.key === state.key)
    let slot = siblings.length
    for (const [index, sibling] of siblings.entries()) {
      const element = tableRef.current?.querySelector(
        `tr[data-row-key="${CSS.escape(sibling.key)}"]`
      )
      if (!element) continue
      const box = element.getBoundingClientRect()
      if (clientY < box.top + box.height / 2) {
        slot = index
        break
      }
    }
    return slot === from || slot === from + 1 ? null : slot
  }

  function startDrag(
    event: React.PointerEvent<HTMLButtonElement>,
    row: VisibleRow
  ) {
    if (event.button !== 0 || isSaving) return
    // Keeps the page from selecting text or scrolling (touch) meanwhile.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const state: DragState = {
      key: row.node.key,
      parentKey: row.parentKey,
      slot: null,
    }
    dragRef.current = state
    setDrag(state)
  }

  function moveDrag(event: React.PointerEvent<HTMLButtonElement>) {
    const state = dragRef.current
    if (!state) return
    // Scroll the list when the pointer is near its top or bottom edge.
    const scroller = tableRef.current?.parentElement
    if (scroller) {
      const box = scroller.getBoundingClientRect()
      if (event.clientY < box.top + 24) scroller.scrollBy({ top: -12 })
      if (event.clientY > box.bottom - 24) scroller.scrollBy({ top: 12 })
    }
    const slot = slotAt(event.clientY, state)
    if (slot === state.slot) return
    const next = { ...state, slot }
    dragRef.current = next
    setDrag(next)
  }

  function endDrag() {
    const state = dragRef.current
    dragRef.current = null
    setDrag(null)
    if (!state || state.slot === null) return
    const siblings = siblingsOf(state.parentKey)
    const from = siblings.findIndex((node) => node.key === state.key)
    if (from < 0) return
    // The slot counts the row itself; its new index does not.
    const to = state.slot > from ? state.slot - 1 : state.slot
    moveRow(siblings[from], to, siblings.length)
  }

  function cancelDrag() {
    dragRef.current = null
    setDrag(null)
  }

  // ---- Saving and closing ----------------------------------------------------------

  function save() {
    if (load.status !== "ready" || !changes || !isDirty || isSaving) return
    const problem = validatePartnerCategoryDraft(draft)
    if (problem) {
      showProblem(problem.key, problem.message)
      return
    }
    const { version } = load
    startSave(async () => {
      let result: PartnerCategorySaveResult
      try {
        result = await savePartnerCategories(version, changes)
      } catch (error) {
        unstable_rethrow(error)
        console.error(error)
        setNotice({
          tone: "error",
          message:
            "저장하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
        })
        return
      }
      if (!result.ok) {
        setNotice({
          tone: "error",
          message: result.error,
          treeChanged: result.treeChanged,
        })
        return
      }
      toast.success(result.message)
      onClose()
    })
  }

  /** Shows a problem and puts the focus in that row's name box. */
  function showProblem(key: string, message: string) {
    // Open every branch above the row, so it can be seen.
    setCollapsed((current) => {
      const next = new Set(current)
      for (const ancestor of draftAncestorKeys(draft, key))
        next.delete(ancestor)
      return next
    })
    setNotice({ tone: "error", message, key })
    focusRef.current = { kind: "name", key }
  }

  function reload() {
    if (
      isDirty &&
      !window.confirm(
        "지금까지 바꾼 내용은 사라집니다. 분류를 다시 불러올까요?"
      )
    ) {
      return
    }
    setNotice(null)
    setLoad({ status: "loading" })
    setLoadAttempt((attempt) => attempt + 1)
  }

  function requestClose() {
    if (isSaving) return
    if (isDirty && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return
    onClose()
  }

  // F8 = 저장; F5 must not reload the page (the changes would be lost).
  useHotkeys({
    F5: () => {},
    F8: save,
  })

  // ---- Window ------------------------------------------------------------------

  const rows = visibleRows(draft, null, true, collapsed)
  const counts = userChanges
    ? {
        added: userChanges.categories.filter((change) => change.id === null)
          .length,
        updated: userChanges.categories.filter((change) => change.id !== null)
          .length,
        deleted: userChanges.deleted.length,
      }
    : null
  const checkedCount = [...checked].filter(
    (key) => findDraftCategory(draft, key) !== null
  ).length

  /** The row that shows the landing line of the drag, and where. */
  function dropMark(row: VisibleRow): "before" | "after" | undefined {
    if (!drag || drag.slot === null) return undefined
    const siblings = siblingsOf(drag.parentKey)
    if (drag.slot < siblings.length) {
      return siblings[drag.slot].key === row.node.key ? "before" : undefined
    }
    // At the end: below the last sibling's last shown row.
    const last = siblings.at(-1)
    if (!last) return undefined
    const lastShown = lastShownRowKey(last, collapsed)
    return lastShown === row.node.key ? "after" : undefined
  }

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
      title="분류값 설정"
      size="lg"
      className="sm:h-[min(46rem,calc(100dvh-2rem))] sm:max-w-3xl"
      bodyClassName="flex flex-col gap-2"
      description="분류 이름은 칸에서 바로 고칩니다. ≡를 끌거나(또는 ≡에서 ↑ ↓ 키) 같은 단계 안에서 순서를 바꿉니다. 바꾼 내용은 [저장 | F8]을 눌러야 한꺼번에 반영됩니다."
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
            size="lg"
            keyHint="F8"
            disabled={!isDirty || isSaving}
            onClick={save}
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
        <SettingsLoading />
      ) : load.status === "error" ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-2 px-4 py-16 text-center"
        >
          <p className="text-base font-bold">분류를 불러오지 못했습니다</p>
          <p className="text-[13px] text-muted-foreground">
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
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="mr-auto text-[13px]" aria-live="polite">
              {counts && isDirty ? (
                <>
                  <span className="font-bold text-brand">저장 전 변경</span> ·
                  추가 {counts.added} · 수정 {counts.updated} · 삭제{" "}
                  {counts.deleted}
                </>
              ) : (
                <span className="text-muted-foreground">
                  바뀐 내용이 없습니다.
                </span>
              )}
            </p>
            <ActionButton
              variant="secondary"
              disabled={isSaving}
              onClick={addTopLevel}
            >
              <PlusIcon aria-hidden="true" />
              대분류 추가
            </ActionButton>
            <ActionButton
              variant="secondary"
              disabled={isSaving}
              onClick={deleteChecked}
            >
              분류삭제
              {checkedCount > 0 && ` (${checkedCount})`}
            </ActionButton>
          </div>

          {notice && (
            <div
              role={notice.tone === "error" ? "alert" : "status"}
              className={cn(
                "flex flex-wrap items-center gap-2 border px-3 py-2 text-[13px]",
                notice.tone === "error"
                  ? "border-destructive/40 bg-destructive/5 text-destructive"
                  : "border-grid-line bg-label text-foreground"
              )}
            >
              <span className="min-w-0 flex-1">{notice.message}</span>
              {notice.treeChanged && (
                <ActionButton variant="neutral" size="sm" onClick={reload}>
                  <RotateCwIcon aria-hidden="true" />
                  다시 불러오기
                </ActionButton>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto border border-input">
            <table
              ref={tableRef}
              aria-label="거래처분류"
              className={cn(
                "w-full min-w-[34rem] border-separate border-spacing-0 text-[13px]",
                drag && "select-none"
              )}
            >
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky top-0 z-10 h-9 w-9 border-r border-b border-grid-line bg-label px-1 text-xs font-bold"
                  >
                    <span className="sr-only">삭제할 분류 체크</span>
                    선택
                  </th>
                  <th
                    scope="col"
                    className="sticky top-0 z-10 h-9 border-r border-b border-grid-line bg-label px-2 font-bold"
                  >
                    분류명
                  </th>
                  <th
                    scope="col"
                    className="sticky top-0 z-10 h-9 w-20 border-r border-b border-grid-line bg-label px-2 font-bold whitespace-nowrap"
                  >
                    거래처 수
                  </th>
                  <th
                    scope="col"
                    className="sticky top-0 z-10 h-9 w-28 border-b border-grid-line bg-label px-2 font-bold whitespace-nowrap"
                  >
                    사용 여부
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-12 text-center">
                      <p className="font-bold">아직 거래처분류가 없습니다.</p>
                      <p className="mt-1 text-muted-foreground">
                        [대분류 추가]로 첫 분류를 만들어 주세요. 예: 오프라인
                        거래처, 온라인 거래처
                      </p>
                    </td>
                  </tr>
                )}
                {rows.map((row) => (
                  <CategoryRow
                    key={row.node.key}
                    idPrefix={idPrefix}
                    row={row}
                    isExpanded={!collapsed.has(row.node.key)}
                    isChecked={checked.has(row.node.key)}
                    isProblem={notice?.key === row.node.key}
                    isDragged={drag?.key === row.node.key}
                    drop={dropMark(row)}
                    disabled={isSaving}
                    onToggleBranch={() => toggleBranch(row.node.key)}
                    onCheckedChange={(value) =>
                      toggleChecked(row.node.key, value)
                    }
                    onRename={(name) => rename(row.node.key, name)}
                    onActiveChange={(value) => setActive(row.node.key, value)}
                    onAddChild={() => addChild(row.node)}
                    onHandlePointerDown={(event) => startDrag(event, row)}
                    onHandlePointerMove={moveDrag}
                    onHandlePointerUp={endDrag}
                    onHandlePointerCancel={cancelDrag}
                    onHandleKeyDown={(event) => handleHandleKeyDown(event, row)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs text-muted-foreground marker:text-brand">
            <li>
              분류는 대분류 &gt; 중분류 &gt; 소분류 세 단계까지입니다. ‘+하위’로
              아래 단계를 만들고, 거래처는 어느 단계에든 넣을 수 있습니다.
            </li>
            <li>
              사용을 끄면 그 분류와 아래 분류 전체를 새로 고를 수 없습니다. 이미
              들어 있는 거래처는 그대로 남습니다.
            </li>
            <li>
              삭제는 거래처가 없는 분류만 됩니다. 아래 분류가 있으면 아래 분류도
              함께 체크해야 합니다. 쓰던 분류는 삭제 대신 사용을 꺼 주세요.
            </li>
          </ul>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </>
      )}
    </ErpDialog>
  )
}

/** One category row of the tree table. */
function CategoryRow({
  idPrefix,
  row,
  isExpanded,
  isChecked,
  isProblem,
  isDragged,
  drop,
  disabled,
  onToggleBranch,
  onCheckedChange,
  onRename,
  onActiveChange,
  onAddChild,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
  onHandlePointerCancel,
  onHandleKeyDown,
}: {
  idPrefix: string
  row: VisibleRow
  isExpanded: boolean
  isChecked: boolean
  /** Its name has the problem shown above the tree. */
  isProblem: boolean
  isDragged: boolean
  /** The landing line of a drag above / below this row. */
  drop: "before" | "after" | undefined
  disabled: boolean
  onToggleBranch: () => void
  onCheckedChange: (checked: boolean) => void
  onRename: (name: string) => void
  onActiveChange: (isActive: boolean) => void
  onAddChild: () => void
  onHandlePointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void
  onHandlePointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void
  onHandlePointerUp: () => void
  onHandlePointerCancel: () => void
  onHandleKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
}) {
  const { node, parentsActive } = row
  const label = node.name.trim() || "이름 없는 분류"
  const hasChildren = node.children.length > 0
  const subtreeCount = countDraftPartners(node)
  const switchId = `${idPrefix}-active-${node.key}`
  const nameId = `${idPrefix}-name-${node.key}`
  const cellClass = "border-r border-b border-grid-line"

  return (
    <tr
      data-row-key={node.key}
      data-drop={drop}
      className={cn(
        "bg-background hover:bg-row-hover",
        isChecked && "bg-brand-tint hover:bg-brand-tint",
        isDragged && "opacity-50",
        (!node.isActive || !parentsActive) && "text-muted-foreground",
        // The landing line of a drag (on the cells: rows can't show it).
        "data-[drop=before]:[&>td]:shadow-[inset_0_3px_0_var(--color-brand)]",
        "data-[drop=after]:[&>td]:shadow-[inset_0_-3px_0_var(--color-brand)]"
      )}
    >
      <td className={cn(cellClass, "h-10 text-center")}>
        <DataGridCheckbox
          aria-label={`‘${label}’ 삭제할 분류로 체크`}
          checked={isChecked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
      </td>
      <td className={cn(cellClass, "py-1 pr-2")}>
        <div
          className="flex min-w-0 items-center gap-1"
          style={{ paddingLeft: `${0.25 + (node.depth - 1) * 1.5}rem` }}
        >
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-label={`‘${label}’ 하위 분류 ${isExpanded ? "접기" : "펼치기"}`}
              onClick={onToggleBranch}
              className="flex size-6 shrink-0 items-center justify-center rounded-sm outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isExpanded ? (
                <ChevronDownIcon aria-hidden="true" className="size-4" />
              ) : (
                <ChevronRightIcon aria-hidden="true" className="size-4" />
              )}
            </button>
          ) : (
            <span aria-hidden="true" className="size-6 shrink-0" />
          )}
          <button
            type="button"
            data-handle-key={node.key}
            aria-label={`‘${label}’ 순서 바꾸기 (같은 단계 ${row.siblingCount}개 중 ${row.index + 1}번째). 위·아래 화살표로 옮깁니다.`}
            title="끌어서 같은 단계 안의 순서를 바꿉니다 (↑ ↓ 키도 됩니다)"
            disabled={disabled}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerCancel}
            onKeyDown={onHandleKeyDown}
            className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MenuIcon aria-hidden="true" className="size-4" />
          </button>
          <label htmlFor={nameId} className="sr-only">
            {CATEGORY_LEVEL_LABELS[node.depth]} 이름
          </label>
          <Input
            id={nameId}
            data-name-key={node.key}
            value={node.name}
            maxLength={PARTNER_CATEGORY_NAME_MAX_LENGTH}
            placeholder={`${CATEGORY_LEVEL_LABELS[node.depth]} 이름 입력`}
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            aria-invalid={isProblem || undefined}
            onChange={(event) => onRename(event.target.value)}
            onKeyDown={(event) => {
              // Enter must not do anything else (there is no form).
              if (event.key === "Enter") event.preventDefault()
            }}
            className={cn(
              "h-7 min-w-24 flex-1 rounded-sm text-[13px]",
              node.depth === 1 && "font-bold"
            )}
          />
          <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
            {CATEGORY_LEVEL_LABELS[node.depth]}
            {node.id === null && (
              <span className="ml-1 font-bold text-brand">새 분류</span>
            )}
          </span>
          {canAddDraftChild(node) ? (
            <ActionButton
              variant="neutral"
              size="sm"
              disabled={disabled}
              aria-label={`‘${label}’ 아래에 ${CATEGORY_LEVEL_LABELS[node.depth === 1 ? 2 : 3]} 추가`}
              title={`아래에 ${CATEGORY_LEVEL_LABELS[node.depth === 1 ? 2 : 3]}를 추가합니다`}
              onClick={onAddChild}
            >
              <PlusIcon aria-hidden="true" />
              하위
            </ActionButton>
          ) : (
            // Keeps the names lined up (소분류 has no "+하위").
            <span aria-hidden="true" className="w-[3.25rem] shrink-0" />
          )}
        </div>
      </td>
      <td
        className={cn(cellClass, "px-2 text-right tabular-nums")}
        title={
          hasChildren
            ? `이 분류에 ${node.partnerCount}개, 아래 분류까지 ${subtreeCount}개`
            : undefined
        }
      >
        {formatNumber(node.partnerCount, 0)}
        {subtreeCount > node.partnerCount && (
          <span className="block text-[11px] text-muted-foreground">
            하위 포함 {formatNumber(subtreeCount, 0)}
          </span>
        )}
      </td>
      <td className="border-b border-grid-line px-2">
        <div className="flex items-center gap-1.5">
          <Switch
            id={switchId}
            aria-label={`‘${label}’ 사용`}
            checked={node.isActive}
            disabled={disabled}
            onCheckedChange={onActiveChange}
          />
          <label htmlFor={switchId} className="text-xs whitespace-nowrap">
            {node.isActive ? "사용" : "사용 중지"}
          </label>
        </div>
        {node.isActive && !parentsActive && (
          <span className="block text-[11px] text-muted-foreground">
            (상위 분류 중지)
          </span>
        )}
      </td>
    </tr>
  )
}

/** Placeholder while the categories are read. */
function SettingsLoading() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      <span className="sr-only">거래처분류를 불러오는 중…</span>
      <div className="flex justify-end gap-1.5">
        <Skeleton className="h-8 w-28 rounded-sm" />
        <Skeleton className="h-8 w-20 rounded-sm" />
      </div>
      <div className="flex flex-col gap-px border border-grid-line">
        <Skeleton className="h-9 rounded-none" />
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-10 rounded-none" />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The tree top-down as rows, leaving out the closed branches. */
function visibleRows(
  nodes: readonly PartnerCategoryDraftNode[],
  parentKey: string | null,
  parentsActive: boolean,
  collapsed: ReadonlySet<string>
): VisibleRow[] {
  return nodes.flatMap((node, index) => [
    { node, parentKey, index, siblingCount: nodes.length, parentsActive },
    ...(collapsed.has(node.key)
      ? []
      : visibleRows(
          node.children,
          node.key,
          parentsActive && node.isActive,
          collapsed
        )),
  ])
}

/** The last row shown for this category's branch (itself if closed). */
function lastShownRowKey(
  node: PartnerCategoryDraftNode,
  collapsed: ReadonlySet<string>
): string {
  const lastChild = node.children.at(-1)
  if (!lastChild || collapsed.has(node.key)) return node.key
  return lastShownRowKey(lastChild, collapsed)
}

/** The keys of the categories above the one with `key` (대분류 first). */
function draftAncestorKeys(
  draft: readonly PartnerCategoryDraftNode[],
  key: string
): string[] {
  for (const node of draft) {
    if (node.key === key) return []
    const below = draftAncestorKeys(node.children, key)
    if (below.length > 0 || findDraftCategory(node.children, key)) {
      return [node.key, ...below]
    }
  }
  return []
}

/** The tree with sortOrder = place among the siblings (1, 2, 3, …). */
function numberSortOrders(
  tree: readonly PartnerCategoryNode[]
): PartnerCategoryNode[] {
  return tree.map((node, index) => ({
    ...node,
    sortOrder: index + 1,
    children: numberSortOrders(node.children),
  }))
}

/** Partners in this category and every category below it. */
function countDraftPartners(node: PartnerCategoryDraftNode): number {
  return node.children.reduce(
    (sum, child) => sum + countDraftPartners(child),
    node.partnerCount
  )
}
