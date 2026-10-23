import type {
  StockLocationNode,
  StockWarehouseNode,
  StockZoneNode,
} from "@/lib/inventory/queries"

/** A chosen 창고 / 구역 / 위치 filter (null = 전체). */
export type PlaceIds = {
  warehouseId: string | null
  zoneId: string | null
  locationId: string | null
}

/**
 * The place filter of a URL made consistent with the 창고 > 구역 > 위치
 * tree: unknown ids are dropped, and the most specific valid one wins with
 * its parents filled in (a 위치 → its 구역 and 창고; a 구역 → its 창고).
 * Old links to a deleted place then simply show every place.
 *
 * Plain function (no server or browser APIs): pages call it on the server.
 */
export function normalizePlaceIds(
  places: readonly StockWarehouseNode[],
  ids: PlaceIds
): PlaceIds {
  const found = findPlace(places, ids)
  if (found.location) {
    return {
      warehouseId: found.warehouse.id,
      zoneId: found.zone.id,
      locationId: found.location.id,
    }
  }
  if (found.zone) {
    return {
      warehouseId: found.warehouse.id,
      zoneId: found.zone.id,
      locationId: null,
    }
  }
  if (found.warehouse) {
    return { warehouseId: found.warehouse.id, zoneId: null, locationId: null }
  }
  return { warehouseId: null, zoneId: null, locationId: null }
}

type FoundPlace =
  | {
      warehouse: StockWarehouseNode
      zone: StockZoneNode
      location: StockLocationNode
    }
  | { warehouse: StockWarehouseNode; zone: StockZoneNode; location?: never }
  | { warehouse: StockWarehouseNode; zone?: never; location?: never }
  | { warehouse?: never; zone?: never; location?: never }

/** The most specific place of `ids` that exists, with its parents. */
export function findPlace(
  places: readonly StockWarehouseNode[],
  ids: PlaceIds
): FoundPlace {
  if (ids.locationId) {
    for (const warehouse of places) {
      for (const zone of warehouse.zones) {
        const location = zone.locations.find(
          (item) => item.id === ids.locationId
        )
        if (location) return { warehouse, zone, location }
      }
    }
  }
  if (ids.zoneId) {
    for (const warehouse of places) {
      const zone = warehouse.zones.find((item) => item.id === ids.zoneId)
      if (zone) return { warehouse, zone }
    }
  }
  if (ids.warehouseId) {
    const warehouse = places.find((item) => item.id === ids.warehouseId)
    if (warehouse) return { warehouse }
  }
  return {}
}

/** "본사 물류센터 > 냉장 B구역 > B-02-R02", or "전체 창고". */
export function placeLabel(
  places: readonly StockWarehouseNode[],
  ids: PlaceIds
): string {
  const found = findPlace(places, ids)
  if (!found.warehouse) return "전체 창고"
  return [found.warehouse.name, found.zone?.name, found.location?.code]
    .filter((part): part is string => !!part)
    .join(" > ")
}
