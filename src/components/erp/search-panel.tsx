import { cn } from "@/lib/utils"

/**
 * Bordered search form laid out as a grid of [grey label | input] cells.
 * 1 pair per row on phones, 2 on tablets, 3 on laptops, 4 on wide screens.
 * Put it inside your <form>; the 조회 button lives in the <ActionBar>.
 *
 * @example
 * <form id="product-search" onSubmit={search}>
 *   <SearchPanel>
 *     <SearchField label="상품명" htmlFor="search-name">
 *       <Input id="search-name" name="q" />
 *     </SearchField>
 *     <SearchField label="사용여부" htmlFor="search-active">…</SearchField>
 *     <SearchField label="상품분류" span={2}>…picker + checkbox…</SearchField>
 *   </SearchPanel>
 * </form>
 */
export function SearchPanel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="search-panel"
      className={cn(
        "grid grid-cols-1 border-t border-l border-input md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4",
        className
      )}
      {...props}
    />
  )
}

/**
 * One [label | input] pair of a <SearchPanel>.
 * - With `htmlFor`, the label is a <label> for that input id.
 * - Without it (several inputs, e.g. a date range), the cell becomes a named
 *   group so screen readers still read the label.
 */
export function SearchField({
  label,
  htmlFor,
  span = 1,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  /** How many pairs wide the cell is: 1, 2, or "full" (the whole row). */
  span?: 1 | 2 | "full"
  className?: string
  children: React.ReactNode
}) {
  const labelClass =
    "flex w-24 shrink-0 items-center bg-label px-2.5 py-1.5 text-[13px] font-bold sm:w-28"

  return (
    <div
      data-slot="search-field"
      role={htmlFor ? undefined : "group"}
      aria-label={htmlFor ? undefined : label}
      className={cn(
        "flex min-h-10 min-w-0 border-r border-b border-input",
        span === 2 && "md:col-span-2",
        span === "full" && "col-span-full",
        className
      )}
    >
      {htmlFor ? (
        <label htmlFor={htmlFor} className={labelClass}>
          {label}
        </label>
      ) : (
        <span aria-hidden="true" className={labelClass}>
          {label}
        </span>
      )}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5">
        {children}
      </div>
    </div>
  )
}
