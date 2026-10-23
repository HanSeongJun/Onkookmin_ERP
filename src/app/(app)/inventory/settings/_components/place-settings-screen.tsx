"use client"

import {
  ArrowDownIcon,
  ArrowUpIcon,
  LoaderCircleIcon,
  MinusIcon,
  PlusIcon,
  WarehouseIcon,
} from "lucide-react"
import { Fragment, useOptimistic, useState, useTransition } from "react"
import { toast } from "sonner"

import { ActionBar, ActionButton } from "@/components/erp/action-bar"
import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { Switch } from "@/components/ui/switch"
import { useHotkeys } from "@/hooks/use-hotkeys"
import {
  reorderStockPlaces,
  setStockPlaceActive,
  type StockPlaceDeleteResult,
  type StockPlaceResult,
} from "@/lib/inventory/actions"
import { formatPlacePath } from "@/lib/inventory/constants"
import type {
  InventorySettings,
  StockLocationNode,
  StockWarehouseNode,
  StockZoneNode,
} from "@/lib/inventory/queries"
import { formatNumber } from "@/lib/format"
import { storageTypeLabel } from "@/lib/products/constants"
import { cn } from "@/lib/utils"

import { callPlaceAction } from "./call-place-action"
import {
  DeletePlaceDialog,
  type PlaceDeleteTarget,
} from "./delete-place-dialog"
import { ExpirySettingsForm } from "./expiry-settings-form"
import { LocationDialog, WarehouseDialog, ZoneDialog } from "./place-dialogs"

/** The 추가 / 수정 dialog that is open. */
type Editor =
  | { kind: "warehouse"; warehouse: StockWarehouseNode | null }
  | { kind: "zone"; warehouse: StockWarehouseNode; zone: StockZoneNode | null }
  | {
      kind: "location"
      warehouse: StockWarehouseNode
      zone: StockZoneNode
      location: StockLocationNode | null
    }

type PlaceKind = "warehouse" | "zone" | "location"

/**
 * The 창고·로케이션 설정 screen below the title: 재고 설정 (기한 임박
 * 기준일), then the buttons ([창고 추가 | F5], 모두 펼치기 / 접기) and the
 * table of every 창고 > 구역 > 위치 as a tree with +/−. Each row: 코드,
 * 이름, 구분, 보관온도 (구역), 주소·메모, 재고 (lot × 위치 rows now), 사용
 * switch, 순서 (↑↓ among its siblings), 관리 (하위 추가, 수정, 삭제).
 * Saving refreshes the table (the Server Actions revalidate the page).
 */
export function PlaceSettingsScreen({
  tree,
  settings,
}: {
  tree: StockWarehouseNode[]
  settings: InventorySettings
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [editor, setEditor] = useState<Editor | null>(null)
  const [deleting, setDeleting] = useState<
    (PlaceDeleteTarget & { deactivate: () => void }) | null
  >(null)
  const [isPending, startTransition] = useTransition()
  // 사용 switches flip at once; the server's value takes over when it answers.
  const [activeOverrides, setActiveOverride] = useOptimistic<
    Readonly<Record<string, boolean>>,
    { id: string; value: boolean }
  >({}, (state, change) => ({ ...state, [change.id]: change.value }))

  useHotkeys({
    F5: () => {
      if (!document.querySelector('[data-slot="erp-dialog"]')) {
        setEditor({ kind: "warehouse", warehouse: null })
      }
    },
  })

  const zoneCount = tree.reduce(
    (sum, warehouse) => sum + warehouse.zones.length,
    0
  )
  const locationCount = tree.reduce(
    (sum, warehouse) =>
      sum +
      warehouse.zones.reduce((count, zone) => count + zone.locations.length, 0),
    0
  )
  const idsWithChildren = [
    ...tree.filter((warehouse) => warehouse.zones.length > 0).map((w) => w.id),
    ...tree.flatMap((warehouse) =>
      warehouse.zones
        .filter((zone) => zone.locations.length > 0)
        .map((zone) => zone.id)
    ),
  ]

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function isActive(id: string, saved: boolean): boolean {
    return activeOverrides[id] ?? saved
  }

  // ---- 사용 / 사용중지 --------------------------------------------------------

  function setWarehouseActive(warehouse: StockWarehouseNode, value: boolean) {
    startTransition(async () => {
      setActiveOverride({ id: warehouse.id, value })
      const result = await callPlaceAction<StockPlaceResult>(() =>
        setStockPlaceActive("warehouse", warehouse.id, value)
      )
      showActiveResult(result, `창고 ‘${warehouse.name}’`, value)
    })
  }

  function setZoneActive(zone: StockZoneNode, value: boolean) {
    startTransition(async () => {
      setActiveOverride({ id: zone.id, value })
      const result = await callPlaceAction<StockPlaceResult>(() =>
        setStockPlaceActive("zone", zone.id, value)
      )
      showActiveResult(result, `구역 ‘${zone.name}’`, value)
    })
  }

  function setLocationActive(location: StockLocationNode, value: boolean) {
    startTransition(async () => {
      setActiveOverride({ id: location.id, value })
      const result = await callPlaceAction<StockPlaceResult>(() =>
        setStockPlaceActive("location", location.id, value)
      )
      showActiveResult(result, `위치 ‘${location.code}’`, value)
    })
  }

  function showActiveResult(
    result: StockPlaceResult | null,
    what: string,
    value: boolean
  ) {
    if (!result) return
    if (!result.ok) {
      toast.error(result.message)
      return
    }
    toast.success(
      value
        ? `${what}을(를) 다시 사용합니다.`
        : `${what}을(를) 사용중지했습니다. 새 재고를 넣을 수 없고, 있는 재고는 꺼낼 수 있습니다.`
    )
  }

  // ---- 순서 -----------------------------------------------------------------

  function move(
    kind: PlaceKind,
    siblings: readonly { id: string }[],
    index: number,
    step: -1 | 1
  ) {
    const target = index + step
    if (target < 0 || target >= siblings.length) return
    const ids = siblings.map((item) => item.id)
    ;[ids[index], ids[target]] = [ids[target], ids[index]]
    startTransition(async () => {
      const result = await callPlaceAction<StockPlaceDeleteResult>(() =>
        reorderStockPlaces(kind, ids)
      )
      if (result && !result.ok) toast.error(result.message)
    })
  }

  // ---- Screen ---------------------------------------------------------------

  function deleteTarget(
    kind: PlaceKind,
    node: { id: string; isUsed: boolean; isActive: boolean },
    path: string,
    counts: { zones: number; locations: number },
    isDefault: boolean,
    deactivate: () => void
  ) {
    setDeleting({
      kind,
      id: node.id,
      path,
      isUsed: node.isUsed,
      isDefault,
      isActive: node.isActive,
      zoneCount: counts.zones,
      locationCount: counts.locations,
      deactivate,
    })
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ExpirySettingsForm settings={settings} />

      <section
        aria-labelledby="places-title"
        className="flex min-w-0 flex-col gap-2.5"
      >
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 id="places-title" className="text-[15px] font-bold">
            창고 · 구역 · 위치
          </h2>
          <p className="text-[13px]">
            창고{" "}
            <strong className="font-bold text-brand">
              {formatNumber(tree.length, 0)}
            </strong>
            개 · 구역{" "}
            <strong className="font-bold">{formatNumber(zoneCount, 0)}</strong>
            개 · 위치{" "}
            <strong className="font-bold">
              {formatNumber(locationCount, 0)}
            </strong>
            개
          </p>
          {isPending && (
            <LoaderCircleIcon
              aria-label="저장하는 중"
              className="size-4 animate-spin text-muted-foreground"
            />
          )}
        </div>

        <ActionBar
          end={
            tree.length > 0 && (
              <>
                <ActionButton
                  variant="neutral"
                  disabled={collapsed.size === 0}
                  onClick={() => setCollapsed(new Set())}
                >
                  모두 펼치기
                </ActionButton>
                <ActionButton
                  variant="neutral"
                  disabled={idsWithChildren.every((id) => collapsed.has(id))}
                  onClick={() => setCollapsed(new Set(idsWithChildren))}
                >
                  모두 접기
                </ActionButton>
              </>
            )
          }
        >
          <ActionButton
            keyHint="F5"
            onClick={() => setEditor({ kind: "warehouse", warehouse: null })}
          >
            <PlusIcon aria-hidden="true" />
            창고 추가
          </ActionButton>
        </ActionBar>

        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-xs text-muted-foreground marker:text-brand">
          <li>
            창고 → 구역 → 위치(선반) 순서로 만듭니다. 구역마다
            보관온도(상온·냉장·냉동)를 정하고, 구역을 만들면 ‘기본’ 위치가
            자동으로 생깁니다(삭제 불가).
          </li>
          <li>
            사용중지하면 그 아래 모든 위치에 새 재고를 넣을 수 없습니다. 이미
            있는 재고는 그대로이고 출고·폐기·이동으로 꺼낼 수 있습니다.
          </li>
          <li>
            삭제는 재고를 한 번도 넣은 적이 없는 곳만 됩니다(아래 구역·위치도
            함께 삭제). 쓰던 곳은 사용중지해 주세요. ‘재고’는 지금 재고가 있는
            로트×위치 줄 수입니다.
          </li>
        </ul>

        {tree.length === 0 ? (
          <section className="flex flex-col items-center gap-3 border border-input px-4 py-10 text-center">
            <WarehouseIcon aria-hidden="true" className="size-8 text-brand" />
            <h3 className="text-base font-bold">아직 창고가 없습니다.</h3>
            <p className="max-w-xl text-muted-foreground">
              재고를 넣으려면 창고와 구역이 있어야 합니다. 먼저 창고를 만들고,
              그 안에 보관온도별 구역(예: 상온 A구역, 냉장 B구역, 냉동 C구역)을
              추가해 주세요.
            </p>
            <ActionButton
              onClick={() => setEditor({ kind: "warehouse", warehouse: null })}
            >
              <PlusIcon aria-hidden="true" />첫 창고 만들기
            </ActionButton>
          </section>
        ) : (
          <DataGrid
            aria-label="창고·구역·위치 목록"
            containerClassName="max-h-[max(22rem,calc(100svh-24rem))]"
            className="min-w-[66rem]"
          >
            <DataGridHeader>
              <tr>
                <DataGridHead className="left-0 z-20 min-w-56">
                  코드
                </DataGridHead>
                <DataGridHead className="min-w-40">이름</DataGridHead>
                <DataGridHead className="w-14">구분</DataGridHead>
                <DataGridHead className="w-20">보관온도</DataGridHead>
                <DataGridHead className="w-40">주소 · 메모</DataGridHead>
                <DataGridHead className="w-16">재고</DataGridHead>
                <DataGridHead className="w-28">사용 여부</DataGridHead>
                <DataGridHead className="w-20">순서</DataGridHead>
                {/* Pinned on the right: 추가 / 수정 / 삭제 stay in view on
                    a laptop screen while the table scrolls sideways. */}
                <DataGridHead className="right-0 z-20 w-px border-l border-l-white/30">
                  관리
                </DataGridHead>
              </tr>
            </DataGridHeader>
            <DataGridBody>
              {tree.map((warehouse, warehouseIndex) => {
                const warehouseActive = isActive(
                  warehouse.id,
                  warehouse.isActive
                )
                const warehouseOpen = !collapsed.has(warehouse.id)
                const warehouseLocations = warehouse.zones.reduce(
                  (sum, zone) => sum + zone.locations.length,
                  0
                )
                return (
                  <Fragment key={warehouse.id}>
                    <PlaceRow
                      depth={0}
                      code={warehouse.code}
                      name={warehouse.name}
                      kindLabel="창고"
                      storage={null}
                      note={
                        [warehouse.address, warehouse.addressDetail]
                          .filter(Boolean)
                          .join(" ") ||
                        warehouse.note ||
                        ""
                      }
                      stockRowCount={warehouse.stockRowCount}
                      active={warehouseActive}
                      greyed={!warehouseActive}
                      hasChildren={warehouse.zones.length > 0}
                      expanded={warehouseOpen}
                      onToggle={() => toggle(warehouse.id)}
                      onActiveChange={(value) =>
                        setWarehouseActive(warehouse, value)
                      }
                      isFirst={warehouseIndex === 0}
                      isLast={warehouseIndex === tree.length - 1}
                      onMove={(step) =>
                        move("warehouse", tree, warehouseIndex, step)
                      }
                      pending={isPending}
                      addLabel="구역 추가"
                      onAdd={() =>
                        setEditor({ kind: "zone", warehouse, zone: null })
                      }
                      onEdit={() => setEditor({ kind: "warehouse", warehouse })}
                      onDelete={() =>
                        deleteTarget(
                          "warehouse",
                          { ...warehouse, isActive: warehouseActive },
                          warehouse.name,
                          {
                            zones: warehouse.zones.length,
                            locations: warehouseLocations,
                          },
                          false,
                          () => setWarehouseActive(warehouse, false)
                        )
                      }
                    />
                    {warehouseOpen &&
                      warehouse.zones.map((zone, zoneIndex) => {
                        const zoneActive = isActive(zone.id, zone.isActive)
                        const zoneOpen = !collapsed.has(zone.id)
                        return (
                          <Fragment key={zone.id}>
                            <PlaceRow
                              depth={1}
                              code={zone.code}
                              name={zone.name}
                              kindLabel="구역"
                              storage={storageTypeLabel(zone.storageType)}
                              note={zone.note ?? ""}
                              stockRowCount={zone.stockRowCount}
                              active={zoneActive}
                              greyed={!warehouseActive || !zoneActive}
                              hasChildren={zone.locations.length > 0}
                              expanded={zoneOpen}
                              onToggle={() => toggle(zone.id)}
                              onActiveChange={(value) =>
                                setZoneActive(zone, value)
                              }
                              isFirst={zoneIndex === 0}
                              isLast={zoneIndex === warehouse.zones.length - 1}
                              onMove={(step) =>
                                move("zone", warehouse.zones, zoneIndex, step)
                              }
                              pending={isPending}
                              addLabel="위치 추가"
                              onAdd={() =>
                                setEditor({
                                  kind: "location",
                                  warehouse,
                                  zone,
                                  location: null,
                                })
                              }
                              onEdit={() =>
                                setEditor({ kind: "zone", warehouse, zone })
                              }
                              onDelete={() =>
                                deleteTarget(
                                  "zone",
                                  { ...zone, isActive: zoneActive },
                                  formatPlacePath(warehouse.name, zone.name),
                                  {
                                    zones: 0,
                                    locations: zone.locations.length,
                                  },
                                  false,
                                  () => setZoneActive(zone, false)
                                )
                              }
                            />
                            {zoneOpen &&
                              zone.locations.map((location) => {
                                const locationActive = isActive(
                                  location.id,
                                  location.isActive
                                )
                                // The 기본 위치 always comes first: only the
                                // other 위치 change places among themselves.
                                const movable = zone.locations.filter(
                                  (item) => !item.isDefault
                                )
                                const movableIndex = movable.indexOf(location)
                                return (
                                  <PlaceRow
                                    key={location.id}
                                    depth={2}
                                    code={location.code}
                                    name={location.name ?? ""}
                                    kindLabel="위치"
                                    isDefault={location.isDefault}
                                    storage={null}
                                    note=""
                                    stockRowCount={location.stockRowCount}
                                    active={locationActive}
                                    greyed={
                                      !warehouseActive ||
                                      !zoneActive ||
                                      !locationActive
                                    }
                                    hasChildren={false}
                                    expanded={false}
                                    onToggle={() => {}}
                                    onActiveChange={(value) =>
                                      setLocationActive(location, value)
                                    }
                                    isFirst={movableIndex <= 0}
                                    isLast={
                                      movableIndex < 0 ||
                                      movableIndex === movable.length - 1
                                    }
                                    onMove={(step) =>
                                      move(
                                        "location",
                                        movable,
                                        movableIndex,
                                        step
                                      )
                                    }
                                    pending={isPending}
                                    onEdit={() =>
                                      setEditor({
                                        kind: "location",
                                        warehouse,
                                        zone,
                                        location,
                                      })
                                    }
                                    onDelete={() =>
                                      deleteTarget(
                                        "location",
                                        {
                                          ...location,
                                          isActive: locationActive,
                                        },
                                        formatPlacePath(
                                          warehouse.name,
                                          zone.name,
                                          location.code
                                        ),
                                        { zones: 0, locations: 0 },
                                        location.isDefault,
                                        () => setLocationActive(location, false)
                                      )
                                    }
                                  />
                                )
                              })}
                          </Fragment>
                        )
                      })}
                  </Fragment>
                )
              })}
            </DataGridBody>
          </DataGrid>
        )}
      </section>

      {editor?.kind === "warehouse" && (
        <WarehouseDialog
          warehouse={editor.warehouse}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.kind === "zone" && (
        <ZoneDialog
          warehouse={editor.warehouse}
          zone={editor.zone}
          onClose={() => setEditor(null)}
        />
      )}
      {editor?.kind === "location" && (
        <LocationDialog
          warehouse={editor.warehouse}
          zone={editor.zone}
          location={editor.location}
          onClose={() => setEditor(null)}
        />
      )}
      {deleting && (
        <DeletePlaceDialog
          target={deleting}
          onClose={() => setDeleting(null)}
          onDeactivate={deleting.deactivate}
        />
      )}
    </div>
  )
}

const INDENT = ["pl-0", "pl-5 sm:pl-6", "pl-10 sm:pl-12"] as const

/** One 창고 / 구역 / 위치 row of the settings table. */
function PlaceRow({
  depth,
  code,
  name,
  kindLabel,
  isDefault = false,
  storage,
  note,
  stockRowCount,
  active,
  greyed,
  hasChildren,
  expanded,
  onToggle,
  onActiveChange,
  isFirst,
  isLast,
  onMove,
  pending,
  addLabel,
  onAdd,
  onEdit,
  onDelete,
}: {
  depth: 0 | 1 | 2
  code: string
  name: string
  kindLabel: "창고" | "구역" | "위치"
  isDefault?: boolean
  /** 보관온도 label (구역), or null. */
  storage: string | null
  note: string
  stockRowCount: number
  active: boolean
  /** It or a level above it is 사용중지. */
  greyed: boolean
  hasChildren: boolean
  expanded: boolean
  onToggle: () => void
  onActiveChange: (value: boolean) => void
  isFirst: boolean
  isLast: boolean
  onMove: (step: -1 | 1) => void
  pending: boolean
  addLabel?: string
  onAdd?: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const label = `${kindLabel} ‘${name || code}’`
  return (
    <DataGridRow
      className={cn(greyed && "text-muted-foreground")}
      title={
        greyed && active
          ? "위 단계(창고·구역)가 사용중지되어 새 재고를 넣을 수 없습니다."
          : undefined
      }
    >
      <DataGridCell className="sticky left-0 z-[1] bg-inherit">
        <div className={cn("flex items-center gap-1.5", INDENT[depth])}>
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${label} 아래 ${expanded ? "접기" : "펼치기"}`}
              onClick={onToggle}
              className="flex size-[18px] shrink-0 items-center justify-center rounded-[2px] border border-input bg-background text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3"
            >
              {expanded ? (
                <MinusIcon aria-hidden="true" />
              ) : (
                <PlusIcon aria-hidden="true" />
              )}
            </button>
          ) : (
            <span aria-hidden="true" className="size-[18px] shrink-0" />
          )}
          <span className={cn("tabular-nums", depth < 2 && "font-bold")}>
            {code}
          </span>
          {isDefault && (
            <span className="rounded-sm border border-input px-1 text-[11px]">
              기본
            </span>
          )}
        </div>
      </DataGridCell>
      <DataGridCell className="max-w-64 truncate" title={name || undefined}>
        {name}
      </DataGridCell>
      <DataGridCell align="center">{kindLabel}</DataGridCell>
      <DataGridCell align="center" className={cn(storage && "font-bold")}>
        {storage ?? ""}
      </DataGridCell>
      <DataGridCell className="text-xs" title={note || undefined}>
        {/* Cut to the column's width (the whole text is the tooltip). */}
        <span className="block max-w-36 truncate">{note}</span>
      </DataGridCell>
      <DataGridCell numeric>
        {stockRowCount > 0 ? formatNumber(stockRowCount, 0) : "-"}
      </DataGridCell>
      <DataGridCell align="center">
        <span className="inline-flex items-center gap-1.5">
          <Switch
            aria-label={`${label} 사용`}
            checked={active}
            disabled={pending}
            onCheckedChange={onActiveChange}
          />
          <span className="w-12 text-left text-xs">
            {active ? "사용" : "사용중지"}
          </span>
        </span>
      </DataGridCell>
      <DataGridCell align="center">
        <span className="inline-flex gap-1">
          <ActionButton
            variant="neutral"
            size="sm"
            className="w-6 px-0"
            aria-label={`${label} 위로 이동`}
            title="위로 이동"
            disabled={isFirst || pending}
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon aria-hidden="true" />
          </ActionButton>
          <ActionButton
            variant="neutral"
            size="sm"
            className="w-6 px-0"
            aria-label={`${label} 아래로 이동`}
            title="아래로 이동"
            disabled={isLast || pending}
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon aria-hidden="true" />
          </ActionButton>
        </span>
      </DataGridCell>
      <DataGridCell className="sticky right-0 z-[1] border-l border-l-grid-line bg-inherit">
        <span className="flex items-center gap-1">
          {addLabel && onAdd ? (
            <ActionButton
              variant="neutral"
              size="sm"
              className="w-[5.5rem]"
              aria-label={`${label}에 ${addLabel}`}
              onClick={onAdd}
            >
              <PlusIcon aria-hidden="true" />
              {addLabel}
            </ActionButton>
          ) : (
            <span aria-hidden="true" className="w-[5.5rem] shrink-0" />
          )}
          <ActionButton
            variant="neutral"
            size="sm"
            aria-label={`${label} 수정`}
            onClick={onEdit}
          >
            수정
          </ActionButton>
          <ActionButton
            variant="neutral"
            size="sm"
            className="text-destructive"
            aria-label={`${label} 삭제`}
            onClick={onDelete}
          >
            삭제
          </ActionButton>
        </span>
      </DataGridCell>
    </DataGridRow>
  )
}
