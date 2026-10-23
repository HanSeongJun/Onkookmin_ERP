import { DatabaseIcon } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"

/**
 * Shown instead of a 재고 screen when the database has no 재고 tables yet
 * (the migration is not applied: InventoryNotReadyError). Pass
 * INVENTORY_NOT_READY_MESSAGE (`@/lib/inventory/queries`) or the message
 * of a loader result. Works in Server and Client Components.
 */
export function InventoryNotReady({ message }: { message: string }) {
  return (
    <section
      role="alert"
      className="flex flex-col items-center gap-3 border border-input px-4 py-10 text-center"
    >
      <DatabaseIcon aria-hidden="true" className="size-8 text-brand" />
      <h2 className="text-base font-bold">
        DB 변경이 아직 반영되지 않았습니다
      </h2>
      <p className="max-w-xl text-[13px] text-muted-foreground">{message}</p>
    </section>
  )
}

/** Placeholder of a 전표 list screen while it loads. */
export function StockDocumentListSkeleton() {
  return (
    <div className="flex flex-col gap-2.5" aria-busy="true">
      <span className="sr-only">전표 목록을 불러오는 중…</span>
      <div className="flex flex-wrap gap-1.5">
        {[16, 16, 22].map((width, index) => (
          <Skeleton
            key={index}
            className="h-8 rounded-sm"
            style={{ width: `${width * 0.25}rem` }}
          />
        ))}
        <Skeleton className="ml-auto h-8 w-28 rounded-sm" />
      </div>
      <div className="grid grid-cols-1 border-t border-l border-input md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
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
      <Skeleton className="h-5 w-36 rounded-sm" />
      <div className="flex flex-col gap-px border border-input">
        <Skeleton className="h-9 rounded-none bg-brand-tint-strong" />
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="h-8 rounded-none" />
        ))}
      </div>
    </div>
  )
}
