"use client"

import { Fragment, useState } from "react"
import { FolderTreeIcon, PlusIcon } from "lucide-react"

import { ActionBar, ActionButton } from "@/components/erp/action-bar"
import {
  DataGrid,
  DataGridBody,
  DataGridHead,
  DataGridHeader,
} from "@/components/erp/data-grid"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { createCategory } from "@/lib/categories/actions"
import {
  flattenCategoryTree,
  formatCategoryPath,
  type CategoryNode,
} from "@/lib/categories/tree"
import { formatNumber } from "@/lib/format"

import { CategoryNameDialog } from "./category-name-dialog"
import { CategoryRow } from "./category-row"

/**
 * The 상품분류설정 screen below the title: buttons (대분류 추가 | F5,
 * 모두 펼치기 / 모두 접기), a short guide, the number of categories and the
 * table of all categories as a tree (대분류 → 중분류 → 소분류).
 *
 * @param categories every category, switched-off ones included
 */
export function CategoryTable({ categories }: { categories: CategoryNode[] }) {
  const [addMajorOpen, setAddMajorOpen] = useState(false)
  // Categories whose sub-categories are hidden (− was clicked).
  // Everything else is open, so a new category is always visible.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )

  // F5 = 신규, like on the 상품관리 list (instead of reloading the page).
  // Does nothing while a dialog is open.
  useHotkeys({
    F5: () => {
      if (!document.querySelector('[role="dialog"]')) setAddMajorOpen(true)
    },
  })

  const allCategories = flattenCategoryTree(categories)
  const idsWithChildren = allCategories
    .filter((category) => category.children.length > 0)
    .map((category) => category.id)
  const someCollapsed = idsWithChildren.some((id) => collapsedIds.has(id))
  const allCollapsed = idsWithChildren.every((id) => collapsedIds.has(id))
  const countOnLevel = (depth: number) =>
    allCategories.filter((category) => category.depth === depth).length

  function setExpanded(id: string, expanded: boolean) {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (expanded) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /** Rows of these categories, each followed by its open sub-categories. */
  function renderRows(
    nodes: CategoryNode[],
    parents: CategoryNode[]
  ): React.ReactNode {
    return nodes.map((node, index) => {
      const path = [...parents, node]
      const expanded = !collapsedIds.has(node.id)
      return (
        <Fragment key={node.id}>
          <CategoryRow
            category={node}
            path={formatCategoryPath(path)}
            isFirst={index === 0}
            isLast={index === nodes.length - 1}
            isUnderSwitchedOff={parents.some((parent) => !parent.isActive)}
            expanded={expanded}
            onExpandedChange={(nextExpanded) =>
              setExpanded(node.id, nextExpanded)
            }
          />
          {expanded && renderRows(node.children, path)}
        </Fragment>
      )
    })
  }

  return (
    <>
      <ActionBar
        end={
          categories.length > 0 && (
            <>
              <ActionButton
                variant="neutral"
                disabled={!someCollapsed}
                onClick={() => setCollapsedIds(new Set())}
              >
                모두 펼치기
              </ActionButton>
              <ActionButton
                variant="neutral"
                disabled={allCollapsed}
                onClick={() => setCollapsedIds(new Set(idsWithChildren))}
              >
                모두 접기
              </ActionButton>
            </>
          )
        }
      >
        <ActionButton keyHint="F5" onClick={() => setAddMajorOpen(true)}>
          <PlusIcon aria-hidden="true" />
          대분류 추가
        </ActionButton>
      </ActionBar>

      {categories.length === 0 ? (
        <NoCategories onAdd={() => setAddMajorOpen(true)} />
      ) : (
        <>
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs text-muted-foreground marker:text-brand">
            <li>
              상품 수: ‘직접’은 그 분류에 바로 넣은 상품, ‘하위 포함’은 아래
              분류의 상품까지 합친 수입니다. 사용 중지된 상품도 셉니다.
            </li>
            <li>
              사용을 끄면 그 분류와 아래 분류 모두 상품을 등록·수정할 때 고를 수
              없습니다(회색 글씨). 이미 넣어 둔 상품은 그대로 남습니다.
            </li>
            <li>
              삭제는 상품도 아래 분류도 없는 분류만 됩니다. 쓰던 분류는 삭제
              대신 사용을 꺼 주세요.
            </li>
          </ul>

          <p className="text-[13px]">
            총{" "}
            <span className="font-bold text-brand">
              {formatNumber(allCategories.length, 0)}
            </span>
            개 · 대분류 <span className="font-bold">{countOnLevel(1)}</span> ·
            중분류 <span className="font-bold">{countOnLevel(2)}</span> · 소분류{" "}
            <span className="font-bold">{countOnLevel(3)}</span>
          </p>

          <DataGrid
            aria-label="상품 분류 목록"
            containerClassName="max-h-[max(20rem,calc(100svh-18rem))]"
          >
            <DataGridHeader>
              <tr>
                {/* Stays on the left while the table scrolls sideways (phones). */}
                <DataGridHead className="left-0 z-20">분류명</DataGridHead>
                {/* w-px: as narrow as the content, the name gets the rest. */}
                <DataGridHead className="w-px">단계</DataGridHead>
                <DataGridHead className="w-px">상품 수(직접)</DataGridHead>
                <DataGridHead className="w-px">상품 수(하위 포함)</DataGridHead>
                <DataGridHead className="w-px">사용 여부</DataGridHead>
                <DataGridHead className="w-px">순서</DataGridHead>
                <DataGridHead className="w-px">관리</DataGridHead>
              </tr>
            </DataGridHeader>
            <DataGridBody>{renderRows(categories, [])}</DataGridBody>
          </DataGrid>
        </>
      )}

      <CategoryNameDialog
        open={addMajorOpen}
        onOpenChange={setAddMajorOpen}
        title="대분류 추가"
        description="상품을 크게 나누는 분류입니다. 예: 농산물, 수산물, 가공식품"
        submitLabel="추가"
        initialName=""
        onSave={(name) => createCategory({ name, parentId: null })}
      />
    </>
  )
}

/** Shown when there are no categories at all (e.g. right after setup). */
function NoCategories({ onAdd }: { onAdd: () => void }) {
  return (
    <section
      aria-labelledby="no-categories-title"
      className="flex flex-col items-center gap-3 border border-input px-4 py-10 text-center"
    >
      <FolderTreeIcon aria-hidden="true" className="size-8 text-brand" />
      <h2 id="no-categories-title" className="text-base font-bold">
        아직 분류가 없습니다.
      </h2>
      <div className="flex max-w-xl flex-col gap-1 text-muted-foreground">
        <p>
          분류 없이도 상품을 등록할 수 있습니다. 분류가 없는 상품은 ‘미분류’로
          표시됩니다.
        </p>
        <p>
          상품을 나눠 보려면 첫 대분류를 만들어 주세요. 분류는 대분류 → 중분류 →
          소분류 3단계까지 만들 수 있습니다. 예: 농산물 → 채소 → 엽채류
        </p>
      </div>
      <ActionButton onClick={onAdd}>
        <PlusIcon aria-hidden="true" />첫 대분류 만들기
      </ActionButton>
    </section>
  )
}
