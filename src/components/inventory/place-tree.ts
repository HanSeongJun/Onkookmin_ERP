/**
 * Client-safe helpers for the 창고 > 구역 > 위치 tree (StockWarehouseNode[]
 * from loadStockPlaces() / getStockPlaceTree()).
 *
 * No server imports (only types), so Client Components may use it.
 */

import { formatPlacePath } from "@/lib/inventory/constants"
import type {
  StockLocationNode,
  StockWarehouseNode,
  StockZoneNode,
} from "@/lib/inventory/queries"

/** Which level of the tree a chosen place is. */
export type StockPlaceLevel = "warehouse" | "zone" | "location"

/** A place found in the tree, with the levels above it. */
export type FoundStockPlace = {
  level: StockPlaceLevel
  id: string
  warehouse: StockWarehouseNode
  /** Null for a 창고. */
  zone: StockZoneNode | null
  /** Null for a 창고 or 구역. */
  location: StockLocationNode | null
}

/** A 위치 found in the tree, with its 구역 and 창고. */
export type FoundStockLocation = FoundStockPlace & {
  level: "location"
  zone: StockZoneNode
  location: StockLocationNode
}

/**
 * The 창고, 구역 or 위치 with this id (any level), or null.
 * @example findStockPlace(tree, zoneId)?.zone?.storageType // "chilled"
 */
export function findStockPlace(
  tree: readonly StockWarehouseNode[],
  id: string | null | undefined
): FoundStockPlace | null {
  if (!id) return null
  for (const warehouse of tree) {
    if (warehouse.id === id) {
      return { level: "warehouse", id, warehouse, zone: null, location: null }
    }
    for (const zone of warehouse.zones) {
      if (zone.id === id) {
        return { level: "zone", id, warehouse, zone, location: null }
      }
      for (const location of zone.locations) {
        if (location.id === id) {
          return { level: "location", id, warehouse, zone, location }
        }
      }
    }
  }
  return null
}

/** The 위치 with this id (with its 구역 and 창고), or null. */
export function findStockLocation(
  tree: readonly StockWarehouseNode[],
  locationId: string | null | undefined
): FoundStockLocation | null {
  const found = findStockPlace(tree, locationId)
  return found?.level === "location" ? (found as FoundStockLocation) : null
}

/**
 * "본사 물류센터 > 냉장 B구역 > B-02-R02" (창고명 > 구역명 > 위치코드), as
 * far down as the place goes.
 */
export function stockPlacePath(place: FoundStockPlace): string {
  return formatPlacePath(
    place.warehouse.name,
    place.zone?.name ?? "",
    place.location?.code ?? null
  )
}

/**
 * Whether the place and every level above it are 사용 (new stock may go
 * into a 위치 only then; the database checks the same).
 */
export function isStockPlaceActive(place: FoundStockPlace): boolean {
  return (
    place.warehouse.isActive &&
    (place.zone?.isActive ?? true) &&
    (place.location?.isActive ?? true)
  )
}

/**
 * The filter ids of a chosen place, as the 출고 line and the report
 * filters take them: only the chosen level is set.
 * @example placeFilterIds(found) // { warehouseId: null, zoneId: "…", locationId: null }
 */
export function placeFilterIds(
  place: Pick<FoundStockPlace, "level" | "id"> | null
): {
  warehouseId: string | null
  zoneId: string | null
  locationId: string | null
} {
  return {
    warehouseId: place?.level === "warehouse" ? place.id : null,
    zoneId: place?.level === "zone" ? place.id : null,
    locationId: place?.level === "location" ? place.id : null,
  }
}

/** Every 위치 that can take new stock (it, its 구역 and 창고 are 사용). */
export function receivableLocations(
  tree: readonly StockWarehouseNode[]
): FoundStockLocation[] {
  return tree.flatMap((warehouse) =>
    warehouse.zones.flatMap((zone) =>
      zone.locations
        .filter((location) => location.canReceive)
        .map((location): FoundStockLocation => ({
          level: "location",
          id: location.id,
          warehouse,
          zone,
          location,
        }))
    )
  )
}
