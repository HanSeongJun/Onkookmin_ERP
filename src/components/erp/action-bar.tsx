import { cn } from "@/lib/utils"

/**
 * Row of action buttons under the page title, like a classic ERP screen:
 * main actions on the left, extra ones (e.g. 엑셀) on the right.
 *
 * @example
 * <ActionBar
 *   end={<ActionButton keyHint="Ctrl+F9" onClick={download}>엑셀</ActionButton>}
 * >
 *   <ActionButton type="submit" form="product-search" keyHint="F4">조회</ActionButton>
 *   <ActionButton keyHint="F5" onClick={openNew}>신규</ActionButton>
 *   <ActionButton variant="secondary" onClick={deactivate}>선택 사용중지</ActionButton>
 * </ActionBar>
 */
export function ActionBar({
  children,
  end,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  /** Buttons on the right side (they wrap below on narrow screens). */
  end?: React.ReactNode
}) {
  return (
    <div
      data-slot="action-bar"
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      {...props}
    >
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
      {end && (
        <div className="ml-auto flex flex-wrap items-center gap-1.5">{end}</div>
      )}
    </div>
  )
}

/** Colors of an ERP button. */
export type ActionButtonVariant =
  /** Brand color: the main actions (조회, 신규, 저장, 엑셀). */
  | "primary"
  /** Dark grey: 취소, 선택 사용중지, small in-form buttons (분류적용). */
  | "secondary"
  /** White with a grey border: low-key actions. */
  | "neutral"

/** Sizes: `sm` for small buttons inside forms, `lg` for dialog footers. */
export type ActionButtonSize = "sm" | "md" | "lg"

const variantClasses: Record<ActionButtonVariant, string> = {
  primary:
    "bg-brand text-brand-foreground hover:bg-brand-hover active:bg-brand-active",
  secondary:
    "bg-neutral-button text-white hover:bg-neutral-button-hover active:bg-neutral-button-hover",
  neutral:
    "border border-input bg-background text-foreground hover:bg-muted active:bg-secondary",
}

const sizeClasses: Record<ActionButtonSize, string> = {
  sm: "h-6 gap-1 px-2 text-xs [&_svg]:size-3.5",
  md: "h-8 gap-1.5 px-3 text-[13px] [&_svg]:size-4",
  lg: "h-10 min-w-24 gap-2 px-5 text-sm [&_svg]:size-4",
}

/**
 * Class names of an ERP button, for elements that are not <ActionButton>
 * or <ActionLink>, e.g. a next/link <Link>:
 * `<Link href="/products" className={actionButtonClassName()}>상품관리</Link>`
 */
export function actionButtonClassName({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ActionButtonVariant
  size?: ActionButtonSize
  className?: string
} = {}): string {
  return cn(
    "inline-flex shrink-0 cursor-pointer items-center justify-center rounded-sm font-bold whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    variantClasses[variant],
    sizeClasses[size],
    className
  )
}

type ActionStyleProps = {
  variant?: ActionButtonVariant
  size?: ActionButtonSize
  /**
   * Keyboard shortcut shown after the label, e.g. "F4" → "조회 | F4".
   * Only a hint: register the key itself with useHotkeys().
   */
  keyHint?: string
}

/**
 * ERP button: label plus an optional shortcut hint ("조회 | F4").
 * `type` defaults to "button" (set type="submit" to submit a form; use the
 * `form` attribute when the button sits outside the <form>).
 */
export function ActionButton({
  variant,
  size,
  keyHint,
  className,
  type = "button",
  children,
  ...props
}: React.ComponentProps<"button"> & ActionStyleProps) {
  return (
    <button
      type={type}
      data-slot="action-button"
      aria-keyshortcuts={toAriaKeyShortcuts(keyHint)}
      className={actionButtonClassName({ variant, size, className })}
      {...props}
    >
      {children}
      {keyHint && <KeyHint>{keyHint}</KeyHint>}
    </button>
  )
}

/**
 * A link that looks like an ERP button, e.g. a file download or a page that
 * opens in a new tab:
 * `<ActionLink href="/products/categories" target="_blank" rel="noopener" size="sm" variant="secondary">분류값 설정</ActionLink>`
 */
export function ActionLink({
  variant,
  size,
  keyHint,
  className,
  children,
  ...props
}: React.ComponentProps<"a"> & ActionStyleProps) {
  return (
    <a
      data-slot="action-button"
      aria-keyshortcuts={toAriaKeyShortcuts(keyHint)}
      className={actionButtonClassName({ variant, size, className })}
      {...props}
    >
      {children}
      {keyHint && <KeyHint>{keyHint}</KeyHint>}
    </a>
  )
}

/** "| F4" after a button label: a thin divider, then the key name. */
function KeyHint({ children }: { children: string }) {
  return (
    <span
      aria-hidden="true"
      className="border-l border-current/40 pl-1.5 text-[0.95em] font-bold"
    >
      {children}
    </span>
  )
}

/** "Ctrl+F9" → "Control+F9" (the key names screen readers expect). */
function toAriaKeyShortcuts(keyHint: string | undefined) {
  return keyHint?.replace(/\bCtrl\b/g, "Control")
}
