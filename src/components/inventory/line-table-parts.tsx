"use client"

import { CopyIcon, Trash2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

/** Classes of a text box inside a line table cell (28px rows). */
export const cellInputClass =
  "h-7 w-full rounded-sm px-1.5 text-[13px] md:text-[13px]"

/**
 * Columns pinned to the left of a wide line table (줄 and 상품), so they
 * stay in view while the other columns scroll sideways (e.g. while typing
 * the 입고단가 far to the right). Add the column's offset too: the 줄
 * column (w-10) `left-0`, the next one `left-10`. Give the pinned columns
 * a fixed width (w-*, not min-w-*) so the offsets stay right.
 * The header cell sits above the other header cells; a body cell takes its
 * row's background (zebra, hover, selected) and covers the cells that
 * scroll under it.
 */
export const stickyLineHeadClass = "sticky z-20"
export const stickyLineCellClass = "sticky z-[1] bg-inherit"

/** A small icon button of a line (삭제, 복사). */
export function LineIconButton({
  kind,
  label,
  onClick,
  disabled = false,
}: {
  kind: "remove" | "copy"
  /** e.g. "2번째 줄 삭제". */
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  const Icon = kind === "remove" ? Trash2Icon : CopyIcon
  return (
    <button
      type="button"
      aria-label={label}
      title={kind === "remove" ? "삭제" : "이 줄 복사"}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40",
        kind === "remove"
          ? "hover:bg-destructive/10 hover:text-destructive"
          : "hover:bg-muted hover:text-foreground"
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  )
}

/** A full-width note row under a line (conversion, warnings). */
export function LineNoteRow({
  colSpan,
  children,
  className,
}: {
  colSpan: number
  children: React.ReactNode
  className?: string
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className={cn(
          "border-b border-grid-line bg-label/60 px-2 py-1 text-xs",
          className
        )}
      >
        {/* Sticky + max width: stays readable while the table scrolls sideways. */}
        <div className="sticky left-2 flex max-w-[calc(100vw-4rem)] flex-col gap-0.5 sm:max-w-[60rem]">
          {children}
        </div>
      </td>
    </tr>
  )
}
