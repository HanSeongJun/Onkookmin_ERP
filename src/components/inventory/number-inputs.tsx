"use client"

import { Input } from "@/components/ui/input"
import { STOCK_LIMITS } from "@/lib/inventory/constants"
import { formatDigits } from "@/lib/products/schema"
import { cn } from "@/lib/utils"

type BaseProps = Omit<
  React.ComponentProps<"input">,
  "value" | "onChange" | "type"
> & {
  value: string
  onChange: (value: string) => void
  /** Shown inside the box on the right, e.g. "kg", "원". */
  unit?: string
  /** Classes of the wrapper (its width), e.g. "w-28". */
  containerClassName?: string
}

/**
 * Puts the caret back after the same number of digits once the commas
 * have moved it (typing in the middle of "12,300" keeps working).
 */
function keepCaret(
  input: HTMLInputElement,
  next: string,
  digitsBefore: number
) {
  requestAnimationFrame(() => {
    // Skip when another key was typed meanwhile (its own change places it).
    if (document.activeElement !== input || input.value !== next) return
    let position = 0
    let seenDigits = 0
    while (position < next.length && seenDigits < digitsBefore) {
      if (/[\d.]/.test(next[position])) seenDigits++
      position++
    }
    input.setSelectionRange(position, position)
  })
}

function digitsBeforeCaret(input: HTMLInputElement): number {
  const caret = input.selectionStart ?? input.value.length
  return input.value.slice(0, caret).replace(/[^\d.]/g, "").length
}

function BoxWithUnit({
  unit,
  containerClassName,
  children,
}: {
  unit?: string
  containerClassName?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("relative", containerClassName)}>
      {children}
      {unit && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2 max-w-10 -translate-y-1/2 truncate text-xs text-muted-foreground"
        >
          {unit}
        </span>
      )}
    </div>
  )
}

/**
 * Text box for a stock quantity: digits with commas as you type
 * ("1234.5" → "1,234.5"), up to 3 decimals. Anything else (a minus sign,
 * letters, a 4th decimal) is kept exactly as typed, so the form's rules
 * show a Korean message instead of silently changing the number. The
 * value stays text (the Server Actions send it as digits, never as a
 * float). `unit` (the product's 단위) is shown inside the box.
 *
 * @example <StockQuantityInput value={value} onChange={setValue} unit="kg" aria-label="1번째 줄 수량" />
 */
export function StockQuantityInput({
  value,
  onChange,
  unit,
  containerClassName,
  className,
  ...props
}: BaseProps) {
  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const typed = input.value
    const cleaned = typed.replace(/[,\s]/g, "")
    const match = /^(\d*)(\.\d*)?$/.exec(cleaned)
    if (!match || (match[2] ?? "").length - 1 > STOCK_LIMITS.quantityDecimals) {
      onChange(typed)
      return
    }
    const digitsBefore = digitsBeforeCaret(input)
    const whole = match[1].replace(/^0+(?=\d)/, "")
    const next = `${formatDigits(whole)}${match[2] ?? ""}`
    onChange(next)
    keepCaret(input, next, digitsBefore)
  }

  return (
    <BoxWithUnit unit={unit} containerClassName={containerClassName}>
      <Input
        {...props}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={handleChange}
        className={cn("text-right tabular-nums", className, unit && "pr-10")}
      />
    </BoxWithUnit>
  )
}

/**
 * Text box for an amount in whole won: commas as you type ("12000" →
 * "12,000"); "₩", "원" and spaces are ignored. Anything else is kept as
 * typed so the form's rules show the message. Shows "원" inside the box
 * unless `unit` says otherwise.
 */
export function StockAmountInput({
  value,
  onChange,
  unit = "원",
  containerClassName,
  className,
  ...props
}: BaseProps) {
  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const typed = input.value
    const cleaned = typed.replace(/[,\s₩원]/g, "")
    if (!/^\d*$/.test(cleaned)) {
      onChange(typed)
      return
    }
    const digitsBefore = digitsBeforeCaret(input)
    const next = formatDigits(cleaned.replace(/^0+(?=\d)/, ""))
    onChange(next)
    keepCaret(input, next, digitsBefore)
  }

  return (
    <BoxWithUnit unit={unit} containerClassName={containerClassName}>
      <Input
        {...props}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={handleChange}
        className={cn("text-right tabular-nums", className, unit && "pr-7")}
      />
    </BoxWithUnit>
  )
}

/**
 * A typed quantity as a number, or null when it is not a plain number
 * (for previews such as 금액 = 수량 × 단가; the form's rules give the
 * message).
 * @example quantityValue("1,234.5") // 1234.5
 */
export function quantityValue(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, "")
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null
  return Number(cleaned)
}

/**
 * A typed amount as whole won, or null when empty or invalid.
 * @example amountValue("12,000원") // 12000
 */
export function amountValue(text: string): number | null {
  const cleaned = text.replace(/[,\s₩원]/g, "")
  if (!/^\d{1,11}$/.test(cleaned)) return null
  const amount = Number(cleaned)
  return amount <= STOCK_LIMITS.unitCostMax ? amount : null
}

/** A quantity for a text box: 12.5 → "12.5", 1200 → "1,200". */
export function quantityText(value: number): string {
  const rounded = Math.round(value * 1000) / 1000
  const [whole, fraction] = String(rounded).split(".")
  return fraction ? `${formatDigits(whole)}.${fraction}` : formatDigits(whole)
}
