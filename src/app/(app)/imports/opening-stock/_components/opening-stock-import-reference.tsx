import { ChevronRightIcon } from "lucide-react"
import { Suspense } from "react"

import {
  getStockPlaceTree,
  INVENTORY_NOT_READY_MESSAGE,
  InventoryNotReadyError,
  type StockWarehouseNode,
} from "@/lib/inventory/queries"
import { storageTypeLabel } from "@/lib/products/constants"

/**
 * Reference for filling in a 기초재고 file, under the tips of 기초재고
 * 일괄등록: every 창고코드 > 구역코드 > 선반코드 that new stock can go into
 * (the 창고, 구역 and 위치 are all 사용), with each 구역's 보관온도. Starts
 * closed.
 *
 * Reads the database with the signed-in user's cookies, so it renders
 * inside its own <Suspense> (never inside "use cache").
 */
export function OpeningStockImportReference() {
  return (
    <Suspense
      fallback={
        <p className="text-muted-foreground">
          창고·구역·선반 코드를 불러오는 중…
        </p>
      }
    >
      <PlaceCodes />
    </Suspense>
  )
}

async function PlaceCodes() {
  let tree: StockWarehouseNode[] | null = null
  try {
    tree = await getStockPlaceTree()
  } catch (error) {
    // The 재고 DB 변경 is not applied yet (hosted DB before db:push).
    if (!(error instanceof InventoryNotReadyError)) throw error
  }
  if (!tree) {
    return (
      <p className="font-bold text-destructive">
        {INVENTORY_NOT_READY_MESSAGE}
      </p>
    )
  }

  const warehouses = tree
    .filter((warehouse) => warehouse.isActive)
    .map((warehouse) => ({
      ...warehouse,
      zones: warehouse.zones
        .filter((zone) => zone.isActive)
        .map((zone) => ({
          ...zone,
          locations: zone.locations.filter((location) => location.canReceive),
        }))
        .filter((zone) => zone.locations.length > 0),
    }))
    .filter((warehouse) => warehouse.zones.length > 0)
  const zoneCount = warehouses.reduce(
    (sum, warehouse) => sum + warehouse.zones.length,
    0
  )

  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm py-0.5 font-bold text-brand outline-none select-none hover:underline focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-open:rotate-90"
        />
        지금 쓸 수 있는 창고·구역·선반 코드 보기
        <span className="font-normal text-muted-foreground">
          (창고 {warehouses.length}곳 · 구역 {zoneCount}개)
        </span>
      </summary>
      <div className="flex flex-col gap-2 pt-1.5 pb-1 pl-5">
        {warehouses.length === 0 ? (
          <p className="text-muted-foreground">
            재고를 넣을 수 있는 창고가 없습니다. 재고관리 → 창고·로케이션
            설정에서 창고와 구역을 먼저 만들어 주세요. (사용중지된 창고·구역·
            선반에는 넣을 수 없습니다.)
          </p>
        ) : (
          warehouses.map((warehouse) => (
            <div key={warehouse.id} className="flex flex-col gap-1">
              <p>
                <span className="font-bold">창고코드 </span>
                <Code>{warehouse.code}</Code> {warehouse.name}
              </p>
              <ul className="flex flex-col gap-1 border-l border-grid-line pl-3">
                {warehouse.zones.map((zone) => (
                  <li
                    key={zone.id}
                    className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1"
                  >
                    <span className="font-bold">구역코드</span>
                    <Code>{zone.code}</Code>
                    <span>
                      {zone.name} ({storageTypeLabel(zone.storageType)})
                    </span>
                    <span className="text-muted-foreground">· 선반코드</span>
                    {zone.locations.map((location) => (
                      <Code key={location.id}>
                        {location.code}
                        {location.isDefault && " (비워도 됨)"}
                      </Code>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </details>
  )
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <span className="border border-grid-line bg-label px-1.5 py-px font-bold tabular-nums">
      {children}
    </span>
  )
}
