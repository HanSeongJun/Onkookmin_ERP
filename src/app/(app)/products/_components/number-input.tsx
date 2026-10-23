"use client"

import { Input } from "@/components/ui/input"
import { formatDigits } from "@/lib/products/schema"
import { cn } from "@/lib/utils"

/**
 * Text box for a whole number (won, days). With `thousands` the value gets
 * commas as you type ("12300" → "12,300"). Commas, spaces, "₩" and "원" are
 * ignored, so a pasted "12,300원" works.
 * Anything else (a decimal point, a minus sign, letters) is kept exactly as
 * typed, so the form's zod rules show a Korean error message instead of
 * silently saving a different number ("9090.91" must never become 909,091).
 * `unit` (e.g. "원", "일") is shown inside the box on the right
 * (`unitClassName` styles it, e.g. "sm:hidden" to show it on phones only).
 * The value stays text; the form's zod rules turn it into a number.
 * `containerClassName` sizes the box (e.g. "w-40"); `className` styles the
 * input itself.
 */
export function NumberInput({
  value,
  onChange,
  unit,
  unitClassName,
  thousands = false,
  className,
  containerClassName,
  ...props
}: Omit<React.ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: string
  onChange: (value: string) => void
  unit?: string
  unitClassName?: string
  thousands?: boolean
  containerClassName?: string
}) {
  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const typed = input.value
    const cleaned = typed.replace(/[,\s₩원]/g, "")

    // Not a plain whole number: keep the text so the error message shows.
    if (!/^\d*$/.test(cleaned)) {
      onChange(typed)
      return
    }

    const caret = input.selectionStart ?? typed.length
    const digitsBeforeCaret = typed.slice(0, caret).replace(/\D/g, "").length
    const digits = cleaned.replace(/^0+(?=\d)/, "") // "007" → "7"
    const next = thousands ? formatDigits(digits) : digits
    onChange(next)

    // Adding commas moves the caret to the end; put it back after the same
    // number of digits, so typing in the middle of a number works.
    if (thousands) {
      requestAnimationFrame(() => {
        // Skip when another key was typed meanwhile: that key's own change
        // places the caret (an old position would move it backwards).
        if (document.activeElement !== input || input.value !== next) return
        let position = 0
        let seenDigits = 0
        while (position < next.length && seenDigits < digitsBeforeCaret) {
          if (/\d/.test(next[position])) seenDigits++
          position++
        }
        input.setSelectionRange(position, position)
      })
    }
  }

  return (
    <div className={cn("relative", containerClassName)}>
      <Input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={handleChange}
        className={cn("text-right tabular-nums", unit && "pr-8", className)}
      />
      {unit && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground",
            unitClassName
          )}
        >
          {unit}
        </span>
      )}
    </div>
  )
}
