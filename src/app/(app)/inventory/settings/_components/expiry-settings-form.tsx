"use client"

import { LoaderCircleIcon } from "lucide-react"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { ActionButton } from "@/components/erp/action-bar"
import { FormRow, FormSection, FormTable } from "@/components/erp/form-table"
import { Input } from "@/components/ui/input"
import { updateInventorySettings } from "@/lib/inventory/actions"
import {
  EXPIRY_WARNING_DAYS_MAX,
  FUTURE_DOC_DAYS_MAX,
  maxDocDate,
} from "@/lib/inventory/constants"
import type { InventorySettings } from "@/lib/inventory/queries"
import { todayInKorea } from "@/lib/inventory/schema"
import { formatDateTime } from "@/lib/format"

import { callPlaceAction } from "./call-place-action"

/**
 * 재고 설정 (each row saves on its own):
 * - 기한 임박 기준일 (0–365일): a lot with at most this many days left is
 *   "기한 임박" on every 재고 screen and the dashboard;
 * - 전표 일자 허용 범위 (0–30일): every 재고 전표 may be dated up to today
 *   + this many days (예정 전표; 새벽배송: tomorrow's 출고 is entered
 *   today). 0 = today at most. The database checks the same setting.
 */
export function ExpirySettingsForm({
  settings,
}: {
  settings: InventorySettings
}) {
  const today = todayInKorea()
  return (
    <FormSection
      title="재고 설정"
      description={`마지막 저장: ${formatDateTime(settings.updatedAt)}`}
    >
      <FormTable className="max-w-3xl">
        <SettingRow
          id="expiry-warning-days"
          label="기한 임박 기준일"
          saved={settings.expiryWarningDays}
          unitText="일 이하 남으면 ‘기한 임박’"
          field="expiryWarningDays"
          savedMessage={(days) =>
            `기한 임박 기준일을 ${days}일로 저장했습니다.`
          }
          hint={`0~${EXPIRY_WARNING_DAYS_MAX}일. 예: 7이면 기한이 오늘부터 7일 안에 끝나는 로트가 ‘기한 임박’(노란색), 기한일이 지난 로트는 ‘기한 경과’(빨간색)입니다. 재고현황, 대시보드, 폐기 등록에 함께 쓰입니다.`}
        />
        <SettingRow
          id="future-doc-days"
          label="전표 일자 허용 범위"
          saved={settings.futureDocDays}
          unitText={
            settings.futureDocDays > 0
              ? `오늘 이후 이 일수까지 (지금: ${maxDocDate(settings.futureDocDays, today)}까지)`
              : "오늘 이후 이 일수까지 (지금: 오늘까지만)"
          }
          field="futureDocDays"
          savedMessage={(days) =>
            Number(days) > 0
              ? `전표 일자를 오늘 이후 ${days}일까지 정할 수 있게 저장했습니다.`
              : "전표 일자를 오늘까지만 정할 수 있게 저장했습니다."
          }
          hint={`0~${FUTURE_DOC_DAYS_MAX}일 (기본 7). 새벽배송처럼 내일 날짜의 출고를 오늘 미리 입력할 때 씁니다. 입고·출고·폐기·이동·실사·취소·기초재고 전표 모두 이 범위 안의 날짜로 등록할 수 있고, 오늘 이후 날짜의 전표에는 ‘예정’이 붙습니다. 0이면 오늘까지만 됩니다.`}
        />
      </FormTable>
    </FormSection>
  )
}

/** One setting: a number of days with its own [저장]. */
function SettingRow({
  id,
  label,
  saved,
  unitText,
  field,
  savedMessage,
  hint,
}: {
  id: string
  label: string
  /** The value in the database. */
  saved: number
  unitText: string
  field: "expiryWarningDays" | "futureDocDays"
  savedMessage: (days: string) => string
  hint: string
}) {
  const [value, setValue] = useState(String(saved))
  // A new value from the server (after saving) resets the box.
  const [shown, setShown] = useState(saved)
  if (shown !== saved) {
    setShown(saved)
    setValue(String(saved))
  }
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const changed = value.trim() !== String(saved)
  const errorId = `${id}-error`
  const hintId = `${id}-hint`

  function save() {
    if (isPending) return
    startTransition(async () => {
      const result = await callPlaceAction(() =>
        updateInventorySettings({ [field]: value })
      )
      if (!result) return
      if (!result.ok) {
        setError(result.fieldErrors[field] ?? result.message)
        toast.error(result.message)
        return
      }
      setError(null)
      toast.success(savedMessage(value.trim().replace(/일$/, "")))
    })
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
      className="border-b border-grid-line last:border-b-0"
    >
      <FormRow
        label={label}
        htmlFor={id}
        error={error ?? undefined}
        errorId={errorId}
      >
        <span className="flex items-center gap-1.5">
          <Input
            id={id}
            inputMode="numeric"
            value={value}
            maxLength={3}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : hintId}
            onChange={(event) => {
              setValue(event.target.value)
              setError(null)
            }}
            className="h-8 w-20 rounded-sm text-right tabular-nums"
          />
          <span className="text-[13px]">{unitText}</span>
        </span>
        <ActionButton type="submit" size="sm" disabled={isPending || !changed}>
          {isPending && (
            <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
          )}
          저장
        </ActionButton>
        <p id={hintId} className="w-full text-xs text-muted-foreground">
          {hint}
        </p>
      </FormRow>
    </form>
  )
}
