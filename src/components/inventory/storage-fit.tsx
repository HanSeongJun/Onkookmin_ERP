import { TriangleAlertIcon } from "lucide-react"

import { storageFit } from "@/lib/inventory/constants"
import { storageTypeLabel, type StorageType } from "@/lib/products/constants"
import { cn } from "@/lib/utils"

/**
 * The sentence for a 보관온도 mismatch, e.g. "냉장 상품을 상온 구역에
 * 둡니다 (온도가 너무 높습니다)". `tooWarm` (the 구역 is warmer than the
 * product needs) is the dangerous case.
 */
export function storageMismatchText(
  productStorage: StorageType,
  zoneStorage: StorageType,
  verb: "둡니다" | "있습니다" = "있습니다"
): string {
  const { tooWarm } = storageFit(productStorage, zoneStorage)
  const particle = verb === "둡니다" ? "을" : "이"
  const warmNote = tooWarm ? " (온도가 너무 높습니다)" : ""
  return `${storageTypeLabel(productStorage)} 상품${particle} ${storageTypeLabel(zoneStorage)} 구역에 ${verb}${warmNote}`
}

/**
 * Warning icon for a lot whose product needs another 보관온도 than its
 * 구역: red when the 구역 is too warm (e.g. 냉장 product in a 상온 구역),
 * amber otherwise (e.g. 상온 product in a 냉장 구역). Nothing when they
 * match. The sentence is the tooltip and the screen-reader text.
 *
 * @example <StorageFitIcon productStorage={row.productStorageType} zoneStorage={row.zoneStorageType} />
 */
export function StorageFitIcon({
  productStorage,
  zoneStorage,
  className,
}: {
  productStorage: StorageType | null | undefined
  zoneStorage: StorageType | null | undefined
  className?: string
}) {
  if (!productStorage || !zoneStorage) return null
  const { mismatch, tooWarm } = storageFit(productStorage, zoneStorage)
  if (!mismatch) return null
  const text = storageMismatchText(productStorage, zoneStorage)
  return (
    <span
      title={text}
      className={cn(
        "inline-flex shrink-0 items-center align-middle",
        className
      )}
    >
      <TriangleAlertIcon
        aria-hidden="true"
        className={cn("size-4", tooWarm ? "text-destructive" : "text-chart-4")}
      />
      <span className="sr-only">보관온도 불일치: {text}</span>
    </span>
  )
}

/**
 * A one-line 보관온도 warning (red when too warm), e.g. under a 입고 line:
 * "보관온도 확인: 냉장 상품을 상온 구역에 둡니다 (온도가 너무 높습니다)".
 */
export function StorageFitNote({
  productStorage,
  zoneStorage,
  prefix,
  className,
}: {
  productStorage: StorageType
  zoneStorage: StorageType
  /** Text before the sentence, e.g. the product name. */
  prefix?: string
  className?: string
}) {
  const { mismatch, tooWarm } = storageFit(productStorage, zoneStorage)
  if (!mismatch) return null
  return (
    <p
      className={cn(
        "flex items-start gap-1 text-xs font-bold",
        tooWarm ? "text-destructive" : "text-foreground",
        className
      )}
    >
      <TriangleAlertIcon
        aria-hidden="true"
        className={cn(
          "mt-px size-3.5 shrink-0",
          tooWarm ? "text-destructive" : "text-chart-4"
        )}
      />
      <span>
        보관온도 확인: {prefix ? `${prefix} — ` : ""}
        {storageMismatchText(productStorage, zoneStorage, "둡니다")}
      </span>
    </p>
  )
}
