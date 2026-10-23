"use client"

import { useCallback, useEffect, useRef } from "react"

import { fieldDomId } from "@/components/inventory/line-form-errors"

/**
 * Focuses a box of a line just added to a 전표 form. Call useFieldArray's
 * `append(rows, { shouldFocus: false })` (react-hook-form would otherwise
 * focus a box of the LAST new line by itself), then `focusLine("lines.3.quantity")`.
 * Once React has drawn the new lines (`lineCount` changed), the box gets the
 * focus; the line table first scrolls back to its left edge, so the line's
 * 줄 and 상품 stay in view.
 *
 * (A setTimeout(0) is not enough: when the lines come from an awaited Server
 * Action, e.g. the rows checked on 재고처별 재고현황, they may not be drawn
 * yet.) The focus is set one frame later, after a closing picker dialog
 * has given the focus back to its button.
 */
export function useFocusAfterAppend(
  formId: string,
  lineCount: number
): (path: string) => void {
  const targetRef = useRef<string | null>(null)

  useEffect(() => {
    const target = targetRef.current
    if (!target) return
    const element = document.getElementById(fieldDomId(formId, target))
    if (!element) return
    targetRef.current = null
    const frame = requestAnimationFrame(() => {
      const grid = element.closest<HTMLElement>('[data-slot="data-grid"]')
      if (grid) grid.scrollLeft = 0
      element.focus({ preventScroll: true })
      element.scrollIntoView({ block: "nearest", inline: "nearest" })
    })
    return () => cancelAnimationFrame(frame)
  }, [formId, lineCount])

  return useCallback((path: string) => {
    targetRef.current = path
  }, [])
}
