"use client"

import type { FieldErrors, FieldValues } from "react-hook-form"

/**
 * Error helpers of the 전표 forms (a header + a list of lines, e.g.
 * "docDate", "lines", "lines.2.quantity"). Every box of such a form has the
 * id fieldDomId(formId, path) and its message fieldErrorId(formId, path),
 * so the first wrong box can be focused and screen readers read the
 * message with the box.
 */

/** The DOM id of a form field: ("receipt-form", "lines.0.quantity") → "receipt-form-lines-0-quantity". */
export function fieldDomId(formId: string, path: string): string {
  return `${formId}-${path.replaceAll(".", "-")}`
}

/** The DOM id of a field's error message. */
export function fieldErrorId(formId: string, path: string): string {
  return `${fieldDomId(formId, path)}-error`
}

type ErrorLike = { message?: unknown; root?: { message?: unknown } }

function messageOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const value = (error as ErrorLike).message
  return typeof value === "string" ? value : undefined
}

/** The message about a whole list ("lines"), if any. */
export function listErrorMessage(listError: unknown): string | undefined {
  if (!listError || typeof listError !== "object") return undefined
  const error = listError as ErrorLike
  if (typeof error.root?.message === "string") return error.root.message
  return messageOf(error)
}

/** The message of one field of one line, if any. */
export function lineErrorMessage(
  listError: unknown,
  index: number,
  field: string
): string | undefined {
  if (!listError || typeof listError !== "object") return undefined
  const row = (listError as Record<string, unknown>)[index]
  if (!row || typeof row !== "object") return undefined
  return messageOf((row as Record<string, unknown>)[field])
}

/** One message of the list under a line table. */
export type LineFormError = {
  path: string
  /** e.g. "2번째 줄 · 수량: 수량을 입력해 주세요." */
  text: string
}

/**
 * Every message of a 전표 form in screen order: the header fields, then
 * the list's own message, then each line's fields (left to right).
 * `lineFields` = [field, label] pairs in column order.
 */
export function orderedFormErrors<T extends FieldValues>(
  errors: FieldErrors<T>,
  options: {
    headerFields: readonly [string, string][]
    listName: string
    /** "2번째 줄" by default; e.g. "발견 재고 2번째 줄". */
    linePrefix?: string
    lineFields: readonly [string, string][]
  }
): LineFormError[] {
  const record = errors as Record<string, unknown>
  const result: LineFormError[] = []
  for (const [field, label] of options.headerFields) {
    const message = messageOf(record[field])
    if (message) result.push({ path: field, text: `${label}: ${message}` })
  }
  const listError = record[options.listName]
  const listMessage = listErrorMessage(listError)
  if (listMessage) result.push({ path: options.listName, text: listMessage })
  if (listError && typeof listError === "object") {
    const indexes = Object.keys(listError)
      .filter((key) => /^\d+$/.test(key))
      .map(Number)
      .sort((a, b) => a - b)
    for (const index of indexes) {
      for (const [field, label] of options.lineFields) {
        const message = lineErrorMessage(listError, index, field)
        if (message) {
          result.push({
            path: `${options.listName}.${index}.${field}`,
            text: `${options.linePrefix ?? ""}${index + 1}번째 줄 · ${label}: ${message}`,
          })
        }
      }
    }
  }
  return result
}

/**
 * Focuses the box of `path` (by its fieldDomId), or the first focusable
 * element inside it (e.g. a cell with a button). Returns whether it found one.
 */
export function focusField(formId: string, path: string): boolean {
  const element = document.getElementById(fieldDomId(formId, path))
  if (!element) return false
  const target = element.matches("input, button, select, textarea, [tabindex]")
    ? element
    : element.querySelector<HTMLElement>(
        "input, button, select, textarea, [tabindex]"
      )
  if (!(target instanceof HTMLElement)) return false
  target.focus()
  target.scrollIntoView({ block: "nearest", inline: "nearest" })
  return true
}

/**
 * The red messages under a 전표's line table (each with its error id, so
 * the boxes can point at it with aria-describedby). Click a message to go
 * to its box.
 */
export function LineFormErrorList({
  formId,
  errors,
}: {
  formId: string
  errors: LineFormError[]
}) {
  if (errors.length === 0) return null
  return (
    <ul
      role="alert"
      className="flex flex-col gap-0.5 border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs font-bold text-destructive"
    >
      {errors.slice(0, 30).map((error) => (
        <li key={error.path} id={fieldErrorId(formId, error.path)}>
          <button
            type="button"
            onClick={() => focusField(formId, error.path)}
            className="text-left underline-offset-2 hover:underline"
          >
            {error.text}
          </button>
        </li>
      ))}
      {errors.length > 30 && (
        <li>그 밖에 {errors.length - 30}개 항목도 확인해 주세요.</li>
      )}
    </ul>
  )
}
