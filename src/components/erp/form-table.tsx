import { cn } from "@/lib/utils"

/**
 * Input form laid out as a bordered table of [grey label | value] rows, as in
 * the 상품 등록 dialog. Group rows under a heading with <FormSection>.
 *
 * @example
 * <FormSection title="필수정보" description="* 빨간 점이 있는 항목은 꼭 입력해 주세요.">
 *   <FormTable>
 *     <FormRow label="상품코드" htmlFor="code" required error={errors.code?.message} errorId="code-error">
 *       <Input id="code" aria-required aria-invalid={!!errors.code} aria-describedby="code-error" />
 *     </FormRow>
 *     <FormRow label="상품 분류">미분류 <ActionButton size="sm" variant="secondary">분류적용</ActionButton></FormRow>
 *   </FormTable>
 * </FormSection>
 */
export function FormSection({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: string
  /** Short grey note next to the heading. */
  description?: React.ReactNode
  /** Small buttons on the right side of the heading. */
  actions?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <section
      data-slot="form-section"
      className={cn("flex min-w-0 flex-col gap-2", className)}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-[15px] font-bold">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
        {actions && (
          <div className="ml-auto flex items-center gap-1.5">{actions}</div>
        )}
      </div>
      {children}
    </section>
  )
}

/** The bordered box around <FormRow>s. */
export function FormTable({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="form-table"
      className={cn("border border-input bg-background", className)}
      {...props}
    />
  )
}

/**
 * One [label | value] row of a <FormTable>.
 * - `htmlFor` makes the label a <label> for that input id. Without it the row
 *   becomes a named group (for radio buttons, several inputs, plain text).
 * - `required` shows the small red dot before the label. Also put
 *   `aria-required` (or `required`) on the input so screen readers say it.
 * - `hint` shows short grey help text on the same line, right of the value
 *   (it moves below when the row is too narrow). Keep it short, so the row
 *   stays one line like the reference screen.
 * - `error` shows a red message under the value; pass `errorId` and point the
 *   input's aria-describedby at it.
 */
export function FormRow({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  errorId,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  required?: boolean
  /** Short grey help text right of the value, e.g. "30자 이내". */
  hint?: React.ReactNode
  error?: string
  errorId?: string
  className?: string
  children: React.ReactNode
}) {
  const labelContent = (
    <>
      {required && (
        <span
          aria-hidden="true"
          className="mr-1 size-1.5 shrink-0 -translate-y-1.5 rounded-full bg-required"
        />
      )}
      {label}
    </>
  )
  const labelClass =
    "flex items-center bg-label px-2.5 py-2 text-[13px] font-bold sm:px-3"

  return (
    <div
      data-slot="form-row"
      role={htmlFor ? undefined : "group"}
      aria-label={htmlFor ? undefined : label}
      className={cn(
        "grid grid-cols-[6.5rem_minmax(0,1fr)] border-b border-grid-line last:border-b-0 sm:grid-cols-[7.5rem_minmax(0,1fr)]",
        className
      )}
    >
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClass}>
          {labelContent}
        </label>
      ) : (
        <span aria-hidden="true" className={labelClass}>
          {labelContent}
        </span>
      )}
      <div className="flex min-w-0 flex-col justify-center gap-1 px-2.5 py-1.5 sm:px-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {children}
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        {error && (
          <p id={errorId} className="text-xs font-bold text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
