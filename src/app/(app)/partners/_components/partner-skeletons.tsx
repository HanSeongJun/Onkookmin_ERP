import { Skeleton } from "@/components/ui/skeleton"

/**
 * Placeholder for the 거래처관리 screen while it loads: action buttons, the
 * 조회 conditions, the count and the grid.
 */
export function PartnerListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true">
      <span className="sr-only">거래처 목록을 불러오는 중…</span>
      <div className="flex flex-wrap gap-1.5">
        {[16, 16, 20, 22].map((width, index) => (
          <Skeleton
            key={index}
            className="h-8 rounded-sm"
            style={{ width: `${width * 0.25}rem` }}
          />
        ))}
        <Skeleton className="ml-auto h-8 w-28 rounded-sm" />
      </div>
      <div className="grid grid-cols-1 border-t border-l border-input md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {Array.from({ length: 10 }, (_, index) => (
          <div
            key={index}
            className="flex min-h-10 border-r border-b border-input"
          >
            <div className="w-24 shrink-0 bg-label sm:w-28" />
            <div className="flex flex-1 items-center px-2">
              <Skeleton className="h-6 w-full max-w-56 rounded-sm" />
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between pt-1">
        <Skeleton className="h-5 w-36 rounded-sm" />
        <Skeleton className="h-8 w-32 rounded-sm" />
      </div>
      <div className="flex flex-col gap-px border border-input">
        <Skeleton className="h-9 rounded-none bg-brand-tint-strong" />
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="h-8 rounded-none" />
        ))}
      </div>
    </div>
  )
}
