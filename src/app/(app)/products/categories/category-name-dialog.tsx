"use client"

import { useId, useRef, useState, useTransition } from "react"
import { LoaderCircleIcon } from "lucide-react"
import { toast } from "sonner"

import { ActionButton } from "@/components/erp/action-bar"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { FormRow, FormTable } from "@/components/erp/form-table"
import { Input } from "@/components/ui/input"
import { useHotkeys } from "@/hooks/use-hotkeys"
import type { CategoryActionResult } from "@/lib/categories/actions"
import { PRODUCT_LIMITS } from "@/lib/products/constants"

import { callCategoryAction } from "./call-category-action"

/**
 * Dialog with one "분류 이름" field, used to add a category and to rename one.
 * Closes itself and shows a toast when saving worked; otherwise shows the
 * error under the field and stays open. F8 saves, like the 상품 등록 window.
 *
 * Clicking outside does not close it (ErpDialog's default): the second click
 * of a double-click on the button that opened it would close it at once.
 */
export function CategoryNameDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initialName,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** Text of the save button, e.g. "추가" or "저장". */
  submitLabel: string
  /** Name shown when the dialog opens ("" for a new category). */
  initialName: string
  /** Saves the name on the server (a Server Action) and returns its result. */
  onSave: (name: string) => Promise<CategoryActionResult>
}) {
  const formId = useId()
  const inputId = useId()
  const errorId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useHotkeys(
    {
      F8: () => formRef.current?.requestSubmit(),
      // Do nothing, so the browser doesn't reload and lose the typed name.
      F5: () => {},
    },
    { enabled: open }
  )

  function close() {
    setError(null)
    onOpenChange(false)
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (isPending) return
    // The input is only in the page while the dialog is open (it starts with
    // `initialName` each time), so the name is read from the form itself.
    const name = String(new FormData(event.currentTarget).get("name") ?? "")
    startTransition(async () => {
      const result = await callCategoryAction(() => onSave(name))
      if (!result) return
      if (result.ok) {
        if (result.message) toast.success(result.message)
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
      title={title}
      description={description}
      footer={
        <>
          <ActionButton variant="secondary" size="lg" onClick={close}>
            취소
          </ActionButton>
          {/* Outside the <form> (the footer is not in the body): `form` links it. */}
          <ActionButton
            type="submit"
            form={formId}
            size="lg"
            keyHint="F8"
            disabled={isPending}
          >
            {isPending && (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            )}
            {submitLabel}
          </ActionButton>
        </>
      }
    >
      {/* noValidate: show our own Korean messages instead of the browser's popups. */}
      <form id={formId} ref={formRef} onSubmit={handleSubmit} noValidate>
        <FormTable>
          <FormRow
            label="분류 이름"
            htmlFor={inputId}
            required
            hint={`${PRODUCT_LIMITS.categoryNameMaxLength}자 이내`}
            error={error ?? undefined}
            errorId={errorId}
          >
            <Input
              id={inputId}
              name="name"
              defaultValue={initialName}
              maxLength={PRODUCT_LIMITS.categoryNameMaxLength}
              autoComplete="off"
              aria-required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={() => setError(null)}
              className="max-w-sm"
            />
          </FormRow>
        </FormTable>
      </form>
    </ErpDialog>
  )
}
