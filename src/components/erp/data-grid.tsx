import { Checkbox } from "@/components/ui/checkbox"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * Dense ERP data table: brand-colored header row (stays visible while
 * scrolling), thin cell borders, zebra rows, hover highlight, and both
 * horizontal and vertical scrolling inside a bordered box.
 *
 * @example
 * <DataGridCount shown={rows.length} total={total} />
 * <DataGrid aria-label="상품 목록" containerClassName="max-h-[60svh]">
 *   <DataGridHeader>
 *     <tr>
 *       <DataGridHead className="w-9">
 *         <DataGridCheckbox inHeader aria-label="전체 선택" checked={all} indeterminate={some} onCheckedChange={toggleAll} />
 *       </DataGridHead>
 *       <DataGridHead>상품코드</DataGridHead>
 *       <DataGridHead align="right">매입가</DataGridHead>
 *     </tr>
 *   </DataGridHeader>
 *   <DataGridBody>
 *     {rows.length === 0 && <DataGridEmpty colSpan={3}>조회된 상품이 없습니다.</DataGridEmpty>}
 *     {rows.map((row) => (
 *       <DataGridRow key={row.id} selected={checked.has(row.id)}>
 *         <DataGridCell align="center"><DataGridCheckbox aria-label={`${row.name} 선택`} … /></DataGridCell>
 *         <DataGridCell align="center">{row.code}</DataGridCell>
 *         <DataGridCell numeric>{formatNumber(row.price)}</DataGridCell>
 *       </DataGridRow>
 *     ))}
 *   </DataGridBody>
 * </DataGrid>
 *
 * Two-level header (a group name over several columns, e.g. "매입단가" over
 * [부가세 별도 | 부가세 포함]): two header rows. In the first row, the
 * single columns get rowSpan={2} and each group is a <DataGridHeadGroup>;
 * the second row holds the group's columns as <DataGridHead subHead>.
 * Both rows stay visible while scrolling.
 * @example
 * <DataGridHeader>
 *   <tr>
 *     <DataGridHead rowSpan={2}>상품코드</DataGridHead>
 *     <DataGridHeadGroup colSpan={2}>매입단가</DataGridHeadGroup>
 *     <DataGridHead rowSpan={2}>사용여부</DataGridHead>
 *   </tr>
 *   <tr>
 *     <DataGridHead subHead>부가세 별도</DataGridHead>
 *     <DataGridHead subHead>부가세 포함</DataGridHead>
 *   </tr>
 * </DataGridHeader>
 */
export function DataGrid({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & {
  /**
   * Classes for the scrolling box around the table. Its default height
   * limit is max-h-[65svh]; override it, e.g. "max-h-[calc(100svh-20rem)]".
   */
  containerClassName?: string
}) {
  return (
    <div
      data-slot="data-grid"
      className={cn(
        "relative max-h-[65svh] w-full overflow-auto border border-input bg-background",
        containerClassName
      )}
    >
      {/* border-separate keeps the header borders visible while it sticks. */}
      <table
        className={cn(
          "w-full border-separate border-spacing-0 text-[13px]",
          className
        )}
        {...props}
      />
    </div>
  )
}

export function DataGridHeader(props: React.ComponentProps<"thead">) {
  return <thead data-slot="data-grid-header" {...props} />
}

export function DataGridBody(props: React.ComponentProps<"tbody">) {
  return <tbody data-slot="data-grid-body" {...props} />
}

type CellAlign = "left" | "center" | "right"

const alignClasses: Record<CellAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
}

/** Brand background, white bold text, stays visible while scrolling. */
const headClass =
  "sticky z-10 border-r border-b border-r-white/30 bg-brand px-2 font-bold whitespace-nowrap text-brand-foreground"

/**
 * Header cell: brand background, white bold text. Centered by default.
 * `subHead`: a column of a two-level header (second header row, under a
 * <DataGridHeadGroup>): it sticks just below the first row and keeps its
 * right border (the columns to its right are usually first-row cells).
 */
export function DataGridHead({
  align = "center",
  subHead = false,
  className,
  ...props
}: React.ComponentProps<"th"> & { align?: CellAlign; subHead?: boolean }) {
  return (
    <th
      scope="col"
      data-slot="data-grid-head"
      className={cn(
        headClass,
        "border-b-brand-active",
        // top-6 = the height of the first header row (h-6 group cells).
        subHead ? "top-6 h-6 text-xs" : "top-0 h-9 last:border-r-0",
        alignClasses[align],
        className
      )}
      {...props}
    />
  )
}

/**
 * Group cell of a two-level header: the name over several columns
 * (`colSpan`), e.g. "매입단가" over [부가세 별도 | 부가세 포함]. Put it in
 * the first header row; the columns go in the second row as
 * <DataGridHead subHead>. See the example at <DataGrid>.
 */
export function DataGridHeadGroup({
  className,
  ...props
}: React.ComponentProps<"th"> & { colSpan: number }) {
  return (
    <th
      scope="colgroup"
      data-slot="data-grid-head-group"
      className={cn(
        headClass,
        "top-0 h-6 border-b-white/30 text-center last:border-r-0",
        className
      )}
      {...props}
    />
  )
}

/**
 * Body row with zebra stripes and hover color.
 * `selected` (e.g. its checkbox is checked) tints the row in the brand color.
 */
export function DataGridRow({
  selected = false,
  className,
  ...props
}: React.ComponentProps<"tr"> & { selected?: boolean }) {
  return (
    <tr
      data-slot="data-grid-row"
      data-selected={selected ? "true" : undefined}
      className={cn(
        selected
          ? "bg-brand-tint hover:bg-brand-tint-strong"
          : "bg-background even:bg-zebra hover:bg-row-hover",
        className
      )}
      {...props}
    />
  )
}

/**
 * Body cell. `numeric` right-aligns the value with even-width digits
 * (prices, quantities); otherwise `align` (default left) decides.
 */
export function DataGridCell({
  align = "left",
  numeric = false,
  className,
  ...props
}: React.ComponentProps<"td"> & { align?: CellAlign; numeric?: boolean }) {
  return (
    <td
      data-slot="data-grid-cell"
      className={cn(
        "h-7 border-r border-b border-grid-line px-2 whitespace-nowrap last:border-r-0",
        numeric ? "text-right tabular-nums" : alignClasses[align],
        className
      )}
      {...props}
    />
  )
}

/**
 * Row checkbox, or the select-all checkbox with `inHeader` (white on the
 * brand-colored header). Always give it an aria-label, e.g. "전체 선택".
 */
export function DataGridCheckbox({
  inHeader = false,
  className,
  ...props
}: React.ComponentProps<typeof Checkbox> & { inHeader?: boolean }) {
  return (
    <Checkbox
      className={cn(
        "mx-auto bg-background",
        inHeader &&
          "border-white data-indeterminate:border-white data-indeterminate:bg-background data-indeterminate:text-brand data-checked:border-white data-checked:bg-background data-checked:text-brand",
        // The usual brand-colored focus ring can't be seen on the brand
        // header: use a white ring with a thin brand gap instead.
        inHeader &&
          "focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-1 focus-visible:ring-offset-brand",
        className
      )}
      {...props}
    />
  )
}

/** A single full-width row with a message, e.g. "조회된 상품이 없습니다." */
export function DataGridEmpty({
  colSpan,
  children,
}: {
  colSpan: number
  children: React.ReactNode
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="h-32 border-b border-grid-line px-2 text-center text-muted-foreground"
      >
        {/* Kept in view when the grid is wider than the screen (many
            columns on a phone): sticks to the left edge while scrolling. */}
        <div className="sticky left-2 max-w-[calc(100vw-3rem)]">{children}</div>
      </td>
    </tr>
  )
}

/**
 * Result count above a grid: "300건 / 총 5,944건".
 * `shown` = rows on this page, `total` = all rows matching the search.
 */
export function DataGridCount({
  shown,
  total,
  className,
}: {
  shown: number
  total: number
  className?: string
}) {
  return (
    <p
      data-slot="data-grid-count"
      role="status"
      className={cn("text-[13px]", className)}
    >
      <span className="font-bold">{formatNumber(shown, 0)}</span>건 / 총{" "}
      <span className="font-bold text-brand">{formatNumber(total, 0)}</span>건
    </p>
  )
}
