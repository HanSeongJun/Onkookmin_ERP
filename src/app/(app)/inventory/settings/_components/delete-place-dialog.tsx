"use client"

import { LoaderCircleIcon } from "lucide-react"
import { useTransition } from "react"
import { toast } from "sonner"

import { ActionButton } from "@/components/erp/action-bar"
import { ErpDialog } from "@/components/erp/erp-dialog"
import {
  deleteLocation,
  deleteWarehouse,
  deleteZone,
  type StockPlaceDeleteResult,
} from "@/lib/inventory/actions"
import { formatNumber } from "@/lib/format"

import { callPlaceAction } from "./call-place-action"

/** What the 삭제 dialog is about. */
export type PlaceDeleteTarget = {
  kind: "warehouse" | "zone" | "location"
  id: string
  /** e.g. "본사 물류센터 > 냉장 B구역". */
  path: string
  /** Stock was stored there at some time: it cannot be deleted. */
  isUsed: boolean
  /** The 구역's 기본 위치 (never deleted). */
  isDefault: boolean
  isActive: boolean
  /** 구역 and 위치 deleted with it (창고: zones + locations; 구역: locations). */
  zoneCount: number
  locationCount: number
}

const KIND_LABELS = {
  warehouse: "창고",
  zone: "구역",
  location: "위치",
} as const

/**
 * 창고 / 구역 / 위치 삭제 dialog. Only a place where nothing was ever stored
 * can be deleted (with the 구역·위치 below it); otherwise it explains why
 * and offers [사용중지로 바꾸기]. A 구역's 기본 위치 cannot be deleted.
 */
export function DeletePlaceDialog({
  target,
  onClose,
  onDeactivate,
}: {
  target: PlaceDeleteTarget
  onClose: () => void
  /** Switches the place off instead (사용중지). */
  onDeactivate: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const label = KIND_LABELS[target.kind]
  const blocked = target.isUsed || target.isDefault

  function remove() {
    if (blocked || isPending) return
    startTransition(async () => {
      const result = await callPlaceAction<StockPlaceDeleteResult>(() =>
        target.kind === "warehouse"
          ? deleteWarehouse(target.id)
          : target.kind === "zone"
            ? deleteZone(target.id)
            : deleteLocation(target.id)
      )
      if (!result) return
      if (!result.ok) {
        toast.error(result.message)
        return
      }
      toast.success(`${label} ‘${target.path}’을(를) 삭제했습니다.`)
      onClose()
    })
  }

  const below =
    target.kind === "warehouse"
      ? `구역 ${formatNumber(target.zoneCount, 0)}개와 위치 ${formatNumber(target.locationCount, 0)}개`
      : target.kind === "zone"
        ? `위치 ${formatNumber(target.locationCount, 0)}개(기본 위치 포함)`
        : null

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onClose()
      }}
      title={`${label} 삭제`}
      size="md"
      footer={
        <>
          <ActionButton
            variant="secondary"
            size="lg"
            disabled={isPending}
            onClick={onClose}
          >
            닫기
          </ActionButton>
          {blocked ? (
            !target.isDefault &&
            target.isActive && (
              <ActionButton
                size="lg"
                onClick={() => {
                  onDeactivate()
                  onClose()
                }}
              >
                사용중지로 바꾸기
              </ActionButton>
            )
          ) : (
            <ActionButton
              size="lg"
              className="bg-destructive hover:bg-destructive/90 active:bg-destructive/90"
              disabled={isPending}
              onClick={remove}
            >
              {isPending && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              삭제
            </ActionButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-2 py-1 text-sm">
        <p className="font-bold">{target.path}</p>
        {target.isDefault ? (
          <p>
            구역마다 하나씩 있는{" "}
            <strong className="font-bold">기본 위치</strong>는 삭제할 수
            없습니다. (기초재고 일괄등록에서 선반코드를 비운 줄이 여기로
            들어갑니다.) 쓰지 않으려면 구역을 사용중지해 주세요.
          </p>
        ) : target.isUsed ? (
          <p>
            재고를 넣은 적이 있는 {label}는 삭제할 수 없습니다. 재고
            기록(전표)이 이 {label}를 가리키고 있기 때문입니다.{" "}
            {target.isActive
              ? "쓰지 않으려면 사용중지로 바꿔 주세요. 사용중지하면 새 재고를 넣을 수 없고, 남은 재고는 그대로 꺼낼 수 있습니다."
              : "이미 사용중지 상태입니다."}
          </p>
        ) : (
          <>
            <p>
              이 {label}를 삭제할까요?
              {below && ` 아래의 ${below}도 함께 삭제됩니다.`}
            </p>
            <p className="text-[13px] text-muted-foreground">
              재고를 넣은 적이 없어 삭제할 수 있습니다. 삭제하면 되돌릴 수
              없습니다.
            </p>
          </>
        )}
      </div>
    </ErpDialog>
  )
}
