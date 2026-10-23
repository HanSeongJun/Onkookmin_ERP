"use client"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** One choice of a <SimpleSelect>. */
export type SelectOption = { value: string; label: string }

/** A compact select box (Base UI) for a fixed list of choices. */
export function SimpleSelect({
  id,
  value,
  options,
  onChange,
  disabled = false,
  invalid = false,
  className,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: {
  id?: string
  value: string
  options: readonly SelectOption[]
  onChange: (value: string) => void
  disabled?: boolean
  invalid?: boolean
  className?: string
  "aria-label"?: string
  "aria-describedby"?: string
}) {
  return (
    <Select
      items={options}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null && next !== value) onChange(next)
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={invalid || undefined}
        className={cn("h-8 w-full max-w-56 rounded-sm", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * Text box for a stock quantity ("12", "2.5", "1,200"): right-aligned,
 * the product's unit shown inside on the right. The value stays text
 * exactly as typed; the form's rules check it (so "1.5" for 박스 shows a
 * Korean message instead of being changed silently).
 */
export function QuantityInput({
  unit,
  className,
  containerClassName,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & {
  unit?: string
  containerClassName?: string
}) {
  return (
    <div className={cn("relative", containerClassName)}>
      <Input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn(
          "h-7 rounded-sm text-right tabular-nums",
          unit && "pr-9",
          className
        )}
        {...props}
      />
      {unit && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2 max-w-8 -translate-y-1/2 truncate text-xs text-muted-foreground"
        >
          {unit}
        </span>
      )}
    </div>
  )
}
