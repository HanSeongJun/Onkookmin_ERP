"use client"

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/** Why the dialog wants to open/close: `details.reason` is e.g. "escape-key" or "close-press". */
export type ErpDialogChangeDetails = DialogPrimitive.Root.ChangeEventDetails

/** `md`/`lg` grow with their content; `xl` (the 등록/수정 form) has a fixed height. */
export type ErpDialogSize = "md" | "lg" | "xl"

const sizeClasses: Record<ErpDialogSize, string> = {
  md: "sm:max-w-xl",
  lg: "sm:max-w-4xl",
  xl: "sm:h-[min(56rem,calc(100dvh-2rem))] sm:max-w-[75rem]",
}

/**
 * Large ERP modal: title bar with ×, optional tab row, scrolling body and a
 * footer with centered buttons. Full screen on phones.
 *
 * It is controlled: it only closes when `onOpenChange(false, …)` makes you
 * set `open` to false. That is the place to ask "저장하지 않은 내용이 있습니다…"
 * before closing — × and Esc both arrive there (`details.reason` is
 * "close-press" or "escape-key"), so don't register Escape in useHotkeys.
 * Clicking outside does not close it (unless `dismissOnOutsidePress`).
 *
 * The footer sits outside the body, so a save button submits the body's form
 * with the `form` attribute.
 *
 * @example
 * <ErpDialog
 *   open={open}
 *   onOpenChange={(next) => { if (!next && (!isDirty || confirm("…"))) close() }}
 *   title="상품 등록"
 *   tabs={<ErpTabBar … />}
 *   footer={<>
 *     <ActionButton variant="secondary" size="lg" onClick={requestClose}>취소</ActionButton>
 *     <ActionButton type="submit" form="product-form" size="lg" keyHint="F8">저장</ActionButton>
 *   </>}
 * >
 *   <form id="product-form" onSubmit={…}>…</form>
 * </ErpDialog>
 */
export function ErpDialog({
  open,
  onOpenChange,
  title,
  description,
  tabs,
  footer,
  size = "xl",
  dismissOnOutsidePress = false,
  initialFocus,
  className,
  bodyClassName,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean, details: ErpDialogChangeDetails) => void
  title: React.ReactNode
  /** Short grey note under the title bar (also read by screen readers). */
  description?: React.ReactNode
  /** Tab row under the title bar, usually an <ErpTabBar>. */
  tabs?: React.ReactNode
  /** Buttons at the bottom, centered (e.g. 취소, 저장 | F8). */
  footer?: React.ReactNode
  size?: ErpDialogSize
  /** Close when the dark area outside is clicked. Off by default (forms). */
  dismissOnOutsidePress?: boolean
  /** Element to focus when it opens (default: the first focusable element). */
  initialFocus?: DialogPrimitive.Popup.Props["initialFocus"]
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={onOpenChange}
      disablePointerDismissal={!dismissOnOutsidePress}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup
          data-slot="erp-dialog"
          initialFocus={initialFocus}
          className={cn(
            "fixed inset-0 z-50 flex flex-col bg-background text-sm text-foreground shadow-xl outline-none",
            "transition-[opacity,scale] duration-150 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0",
            "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-sm sm:border sm:border-input",
            sizeClasses[size],
            className
          )}
        >
          {/* pr-14 leaves room for the × button (placed last, see below). */}
          <div className="flex h-14 shrink-0 items-center border-b-2 border-foreground bg-label pr-14 pl-4 sm:pl-5">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-lg font-bold">
              {title}
            </DialogPrimitive.Title>
          </div>

          {description && (
            <DialogPrimitive.Description className="shrink-0 px-4 pt-2 text-xs text-muted-foreground sm:px-5">
              {description}
            </DialogPrimitive.Description>
          )}

          {tabs && (
            <div className="shrink-0 border-b border-grid-line px-4 sm:px-5">
              {tabs}
            </div>
          )}

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5",
              bodyClassName
            )}
          >
            {children}
          </div>

          {footer && (
            <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-grid-line px-4 py-3 sm:px-5">
              {footer}
            </div>
          )}

          {/* Last in the page order, so opening the dialog focuses the tabs or
              the first field instead of ×; it is shown in the title bar. */}
          <DialogPrimitive.Close
            aria-label="닫기"
            className="absolute top-2.5 right-2 flex size-9 items-center justify-center rounded-sm outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon aria-hidden="true" className="size-5" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
