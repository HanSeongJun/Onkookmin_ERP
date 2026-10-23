import { Skeleton } from "@/components/ui/skeleton"

/**
 * Shown in the work area while a signed-in page is loading: the outline of
 * a typical ERP screen (title, buttons, search form, table).
 * The header bar and the menu stay visible.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only">불러오는 중…</span>
      <div className="flex items-end gap-3 border-b-2 border-grid-line pb-2">
        <Skeleton className="h-7 w-32 rounded-sm" />
        <Skeleton className="h-4 w-56 max-w-full rounded-sm" />
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-20 rounded-sm" />
        ))}
      </div>
      <Skeleton className="h-24 w-full rounded-sm" />
      <div className="flex flex-col gap-px border border-grid-line">
        <Skeleton className="h-9 rounded-none bg-brand-tint-strong" />
        {Array.from({ length: 8 }, (_, index) => (
          <Skeleton key={index} className="h-8 rounded-none" />
        ))}
      </div>
    </div>
  )
}
