/**
 * Small browser helpers shared by the 재고 dialogs.
 */

/**
 * Whether a dialog is open on top of another one (e.g. a picker over the
 * 입고 등록 modal). The modal's F8 (저장) should then do nothing: the
 * picker has the focus. Counts the open ErpDialog popups.
 */
export function isNestedDialogOpen(): boolean {
  return document.querySelectorAll('[data-slot="erp-dialog"]').length > 1
}

/**
 * A new request id (a UUID) for a 전표 save: the database saves one request
 * once, so a retry after a lost answer never makes a second 전표 (see
 * `@/lib/request-id`).
 */
export { newRequestId } from "@/lib/request-id"

/**
 * onKeyDown of a 전표 <form>: Enter in a text box moves to the next box
 * (like a classic ERP) instead of saving the form by accident; saving is
 * F8 or the [저장] button. Enter that only finishes a Korean syllable
 * (IME) is left alone.
 */
export function enterMovesToNextField(
  event: React.KeyboardEvent<HTMLFormElement>
) {
  if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey)
    return
  // A picker on top (rendered in a portal) handles its own keys; its events
  // still bubble here through React.
  if (event.defaultPrevented) return
  const target = event.target
  if (!(target instanceof HTMLInputElement)) return
  if (!event.currentTarget.contains(target)) return
  if (["checkbox", "radio", "button", "submit"].includes(target.type)) return
  event.preventDefault()
  if (event.nativeEvent.isComposing || event.keyCode === 229) return
  const fields = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([disabled]), button[aria-haspopup="dialog"]:not([disabled]), [role="combobox"]:not([aria-disabled="true"])'
    )
  ).filter((element) => element.tabIndex >= 0 && element.offsetParent !== null)
  const index = fields.indexOf(target)
  fields[index + 1]?.focus()
}

/** Asked before a 전표 modal with changes is closed. */
export const UNSAVED_STOCK_MESSAGE =
  "저장하지 않은 내용은 사라집니다. 창을 닫을까요?"
