"use client"

import { ChevronDownIcon, XIcon } from "lucide-react"
import { useState } from "react"

import type { StockWarehouseNode } from "@/lib/inventory/queries"
import type { StorageType } from "@/lib/products/constants"
import { cn } from "@/lib/utils"

import {
  findStockPlace,
  stockPlacePath,
  type FoundStockPlace,
} from "./place-tree"
import {
  StockPlacePickerDialog,
  type StockPlacePurpose,
  type StockPlaceSelectable,
} from "./stock-place-picker-dialog"
import { StorageFitIcon } from "./storage-fit"

/**
 * A box showing the chosen 창고 / 구역 / 위치 ("본사 물류센터 > 냉장
 * B구역 > B-02-R02", or the placeholder) that opens the 위치 선택 dialog,
 * with × to clear it when `clearable`. The tree comes from useStockPlaces()
 * of the screen (the picker's [새로 고침] calls `onReloadTree`).
 *
 * @example
 * const places = useStockPlaces()
 * <StockPlaceField
 *   id="receipt-line-0-location" aria-label="1번째 줄 위치"
 *   value={line.locationId} onChange={(place) => setLocation(place?.id ?? "")}
 *   tree={places.tree} treeStatus={places.status} onReloadTree={places.reload} reloading={places.reloading}
 *   selectable="location" purpose="receive" productStorageType={product.storageType}
 * />
 */
export function StockPlaceField({
  id,
  value,
  onChange,
  tree,
  treeStatus = "ready",
  onReloadTree,
  reloading = false,
  selectable,
  purpose,
  productStorageType = null,
  placeholder,
  clearable = false,
  clearLabel,
  pickerTitle,
  invalid = false,
  disabled = false,
  size = "md",
  className,
  "aria-label": ariaLabel,
  "aria-describedby": describedBy,
}: {
  id?: string
  /** The chosen id (any level), or null / "". */
  value: string | null
  onChange: (place: FoundStockPlace | null) => void
  tree: StockWarehouseNode[] | null
  treeStatus?: "loading" | "ready" | "error"
  onReloadTree?: () => void
  reloading?: boolean
  selectable: StockPlaceSelectable
  purpose: StockPlacePurpose
  /** The product's 보관온도: the box and the picker warn about other 구역. */
  productStorageType?: StorageType | null
  /** Default "위치 선택" ("location") / "전체" ("any"). */
  placeholder?: string
  /** × clears the choice. */
  clearable?: boolean
  /** Button in the picker that clears the choice, e.g. "전체 창고". */
  clearLabel?: string
  pickerTitle?: string
  invalid?: boolean
  disabled?: boolean
  /** "sm" for cells of a line table (h-7), "md" for forms (h-8). */
  size?: "sm" | "md"
  className?: string
  "aria-label"?: string
  "aria-describedby"?: string
}) {
  const [open, setOpen] = useState(false)
  const found = tree ? findStockPlace(tree, value) : null
  const label = found
    ? stockPlacePath(found)
    : value
      ? tree
        ? "알 수 없는 위치 (다시 선택해 주세요)"
        : "불러오는 중…"
      : (placeholder ?? (selectable === "any" ? "전체" : "위치 선택"))
  const empty = !value

  return (
    <>
      <span className={cn("flex min-w-0 items-center", className)}>
        <button
          id={id}
          type="button"
          aria-haspopup="dialog"
          aria-label={ariaLabel ? `${ariaLabel}: ${label} (바꾸기)` : undefined}
          data-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          onClick={() => {
            setOpen(true)
            onReloadTree?.()
          }}
          className={cn(
            "flex w-full min-w-0 items-center justify-between gap-1 rounded-sm border border-input bg-background pr-1.5 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[invalid=true]:border-destructive data-[invalid=true]:ring-2 data-[invalid=true]:ring-destructive/20",
            size === "sm" ? "h-7 text-[13px]" : "h-8 text-sm"
          )}
        >
          <span
            className={cn("truncate", empty && "text-muted-foreground")}
            title={found ? label : undefined}
          >
            {label}
          </span>
          <span className="flex shrink-0 items-center gap-0.5">
            {found?.zone && (
              <StorageFitIcon
                productStorage={productStorageType}
                zoneStorage={found.zone.storageType}
              />
            )}
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
          </span>
        </button>
        {clearable && !empty && !disabled && (
          <button
            type="button"
            aria-label={`${ariaLabel ?? "위치"} 지우기`}
            onClick={() => onChange(null)}
            className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        )}
      </span>
      {open && (
        <StockPlacePickerDialog
          title={pickerTitle}
          tree={tree}
          loadFailed={treeStatus === "error"}
          onReload={onReloadTree}
          reloading={reloading}
          value={value || null}
          selectable={selectable}
          purpose={purpose}
          productStorageType={productStorageType}
          clearLabel={clearLabel}
          onSelect={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
