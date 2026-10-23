"use client"

import { useState, useTransition } from "react"
import { CircleAlertIcon, LoaderCircleIcon } from "lucide-react"

import { ActionButton } from "@/components/erp/action-bar"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { FormRow, FormTable } from "@/components/erp/form-table"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { deleteCategory } from "@/lib/categories/actions"
import {
  CATEGORY_DEACTIVATE_HINT,
  describeCategoryContents,
  getCategoryDeleteBlockReason,
} from "@/lib/categories/schema"
import {
  CATEGORY_LEVEL_LABELS,
  countProductsInSubtree,
  type CategoryNode,
} from "@/lib/categories/tree"

import { callCategoryAction, showCategoryResult } from "./call-category-action"

/**
 * Asks "삭제할까요?" — or, when the category still has sub-categories or
 * products put directly into it, explains why it can't be deleted and offers
 * 사용 중지 instead.
 *
 * Clicking outside does not close it (ErpDialog's default): the second click
 * of a double-click on the 삭제 button that opened it would close it at once.
 *
 * @param path where the category is, e.g. "농산물 > 채소"
 * @param onDeactivate switches the category off (사용 중지하기 button)
 */
export function DeleteCategoryDialog({
  category,
  path,
  open,
  onOpenChange,
  onDeactivate,
}: {
  category: CategoryNode
  path: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeactivate: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const level = CATEGORY_LEVEL_LABELS[category.depth]
  const blockReason = getCategoryDeleteBlockReason({
    depth: category.depth,
    childCount: category.children.length,
    productCount: category.productCount,
  })

  function close() {
    // Forget an old error, so it isn't shown the next time it opens.
    setError(null)
    onOpenChange(false)
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await callCategoryAction(() =>
        deleteCategory({ id: category.id })
      )
      if (!result) return
      if (result.ok) {
        showCategoryResult(result)
        close()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <ErpDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close()
      }}
      size="md"
      title={
        blockReason
          ? `‘${category.name}’ 분류는 삭제할 수 없습니다`
          : `‘${category.name}’ 분류를 삭제할까요?`
      }
      footer={
        blockReason ? (
          <>
            <ActionButton variant="secondary" size="lg" onClick={close}>
              닫기
            </ActionButton>
            {category.isActive && (
              <ActionButton
                size="lg"
                onClick={() => {
                  close()
                  onDeactivate()
                }}
              >
                사용 중지하기
              </ActionButton>
            )}
          </>
        ) : (
          <>
            <ActionButton variant="secondary" size="lg" onClick={close}>
              취소
            </ActionButton>
            <ActionButton
              size="lg"
              // Red instead of the brand color: deleting can't be undone.
              className="bg-destructive hover:bg-destructive/90 active:bg-destructive"
              onClick={handleDelete}
              disabled={isPending}
            >
              {isPending && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              삭제
            </ActionButton>
          </>
        )
      }
    >
      {blockReason ? (
        <div className="flex flex-col gap-3">
          <p className="font-bold">{blockReason}</p>
          {/* Same numbers as the category's row in the table. */}
          <FormTable>
            <FormRow label="분류">
              {level} · {path}
            </FormRow>
            <FormRow
              label="들어 있는 것"
              hint={
                countProductsInSubtree(category) > 0
                  ? "상품 수에는 사용 중지된 상품도 들어 있습니다."
                  : undefined
              }
            >
              <span className="tabular-nums">
                {describeCategoryContents(category)}
              </span>
            </FormRow>
          </FormTable>
          <p className="text-muted-foreground">{CATEGORY_DEACTIVATE_HINT}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p>
            ‘{path}’ {level}를 삭제합니다. 삭제한 분류는 되돌릴 수 없습니다.
          </p>
          {error && (
            <Alert variant="destructive">
              <CircleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
    </ErpDialog>
  )
}
