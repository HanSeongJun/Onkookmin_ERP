"use client"

import { LoaderCircleIcon } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { ActionButton } from "@/components/erp/action-bar"
import { FormRow, FormSection, FormTable } from "@/components/erp/form-table"
import { Input } from "@/components/ui/input"
import { updateInventorySettings } from "@/lib/inventory/actions"
import { EXPIRY_WARNING_DAYS_MAX } from "@/lib/inventory/constants"
import type { InventorySettings } from "@/lib/inventory/queries"
import { formatDateTime } from "@/lib/format"

import { callPlaceAction } from "./call-place-action"

/**
 * 재고 설정: 기한 임박 기준일 (0–365일). A lot with at most this many days
 * left is "기한 임박" on every 재고 screen and the dashboard.
 */
export function ExpirySettingsForm({
  settings,
}: {
  settings: InventorySettings
}) {
  const [value, setValue] = useState(String(settings.expiryWarningDays))
  // A new value from the server (after saving) resets the box.
  const [shown, setShown] = useState(settings)
  if (shown !== settings) {
    setShown(settings)
    setValue(String(settings.expiryWarningDays))
  }
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const changed = value.trim() !== String(settings.expiryWarningDays)

  function save() {
    if (isPending) return
    startTransition(async () => {
      const result = await callPlaceAction(() =>
        updateInventorySettings({ expiryWarningDays: value })
      )
      if (!result) return
      if (!result.ok) {
        setError(result.fieldErrors.expiryWarningDays ?? result.message)
        toast.error(result.message)
        return
      }
      setError(null)
      toast.success(`기한 임박 기준일을 ${value.trim()}일로 저장했습니다.`)
    })
  }

  return (
    <FormSection
      title="재고 설정"
      description={`마지막 저장: ${formatDateTime(settings.updatedAt)}`}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
        className="max-w-2xl"
      >
        <FormTable>
          <FormRow
            label="기한 임박 기준일"
            htmlFor="expiry-warning-days"
            error={error ?? undefined}
            errorId="expiry-warning-days-error"
          >
            <span className="flex items-center gap-1.5">
              <Input
                id="expiry-warning-days"
                inputMode="numeric"
                value={value}
                maxLength={3}
                aria-invalid={!!error}
                aria-describedby={
                  error
                    ? "expiry-warning-days-error"
                    : "expiry-warning-days-hint"
                }
                onChange={(event) => {
                  setValue(event.target.value)
                  setError(null)
                }}
                className="h-8 w-20 rounded-sm text-right tabular-nums"
              />
              <span className="text-[13px]">일 이하 남으면 ‘기한 임박’</span>
            </span>
            <ActionButton
              type="submit"
              size="sm"
              disabled={isPending || !changed}
            >
              {isPending && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              저장
            </ActionButton>
            <p
              id="expiry-warning-days-hint"
              className="w-full text-xs text-muted-foreground"
            >
              0~{EXPIRY_WARNING_DAYS_MAX}일. 예: 7이면 기한이 오늘부터 7일 안에
              끝나는 로트가 ‘기한 임박’(노란색), 기한일이 지난 로트는 ‘기한
              경과’(빨간색)입니다. 재고현황, 대시보드, 폐기 등록에 함께
              쓰입니다.
            </p>
          </FormRow>
        </FormTable>
      </form>
    </FormSection>
  )
}
