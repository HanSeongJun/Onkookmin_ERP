"use client"

import { Input } from "@/components/ui/input"
import { formatBusinessNumber } from "@/lib/partners/business-number"
import { formatPhone } from "@/lib/partners/phone"
import { cn } from "@/lib/utils"

type BaseProps = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type" | "maxLength"
> & {
  value: string
  onChange: (value: string) => void
}

/**
 * Text box for a number written with hyphens: only digits are kept, and
 * the hyphens are put in as you type by `format` (e.g. "01012345678" →
 * "010-1234-5678"). The caret stays after the same digit, so typing or
 * deleting in the middle works. At most `maxDigits` digits.
 * `keepTyped`: text that is kept exactly as typed (e.g. "+82 …"); the
 * form's rules read it.
 */
function FormattedDigitsInput({
  value,
  onChange,
  format,
  maxDigits,
  keepTyped,
  className,
  ...props
}: BaseProps & {
  format: (digits: string) => string
  maxDigits: number
  keepTyped?: (typed: string) => boolean
}) {
  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const typed = input.value
    if (keepTyped?.(typed)) {
      onChange(typed)
      return
    }

    const caret = input.selectionStart ?? typed.length
    const digitsBeforeCaret = typed.slice(0, caret).replace(/\D/g, "").length
    const next = format(typed.replace(/\D/g, "").slice(0, maxDigits))
    onChange(next)

    // The new hyphens move the caret to the end: put it back after the same
    // number of digits.
    requestAnimationFrame(() => {
      // Skip when another key was typed meanwhile (its own change places
      // the caret).
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

  return (
    <Input
      {...props}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={handleChange}
      className={cn("tabular-nums", className)}
    />
  )
}

/**
 * Phone number box: "010-1234-5678", "02-123-4567", "1588-1234" as you
 * type (stored as digits; see `@/lib/partners/phone`). A number typed with
 * the country code ("+82 10-…") is kept as typed and saved as 010….
 */
export function PhoneInput(props: BaseProps) {
  return (
    <FormattedDigitsInput
      placeholder="예: 010-1234-5678"
      {...props}
      format={formatPhone}
      maxDigits={12}
      keepTyped={(typed) => typed.trimStart().startsWith("+")}
    />
  )
}

/** 사업자등록번호 box: "123-45-67890" as you type (10 digits). */
export function BusinessNumberInput(props: BaseProps) {
  return (
    <FormattedDigitsInput
      placeholder="123-45-67890"
      {...props}
      format={formatBusinessNumber}
      maxDigits={10}
    />
  )
}
