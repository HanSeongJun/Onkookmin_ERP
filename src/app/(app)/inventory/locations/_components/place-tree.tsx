"use client"

import { MinusIcon, PlusIcon } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { formatNumber } from "@/lib/format"
import type { StockWarehouseNode } from "@/lib/inventory/queries"
import { storageTypeLabel } from "@/lib/products/constants"
import { cn } from "@/lib/utils"

import type { PlaceIds } from "../../_components/place-filter"

/**
 * The 창고 > 구역 > 위치(선반) tree on the left of 재고처별 재고현황. A
 * click shows only the stock of that place (and everything below it);
 * "전체 창고" shows all. +/− open and close a level. The number after a
 * place is how many (로트 × 위치) rows have stock there now; places without
 * stock are grey. 사용중지 places are listed too (they may still hold
 * stock).
 */
export function PlaceTree({
  places,
  selected,
  onSelect,
}: {
  places: StockWarehouseNode[]
  selected: PlaceIds
  onSelect: (place: PlaceIds) => void
}) {
  // Open: every 창고, and the 구역 of the chosen place. (Adjusting state
  // while rendering when the choice changes, as the React docs recommend.)
  const [expanded, setExpanded] = useState<Set<string>>(() =>
    initialExpanded(places, selected)
  )
  const [shownZoneId, setShownZoneId] = useState(selected.zoneId)
  if (shownZoneId !== selected.zoneId) {
    setShownZoneId(selected.zoneId)
    const zoneId = selected.zoneId
    if (zoneId && !expanded.has(zoneId)) {
      setExpanded((current) => new Set(current).add(zoneId))
    }
  }

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const total = places.reduce((sum, item) => sum + item.stockRowCount, 0)
  const nothingSelected =
    !selected.warehouseId && !selected.zoneId && !selected.locationId

  return (
    <nav aria-label="창고·구역·위치" className="text-[13px]">
      <ul className="flex flex-col">
        <li>
          <TreeButton
            depth={0}
            label="전체 창고"
            count={total}
            selected={nothingSelected}
            onClick={() =>
              onSelect({ warehouseId: null, zoneId: null, locationId: null })
            }
          />
        </li>
        {places.map((warehouse) => (
          <li key={warehouse.id}>
            <TreeButton
              depth={1}
              label={warehouse.name}
              code={warehouse.code}
              count={warehouse.stockRowCount}
              inactive={!warehouse.isActive}
              selected={
                selected.warehouseId === warehouse.id &&
                !selected.zoneId &&
                !selected.locationId
              }
              expanded={expanded.has(warehouse.id)}
              onToggle={
                warehouse.zones.length > 0
                  ? () => toggle(warehouse.id)
                  : undefined
              }
              onClick={() =>
                onSelect({
                  warehouseId: warehouse.id,
                  zoneId: null,
                  locationId: null,
                })
              }
            />
            {expanded.has(warehouse.id) && warehouse.zones.length > 0 && (
              <ul>
                {warehouse.zones.map((zone) => (
                  <li key={zone.id}>
                    <TreeButton
                      depth={2}
                      label={zone.name}
                      note={storageTypeLabel(zone.storageType)}
                      count={zone.stockRowCount}
                      inactive={!zone.isActive}
                      selected={
                        selected.zoneId === zone.id && !selected.locationId
                      }
                      expanded={expanded.has(zone.id)}
                      onToggle={
                        zone.locations.length > 0
                          ? () => toggle(zone.id)
                          : undefined
                      }
                      onClick={() =>
                        onSelect({
                          warehouseId: warehouse.id,
                          zoneId: zone.id,
                          locationId: null,
                        })
                      }
                    />
                    {expanded.has(zone.id) && (
                      <ul>
                        {zone.locations.map((location) => (
                          <li key={location.id}>
                            <TreeButton
                              depth={3}
                              label={location.code}
                              note={location.name ?? undefined}
                              count={location.stockRowCount}
                              inactive={!location.isActive}
                              selected={selected.locationId === location.id}
                              onClick={() =>
                                onSelect({
                                  warehouseId: warehouse.id,
                                  zoneId: zone.id,
                                  locationId: location.id,
                                })
                              }
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {places.length === 0 && (
        <p className="px-2 py-3 text-muted-foreground">
          창고가 없습니다.{" "}
          <Link
            href="/inventory/settings"
            className="font-bold text-brand underline underline-offset-4"
          >
            창고·로케이션 설정
          </Link>
          에서 만들어 주세요.
        </p>
      )}
    </nav>
  )
}

/** One line of the tree: [+/−] name (count). */
function TreeButton({
  depth,
  label,
  code,
  note,
  count,
  inactive = false,
  selected,
  expanded,
  onToggle,
  onClick,
}: {
  depth: 0 | 1 | 2 | 3
  label: string
  code?: string
  /** Grey text after the name (보관온도, 위치 이름). */
  note?: string
  count: number
  inactive?: boolean
  selected: boolean
  expanded?: boolean
  onToggle?: () => void
  onClick: () => void
}) {
  const indent = ["pl-1", "pl-1", "pl-5", "pl-9"][depth]
  return (
    <div
      className={cn(
        "flex min-h-8 items-center gap-0.5 border-b border-grid-line pr-1",
        indent,
        selected && "bg-brand-tint"
      )}
    >
      {onToggle ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${label} ${expanded ? "접기" : "펼치기"}`}
          onClick={onToggle}
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? (
            <MinusIcon aria-hidden="true" className="size-3.5" />
          ) : (
            <PlusIcon aria-hidden="true" className="size-3.5" />
          )}
        </button>
      ) : (
        <span aria-hidden="true" className="size-6 shrink-0" />
      )}
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        onClick={onClick}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1 py-1 text-left outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring",
          selected && "font-bold text-brand-active",
          depth === 0 && "font-bold",
          count === 0 && !selected && "text-muted-foreground"
        )}
      >
        <span className="truncate">
          {code && (
            <span className="mr-1 text-xs text-muted-foreground tabular-nums">
              {code}
            </span>
          )}
          {label}
          {note && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {note}
            </span>
          )}
          {inactive && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              (사용중지)
            </span>
          )}
        </span>
        {count > 0 && (
          <span
            className="ml-auto shrink-0 rounded-sm bg-label px-1 text-xs text-muted-foreground tabular-nums"
            title={`재고 있는 로트·위치 ${formatNumber(count, 0)}줄`}
          >
            {formatNumber(count, 0)}
          </span>
        )}
      </button>
    </div>
  )
}

/** Every 창고 open, plus the 구역 of the chosen place. */
function initialExpanded(
  places: StockWarehouseNode[],
  selected: PlaceIds
): Set<string> {
  const ids = new Set(places.map((warehouse) => warehouse.id))
  if (selected.zoneId) ids.add(selected.zoneId)
  return ids
}
