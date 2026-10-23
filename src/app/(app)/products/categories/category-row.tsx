"use client"

import { useId, useOptimistic, useState, useTransition } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
} from "lucide-react"

import { ActionButton } from "@/components/erp/action-bar"
import { DataGridCell, DataGridRow } from "@/components/erp/data-grid"
import { Switch } from "@/components/ui/switch"
import {
  createCategory,
  moveCategory,
  renameCategory,
  setCategoryActive,
} from "@/lib/categories/actions"
import { childLevelLabel } from "@/lib/categories/schema"
import {
  CATEGORY_LEVEL_LABELS,
  countProductsInSubtree,
  MAX_CATEGORY_DEPTH,
  type CategoryDepth,
  type CategoryNode,
} from "@/lib/categories/tree"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

import { callCategoryAction, showCategoryResult } from "./call-category-action"
import { CategoryNameDialog } from "./category-name-dialog"
import { DeleteCategoryDialog } from "./delete-category-dialog"

/** Number of columns of the category table (a note row spans all of them). */
export const CATEGORY_TABLE_COLUMNS = 7

/**
 * Left padding of the 분류명 cell on each level, so every level sits one
 * step (the +/− button and a gap) further right. Smaller steps on phones.
 */
const LEVEL_INDENT: Record<CategoryDepth, string> = {
  1: "pl-0",
  2: "pl-4 sm:pl-6",
  3: "pl-8 sm:pl-12",
}

/**
 * One category in the table: name (with +/− to show or hide the categories
 * under it), level, product counts, 사용 switch, move up/down, and the
 * 하위 분류 추가 / 이름 변경 / 삭제 buttons.
 * A switched-off category, and everything under it, is shown in grey.
 *
 * @param path where the category is, e.g. "농산물 > 채소" (shown in dialogs)
 * @param isFirst / isLast whether it is first/last among its siblings (the
 *   move buttons are turned off at the ends)
 * @param isUnderSwitchedOff a category above it is switched off, so it can't
 *   be chosen for products either
 * @param expanded whether the categories under it are shown
 */
export function CategoryRow({
  category,
  path,
  isFirst,
  isLast,
  isUnderSwitchedOff,
  expanded,
  onExpandedChange,
}: {
  category: CategoryNode
  path: string
  isFirst: boolean
  isLast: boolean
  isUnderSwitchedOff: boolean
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
}) {
  const switchId = useId()
  const [isPending, startTransition] = useTransition()
  // Flip the switch right away; the server's value takes over when it answers.
  const [isActive, setOptimisticIsActive] = useOptimistic(category.isActive)
  const [addOpen, setAddOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const level = CATEGORY_LEVEL_LABELS[category.depth]
  const hasChildren = category.children.length > 0
  // A 소분류 is the last level: no "추가" button on its row.
  const childLevel =
    category.depth < MAX_CATEGORY_DEPTH ? childLevelLabel(category.depth) : null
  const greyedOut = isUnderSwitchedOff || !category.isActive

  function changeActive(nextIsActive: boolean) {
    startTransition(async () => {
      setOptimisticIsActive(nextIsActive)
      showCategoryResult(
        await callCategoryAction(() =>
          setCategoryActive({ id: category.id, isActive: nextIsActive })
        )
      )
    })
  }

  function move(direction: "up" | "down") {
    startTransition(async () => {
      showCategoryResult(
        await callCategoryAction(() =>
          moveCategory({ id: category.id, direction })
        )
      )
    })
  }

  return (
    <>
      <DataGridRow
        data-depth={category.depth}
        className={cn(greyedOut && "text-muted-foreground")}
        title={
          isUnderSwitchedOff && category.isActive
            ? "위 분류가 사용 중지되어 상품을 등록·수정할 때 고를 수 없습니다."
            : undefined
        }
      >
        {/* Stays on the left while the other columns scroll sideways (phones). */}
        <DataGridCell className="sticky left-0 z-[1] bg-inherit">
          <div
            className={cn(
              "flex items-center gap-1.5",
              LEVEL_INDENT[category.depth]
            )}
          >
            {hasChildren ? (
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`‘${category.name}’ 아래 분류 ${expanded ? "접기" : "펼치기"}`}
                title={expanded ? "접기" : "펼치기"}
                onClick={() => onExpandedChange(!expanded)}
                className="flex size-[18px] shrink-0 items-center justify-center rounded-[2px] border border-input bg-background text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
              >
                {expanded ? (
                  <MinusIcon aria-hidden="true" />
                ) : (
                  <PlusIcon aria-hidden="true" />
                )}
              </button>
            ) : (
              <span aria-hidden="true" className="size-[18px] shrink-0" />
            )}
            {/* A long name is cut with "…" (the full name shows on hover). */}
            <span
              title={category.name}
              className={cn(
                "max-w-[7.5rem] truncate sm:max-w-[24rem]",
                category.depth === 1 && "font-bold"
              )}
            >
              {category.name}
            </span>
          </div>
        </DataGridCell>

        <DataGridCell align="center">{level}</DataGridCell>
        <DataGridCell numeric>
          {formatNumber(category.productCount, 0)}
        </DataGridCell>
        <DataGridCell numeric>
          {formatNumber(countProductsInSubtree(category), 0)}
        </DataGridCell>

        <DataGridCell align="center">
          <div className="inline-flex items-center gap-1.5">
            <Switch
              id={switchId}
              aria-label={`‘${category.name}’ 사용`}
              checked={isActive}
              onCheckedChange={changeActive}
              disabled={isPending}
            />
            <label htmlFor={switchId} className="w-14 text-left text-xs">
              {isActive ? "사용" : "사용중지"}
            </label>
          </div>
        </DataGridCell>

        <DataGridCell align="center">
          <div className="inline-flex gap-1">
            <ActionButton
              variant="neutral"
              size="sm"
              className="w-6 px-0"
              aria-label={`‘${category.name}’ 위로 이동`}
              title="위로 이동"
              disabled={isFirst || isPending}
              onClick={() => move("up")}
            >
              <ArrowUpIcon aria-hidden="true" />
            </ActionButton>
            <ActionButton
              variant="neutral"
              size="sm"
              className="w-6 px-0"
              aria-label={`‘${category.name}’ 아래로 이동`}
              title="아래로 이동"
              disabled={isLast || isPending}
              onClick={() => move("down")}
            >
              <ArrowDownIcon aria-hidden="true" />
            </ActionButton>
          </div>
        </DataGridCell>

        <DataGridCell>
          <div className="flex items-center gap-1">
            {/* Same width with or without the button, so the buttons line up. */}
            {childLevel ? (
              <ActionButton
                variant="neutral"
                size="sm"
                className="w-[6.25rem]"
                // Several of these are on the page: the name says which one it is.
                aria-label={`‘${category.name}’에 ${childLevel} 추가`}
                onClick={() => setAddOpen(true)}
              >
                <PlusIcon aria-hidden="true" />
                {childLevel} 추가
              </ActionButton>
            ) : (
              <span aria-hidden="true" className="w-[6.25rem] shrink-0" />
            )}
            <ActionButton
              variant="neutral"
              size="sm"
              aria-label={`‘${category.name}’ 이름 변경`}
              onClick={() => setRenameOpen(true)}
            >
              이름 변경
            </ActionButton>
            <ActionButton
              variant="neutral"
              size="sm"
              className="text-destructive"
              aria-label={`‘${category.name}’ 삭제`}
              onClick={() => setDeleteOpen(true)}
            >
              삭제
            </ActionButton>
          </div>

          {/* The dialogs open over the page. They are written inside this cell
              because Base UI adds small invisible helpers where a dialog is
              written, and those can't sit directly in a table row. */}
          {childLevel && (
            <CategoryNameDialog
              open={addOpen}
              onOpenChange={setAddOpen}
              title={`‘${category.name}’에 ${childLevel} 추가`}
              description={
                category.depth === 1
                  ? `‘${path}’ 안에서 상품을 더 자세히 나누는 분류입니다. 예: 채소, 과일`
                  : `‘${path}’ 안에서 상품을 한 번 더 나누는 분류입니다. 예: 엽채류, 버섯류. 소분류가 마지막 단계라서 소분류 아래에는 분류를 더 만들 수 없습니다.`
              }
              submitLabel="추가"
              initialName=""
              onSave={async (name) => {
                const result = await createCategory({
                  name,
                  parentId: category.id,
                })
                // Show the new category: open this row if it was folded.
                if (result.ok) onExpandedChange(true)
                return result
              }}
            />
          )}
          <CategoryNameDialog
            open={renameOpen}
            onOpenChange={setRenameOpen}
            title="분류 이름 변경"
            description={`‘${path}’ ${level}의 새 이름을 입력해 주세요. 이 분류에 속한 상품에도 새 이름이 보입니다.`}
            submitLabel="저장"
            initialName={category.name}
            onSave={(name) => renameCategory({ id: category.id, name })}
          />
          <DeleteCategoryDialog
            category={category}
            path={path}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onDeactivate={() => changeActive(false)}
          />
        </DataGridCell>
      </DataGridRow>

      {!category.isActive && hasChildren && (
        <SwitchedOffNoteRow category={category} />
      )}
    </>
  )
}

/**
 * Under a switched-off 대분류 or 중분류 that has sub-categories: explains
 * that those can't be chosen for products either.
 */
function SwitchedOffNoteRow({ category }: { category: CategoryNode }) {
  const level = CATEGORY_LEVEL_LABELS[category.depth]
  const levelsBelow = category.depth === 1 ? "중분류·소분류" : "소분류"

  return (
    <tr>
      <td
        colSpan={CATEGORY_TABLE_COLUMNS}
        className="border-b border-grid-line bg-label px-2 py-1.5 text-xs text-muted-foreground"
      >
        {/* Sticky + max width: stays readable while the table scrolls sideways. */}
        <p
          className={cn(
            "sticky left-2 flex max-w-[calc(100vw-3rem)] items-start gap-1.5",
            LEVEL_INDENT[category.depth]
          )}
        >
          <InfoIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          사용 중지된 {level}입니다. 이 {level}와 그 아래 {levelsBelow}는 상품을
          등록·수정할 때 새로 고를 수 없습니다. 이미 넣어 둔 상품은 그대로
          남습니다.
        </p>
      </td>
    </tr>
  )
}
