import { Skeleton } from "@/components/ui/skeleton"

/**
 * Placeholder with the outline of a 자료일괄등록 screen (buttons, steps,
 * file box) while it loads.
 */
export function ImportScreenSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only">일괄등록 화면을 불러오는 중…</span>
      <div className="flex flex-wrap gap-1.5">
        {[28, 20, 24, 24].map((width, index) => (
          <Skeleton
            key={index}
            className="h-8 rounded-sm"
            style={{ width: `${width * 0.25}rem` }}
          />
        ))}
      </div>
      <div className="grid grid-cols-2 border-t border-l border-input xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="flex items-start gap-2.5 border-r border-b border-input px-3 py-2"
          >
            <Skeleton className="size-6 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-24 rounded-sm" />
              <Skeleton className="hidden h-3 w-full max-w-56 rounded-sm sm:block" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-sm" />
      <Skeleton className="h-10 w-full rounded-sm" />
    </div>
  )
}
