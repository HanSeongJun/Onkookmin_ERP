"use client"

import {
  LoaderCircleIcon,
  MinusIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react"
import { useMemo, useRef, useState } from "react"

import { ActionButton } from "@/components/erp/action-bar"
import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridEmpty,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { Input } from "@/components/ui/input"
import type { StockWarehouseNode } from "@/lib/inventory/queries"
import { formatNumber } from "@/lib/format"
import { storageTypeLabel, type StorageType } from "@/lib/products/constants"
import { cn } from "@/lib/utils"

import {
  findStockPlace,
  type FoundStockPlace,
  type StockPlaceLevel,
} from "./place-tree"
import { StorageFitIcon } from "./storage-fit"

/** Number of columns (for the full-width message rows). */
const COLUMN_COUNT = 4

/**
 * What the picker is for:
 * - "receive": a 위치 for NEW stock (입고, 이동의 받는 위치, 실사 발견 재고):
 *   only 위치 whose 위치, 구역 and 창고 are all 사용 are shown;
 * - "filter": a 조회 condition or a 실사 scope: everything is shown,
 *   사용중지 ones greyed out (stock may still be there).
 */
export type StockPlacePurpose = "receive" | "filter"

/**
 * Which levels can be chosen: "location" (a 위치 only; 창고 and 구역 rows
 * are headings) or "any" (a 창고, 구역 or 위치, e.g. "this 창고 only").
 */
export type StockPlaceSelectable = "location" | "any"

type Row = {
  level: StockPlaceLevel
  id: string
  depth: 0 | 1 | 2
  code: string
  name: string | null
  storageType: StorageType | null
  stockRowCount: number
  isActive: boolean
  /** It or a level above it is 사용중지. */
  greyed: boolean
  isDefault: boolean
  hasChildren: boolean
  /** Text searched by the search box (lower case). */
  searchText: string
  /** Ids of the levels above it (to show them with a matching child). */
  parentIds: string[]
}

function buildRows(
  tree: readonly StockWarehouseNode[],
  purpose: StockPlacePurpose
): Row[] {
  const rows: Row[] = []
  for (const warehouse of tree) {
    if (purpose === "receive" && !warehouse.isActive) continue
    const warehouseRows: Row[] = []
    for (const zone of warehouse.zones) {
      if (purpose === "receive" && !zone.isActive) continue
      const locations = zone.locations.filter(
        (location) => purpose === "filter" || location.canReceive
      )
      if (purpose === "receive" && locations.length === 0) continue
      warehouseRows.push({
        level: "zone",
        id: zone.id,
        depth: 1,
        code: zone.code,
        name: zone.name,
        storageType: zone.storageType,
        stockRowCount: zone.stockRowCount,
        isActive: zone.isActive,
        greyed: !warehouse.isActive || !zone.isActive,
        isDefault: false,
        hasChildren: locations.length > 0,
        searchText: `${zone.code} ${zone.name}`.toLowerCase(),
        parentIds: [warehouse.id],
      })
      for (const location of locations) {
        warehouseRows.push({
          level: "location",
          id: location.id,
          depth: 2,
          code: location.code,
          name: location.name,
          storageType: zone.storageType,
          stockRowCount: location.stockRowCount,
          isActive: location.isActive,
          greyed: !warehouse.isActive || !zone.isActive || !location.isActive,
          isDefault: location.isDefault,
          hasChildren: false,
          searchText: `${location.code} ${location.name ?? ""}`.toLowerCase(),
          parentIds: [warehouse.id, zone.id],
        })
      }
    }
    if (purpose === "receive" && warehouseRows.length === 0) continue
    rows.push({
      level: "warehouse",
      id: warehouse.id,
      depth: 0,
      code: warehouse.code,
      name: warehouse.name,
      storageType: null,
      stockRowCount: warehouse.stockRowCount,
      isActive: warehouse.isActive,
      greyed: !warehouse.isActive,
      isDefault: false,
      hasChildren: warehouseRows.length > 0,
      searchText: `${warehouse.code} ${warehouse.name}`.toLowerCase(),
      parentIds: [],
    })
    rows.push(...warehouseRows)
  }
  return rows
}

/** Rows matching `search`, with their parents and (for 창고/구역) children. */
function filterRows(rows: Row[], search: string): Row[] {
  const text = search.trim().toLowerCase()
  if (!text) return rows
  const matched = new Set(
    rows.filter((row) => row.searchText.includes(text)).map((row) => row.id)
  )
  const shown = new Set<string>()
  for (const row of rows) {
    if (matched.has(row.id)) {
      shown.add(row.id)
      row.parentIds.forEach((id) => shown.add(id))
    } else if (row.parentIds.some((id) => matched.has(id))) {
      shown.add(row.id)
    }
  }
  return rows.filter((row) => shown.has(row.id))
}

/**
 * 위치 선택 dialog: the 창고 > 구역 > 위치 tree with a search box (코드,
 * 이름). Click a row to choose it, then [확인] — or double-click / Enter.
 * 구역 rows show their 보관온도; with `productStorageType` a warning icon
 * marks 구역 of another 보관온도 (red when too warm).
 *
 * Mount it only while it is open (`{open && <StockPlacePickerDialog … />}`).
 * Usually used through <StockPlaceField>.
 */
export function StockPlacePickerDialog({
  title = "위치 선택",
  tree,
  loadFailed = false,
  onReload,
  reloading = false,
  value,
  selectable,
  purpose,
  productStorageType = null,
  clearLabel,
  onSelect,
  onClose,
}: {
  title?: string
  /** The tree; null while it is loading. */
  tree: StockWarehouseNode[] | null
  /** The tree could not be read (shows [다시 시도]). */
  loadFailed?: boolean
  /** Reads the tree again ([새로 고침]; e.g. after adding 위치 in another tab). */
  onReload?: () => void
  reloading?: boolean
  /** The id chosen now (any level), shown selected. */
  value: string | null
  selectable: StockPlaceSelectable
  purpose: StockPlacePurpose
  /** The product's 보관온도: 구역 of another one get a warning icon. */
  productStorageType?: StorageType | null
  /** Shows a button that chooses "nothing" (e.g. "전체 창고"). */
  clearLabel?: string
  /** The chosen place (null = the clear button). Closes the dialog after. */
  onSelect: (place: FoundStockPlace | null) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(value)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const searchRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)

  const allRows = useMemo(
    () => (tree ? buildRows(tree, purpose) : []),
    [tree, purpose]
  )
  const searching = search.trim() !== ""
  const rows = filterRows(allRows, search).filter(
    // Folding is ignored while searching (matches must show).
    (row) => searching || !row.parentIds.some((id) => collapsed.has(id))
  )

  function canChoose(row: Row): boolean {
    if (selectable === "location" && row.level !== "location") return false
    if (purpose === "receive" && row.greyed) return false
    return true
  }

  function confirm(id: string | null = selectedId) {
    if (!tree || !id) return
    const found = findStockPlace(tree, id)
    const row = allRows.find((item) => item.id === id)
    if (!found || !row || !canChoose(row)) return
    onSelect(found)
    onClose()
  }

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function focusRow(element: Element | null | undefined) {
    if (element instanceof HTMLElement) element.focus()
  }

  function handleRowKeyDown(
    event: React.KeyboardEvent<HTMLTableRowElement>,
    row: Row
  ) {
    if (event.target !== event.currentTarget) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      focusRow(event.currentTarget.nextElementSibling)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      const previous = event.currentTarget.previousElementSibling
      if (previous) focusRow(previous)
      else searchRef.current?.focus()
    } else if (event.key === "ArrowLeft" && row.hasChildren) {
      event.preventDefault()
      if (!collapsed.has(row.id)) toggle(row.id)
    } else if (event.key === "ArrowRight" && row.hasChildren) {
      event.preventDefault()
      if (collapsed.has(row.id)) toggle(row.id)
    } else if (event.key === " ") {
      event.preventDefault()
      if (canChoose(row)) setSelectedId(row.id)
    } else if (event.key === "Enter") {
      event.preventDefault()
      if (canChoose(row)) confirm(row.id)
    }
  }

  const selectedRow = allRows.find((row) => row.id === selectedId)
  const canConfirm = !!selectedRow && canChoose(selectedRow)
  const focusId =
    selectedId && rows.some((row) => row.id === selectedId)
      ? selectedId
      : (rows[0]?.id ?? null)

  const description =
    purpose === "receive"
      ? "새 재고를 넣을 위치를 고릅니다. 사용 중인 창고·구역·위치만 보입니다. 줄을 누른 뒤 [확인]을 누르거나, 두 번 누르면(또는 Enter) 바로 고릅니다."
      : selectable === "any"
        ? "창고, 구역 또는 위치를 고릅니다(고른 곳 아래가 모두 포함됩니다). 사용중지된 곳은 회색입니다."
        : "위치를 고릅니다. 사용중지된 곳은 회색입니다."

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={title}
      size="lg"
      initialFocus={searchRef}
      description={description}
      footer={
        <>
          <ActionButton variant="secondary" size="lg" onClick={onClose}>
            취소
          </ActionButton>
          {clearLabel && (
            <ActionButton
              variant="neutral"
              size="lg"
              onClick={() => {
                onSelect(null)
                onClose()
              }}
            >
              {clearLabel}
            </ActionButton>
          )}
          <ActionButton
            size="lg"
            disabled={!canConfirm}
            onClick={() => confirm()}
          >
            확인
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              ref={searchRef}
              type="search"
              aria-label="위치 검색"
              placeholder="창고·구역·위치 코드나 이름으로 찾기"
              className="h-8 rounded-sm pl-8"
              value={search}
              autoComplete="off"
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  if (event.nativeEvent.isComposing || event.keyCode === 229) {
                    return
                  }
                  // Enter in the box chooses the only choosable match.
                  const choosable = rows.filter(canChoose)
                  if (choosable.length === 1) confirm(choosable[0].id)
                } else if (event.key === "ArrowDown") {
                  event.preventDefault()
                  focusRow(
                    tableRef.current?.querySelector("tbody tr[tabindex]")
                  )
                }
              }}
            />
          </div>
          {onReload && (
            <ActionButton
              variant="neutral"
              size="sm"
              disabled={reloading}
              onClick={onReload}
              title="다른 창에서 추가한 위치를 다시 불러옵니다"
            >
              {reloading ? (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              ) : (
                <RefreshCwIcon aria-hidden="true" />
              )}
              새로 고침
            </ActionButton>
          )}
          <a
            href="/inventory/settings"
            target="_blank"
            rel="noopener"
            className="text-xs text-brand underline-offset-2 hover:underline"
          >
            창고·로케이션 설정 (새 탭)
          </a>
        </div>

        <DataGrid
          ref={tableRef}
          aria-label="창고·구역·위치 목록"
          aria-busy={tree === null}
          containerClassName="max-h-[min(26rem,50dvh)]"
        >
          <DataGridHeader>
            <tr>
              <DataGridHead className="min-w-56">위치</DataGridHead>
              <DataGridHead className="w-20">보관온도</DataGridHead>
              <DataGridHead className="w-20">재고</DataGridHead>
              <DataGridHead className="w-24">상태</DataGridHead>
            </tr>
          </DataGridHeader>
          <DataGridBody>
            {tree === null ? (
              <DataGridEmpty colSpan={COLUMN_COUNT}>
                {loadFailed ? (
                  <div
                    role="alert"
                    className="flex flex-col items-center gap-2"
                  >
                    <p>창고·위치를 불러오지 못했습니다.</p>
                    {onReload && (
                      <ActionButton variant="neutral" onClick={onReload}>
                        다시 시도
                      </ActionButton>
                    )}
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    <LoaderCircleIcon
                      aria-hidden="true"
                      className="size-4 animate-spin"
                    />
                    창고·위치를 불러오는 중…
                  </span>
                )}
              </DataGridEmpty>
            ) : rows.length === 0 ? (
              <DataGridEmpty colSpan={COLUMN_COUNT}>
                {searching
                  ? `‘${search.trim()}’이(가) 들어간 위치가 없습니다.`
                  : purpose === "receive"
                    ? "재고를 넣을 수 있는 위치가 없습니다. 창고·로케이션 설정에서 창고와 구역을 먼저 만들어 주세요."
                    : "등록된 창고가 없습니다. 창고·로케이션 설정에서 먼저 만들어 주세요."}
              </DataGridEmpty>
            ) : (
              rows.map((row) => {
                const choosable = canChoose(row)
                const selected = row.id === selectedId
                const expanded = !collapsed.has(row.id) || searching
                return (
                  <DataGridRow
                    key={row.id}
                    selected={selected}
                    tabIndex={row.id === focusId ? 0 : -1}
                    aria-disabled={!choosable || undefined}
                    aria-selected={selected}
                    onClick={() => {
                      if (choosable) setSelectedId(row.id)
                    }}
                    onDoubleClick={(event) => {
                      if ((event.target as HTMLElement).closest("button"))
                        return
                      if (choosable) confirm(row.id)
                    }}
                    onKeyDown={(event) => handleRowKeyDown(event, row)}
                    className={cn(
                      "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                      choosable ? "cursor-pointer" : "cursor-default",
                      row.greyed && "text-muted-foreground"
                    )}
                  >
                    <DataGridCell>
                      <div
                        className={cn(
                          "flex items-center gap-1.5",
                          row.depth === 1 && "pl-5",
                          row.depth === 2 && "pl-10"
                        )}
                      >
                        {row.hasChildren ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            aria-label={`${row.name ?? row.code} ${expanded ? "접기" : "펼치기"}`}
                            disabled={searching}
                            onClick={(event) => {
                              event.stopPropagation()
                              toggle(row.id)
                            }}
                            className="flex size-[18px] shrink-0 items-center justify-center rounded-[2px] border border-input bg-background text-foreground hover:bg-muted disabled:opacity-40 [&_svg]:size-3"
                          >
                            {expanded ? (
                              <MinusIcon aria-hidden="true" />
                            ) : (
                              <PlusIcon aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          <span aria-hidden="true" className="size-[18px]" />
                        )}
                        <span
                          className={cn(
                            "tabular-nums",
                            row.level !== "location" && "font-bold"
                          )}
                        >
                          {row.code}
                        </span>
                        {row.name && (
                          <span className="truncate">
                            {row.level === "location"
                              ? `(${row.name})`
                              : row.name}
                          </span>
                        )}
                        {row.isDefault && (
                          <span className="rounded-sm border border-input px-1 text-[11px]">
                            기본
                          </span>
                        )}
                      </div>
                    </DataGridCell>
                    <DataGridCell align="center">
                      {row.level === "zone" && row.storageType ? (
                        <span className="inline-flex items-center gap-1">
                          {storageTypeLabel(row.storageType)}
                          <StorageFitIcon
                            productStorage={productStorageType}
                            zoneStorage={row.storageType}
                          />
                        </span>
                      ) : row.level === "location" && row.storageType ? (
                        <span className="text-xs text-muted-foreground">
                          {storageTypeLabel(row.storageType)}
                        </span>
                      ) : null}
                    </DataGridCell>
                    <DataGridCell numeric>
                      {row.stockRowCount > 0
                        ? `${formatNumber(row.stockRowCount, 0)}줄`
                        : "-"}
                    </DataGridCell>
                    <DataGridCell align="center" className="text-xs">
                      {!row.isActive
                        ? "사용중지"
                        : row.greyed
                          ? "상위 중지"
                          : "사용"}
                    </DataGridCell>
                  </DataGridRow>
                )
              })
            )}
          </DataGridBody>
        </DataGrid>
        <p className="text-xs text-muted-foreground">
          ‘재고’는 지금 재고가 있는 로트×위치 줄 수입니다.
          {productStorageType &&
            " ⚠ 표시는 상품의 보관온도와 다른 구역입니다(빨간색: 온도가 너무 높음)."}
        </p>
      </div>
    </ErpDialog>
  )
}
