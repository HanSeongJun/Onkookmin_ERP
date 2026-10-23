import { cn } from "@/lib/utils"

/**
 * Title row at the top of a page: bold title with a dark rule below it.
 * `description` is a short grey note next to the title; `actions` go on the
 * right (e.g. a link to a related screen).
 *
 * @example
 * <PageTitle title="상품관리" description="상품을 등록하고 관리합니다." />
 */
export function PageTitle({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div
      data-slot="page-title"
      className={cn(
        "flex flex-col gap-2 border-b-2 border-foreground pb-2 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-bold md:text-[1.375rem]">{title}</h1>
        {description && (
          <p className="text-[13px] text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
      )}
    </div>
  )
}
