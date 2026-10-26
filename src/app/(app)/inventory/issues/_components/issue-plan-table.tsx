"use client"

import { Fragment } from "react"

import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { ExpiryText } from "@/components/inventory/expiry-badge"
import { ProductTypeBadge } from "@/components/inventory/stock-product-picker-dialog"
import { StorageFitIcon } from "@/components/inventory/storage-fit"
import type { IssueDemand, IssuePlan } from "@/lib/inventory/actions"
import {
  afterDateText,
  formatPlacePath,
  formatStockQuantity,
} from "@/lib/inventory/constants"
import { todayInKorea } from "@/lib/inventory/schema"

/**
 * "재고 부족: 필요 10개 · 출고 가능 7개 (같은 전표의 다른 줄에 먼저 배정한
 * 2개, 기한이 지난 재고 3개, 내일 이후 전표가 쓰는 재고 2개, 내일 이후
 * 들어오는 재고 5개 제외)" — same wording as issue_stock's error
 * (stock_shortage_notes). `planDate` is the 출고일 of the plan.
 */
export function shortageText(demand: IssueDemand, planDate: string): string {
  const after = afterDateText(planDate, todayInKorea())
  const notes = [
    demand.takenByOtherLines > 0
      ? `같은 전표의 다른 줄에 먼저 배정한 ${formatStockQuantity(demand.takenByOtherLines, demand.unit)}`
      : null,
    demand.expiredExcluded > 0
      ? `기한이 지난 재고 ${formatStockQuantity(demand.expiredExcluded, demand.unit)}`
      : null,
    demand.reservedLater > 0
      ? `${after} 전표가 쓰는 재고 ${formatStockQuantity(demand.reservedLater, demand.unit)}`
      : null,
    demand.arrivingLater > 0
      ? `${after} 들어오는 재고 ${formatStockQuantity(demand.arrivingLater, demand.unit)}`
      : null,
  ].filter((note): note is string => note !== null)
  const excluded = notes.length > 0 ? ` (${notes.join(", ")} 제외)` : ""
  return `재고 부족: 필요 ${formatStockQuantity(demand.quantity, demand.unit)} · 출고 가능 ${formatStockQuantity(demand.available, demand.unit)}${excluded}`
}

/**
 * The FEFO plan of a 출고 전표 (배정 미리보기): per line and 기준상품 (a
 * 묶음상품 line has one per 구성상품) the lots and 위치 it takes, earliest
 * 기한 first, with the D-day (from today), and a red row where stock is
 * short. The plan is made for its 출고일 (plan.docDate): lots past their
 * 기한 that day, stock received later and stock that later 전표 use are
 * left out.
 */
export function IssuePlanTable({
  plan,
  expiryWarningDays,
}: {
  plan: IssuePlan
  expiryWarningDays: number
}) {
  return (
    <DataGrid
      aria-label="출고 배정 미리보기"
      containerClassName="max-h-[min(28rem,50dvh)]"
      className="min-w-[60rem]"
    >
      <DataGridHeader>
        <tr>
          <DataGridHead className="w-10">줄</DataGridHead>
          <DataGridHead className="min-w-52">상품</DataGridHead>
          <DataGridHead className="w-28">필요 수량</DataGridHead>
          <DataGridHead className="w-36">로트번호</DataGridHead>
          <DataGridHead className="w-56">기한</DataGridHead>
          <DataGridHead className="min-w-48">위치</DataGridHead>
          <DataGridHead className="w-28">배정 수량</DataGridHead>
        </tr>
      </DataGridHeader>
      <DataGridBody>
        {plan.lines.map((line) =>
          line.demands.map((demand, demandIndex) => (
            <Fragment key={`${line.line}-${demand.productId}`}>
              {demand.allocations.map((allocation, allocationIndex) => {
                const first = allocationIndex === 0
                return (
                  <DataGridRow
                    key={`${allocation.lotId}-${allocation.locationId}`}
                  >
                    <DataGridCell numeric>
                      {first && demandIndex === 0 ? line.line : ""}
                    </DataGridCell>
                    <DataGridCell className="max-w-72">
                      {first && (
                        <DemandName
                          lineName={line.productName}
                          lineType={line.productType}
                          demand={demand}
                        />
                      )}
                    </DataGridCell>
                    <DataGridCell numeric>
                      {first
                        ? formatStockQuantity(demand.quantity, demand.unit)
                        : ""}
                    </DataGridCell>
                    <DataGridCell className="tabular-nums">
                      {allocation.lotNo}
                    </DataGridCell>
                    <DataGridCell>
                      <ExpiryText
                        kind={allocation.expiryKind}
                        date={allocation.expiryDate}
                        daysLeft={allocation.daysLeft}
                        warningDays={expiryWarningDays}
                      />
                    </DataGridCell>
                    <DataGridCell className="max-w-72">
                      <span className="flex items-center gap-1">
                        <span className="truncate">
                          {formatPlacePath(
                            allocation.warehouseName,
                            allocation.zoneName,
                            allocation.locationCode
                          )}
                        </span>
                        <StorageFitIcon
                          productStorage={demand.storageType}
                          zoneStorage={allocation.zoneStorageType}
                        />
                      </span>
                    </DataGridCell>
                    <DataGridCell numeric className="font-bold">
                      {formatStockQuantity(allocation.quantity, demand.unit)}
                    </DataGridCell>
                  </DataGridRow>
                )
              })}
              {demand.shortage > 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="border-b border-grid-line bg-destructive/5 px-2 py-1 text-xs font-bold text-destructive"
                  >
                    <span className="sticky left-2">
                      {line.line}번째 줄 {demand.code} {demand.name} —{" "}
                      {shortageText(demand, plan.docDate)}
                    </span>
                  </td>
                </tr>
              )}
            </Fragment>
          ))
        )}
      </DataGridBody>
    </DataGrid>
  )
}

function DemandName({
  lineName,
  lineType,
  demand,
}: {
  lineName: string
  lineType: "base" | "bundle"
  demand: IssueDemand
}) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-center gap-1">
        <span className="shrink-0 font-bold tabular-nums">{demand.code}</span>
        <span className="truncate" title={demand.name}>
          {demand.name}
        </span>
      </span>
      {lineType === "bundle" && (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <ProductTypeBadge type="bundle" />
          <span className="truncate">{lineName}의 구성상품</span>
        </span>
      )}
    </span>
  )
}
