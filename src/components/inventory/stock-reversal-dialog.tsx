"use client"

import { LoaderCircleIcon } from "lucide-react"
import { unstable_rethrow } from "next/navigation"
import { useRef, useState, useTransition } from "react"

import { ActionButton } from "@/components/erp/action-bar"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { FormRow, FormTable } from "@/components/erp/form-table"
import { Input } from "@/components/ui/input"
import { useHotkeys } from "@/hooks/use-hotkeys"
import {
  reverseStockDocument,
  type StockSaveResult,
} from "@/lib/inventory/actions"
import {
  docDateLimitMessage,
  isScheduledDate,
  reversalDateRange,
  STOCK_LIMITS,
} from "@/lib/inventory/constants"
import type { StockDocumentDetail } from "@/lib/inventory/queries"
import { todayInKorea } from "@/lib/inventory/schema"

import { newRequestId } from "./dialog-helpers"
import { stockDocumentKindLabel } from "./document-screens"
import { useInventorySettings } from "./use-inventory-settings"

/**
 * 전표 취소 dialog: makes a 취소 전표 with the opposite of every line of
 * `document` (the original stays, marked 취소됨). 취소 일자 (default today,
 * or the original date of a 예정 전표; not before the original's date, at
 * most today + the 재고 설정's days — reversalDateRange) and 메모 (default
 * "<전표번호> 취소"). The database refuses when the stock it takes back is
 * gone (e.g. a 입고 already partly issued, also by a 예정 출고: undo that
 * 출고 first) — the message is shown here and nothing changes. F8 = 취소
 * 전표 저장.
 *
 * Mount it only while it is open; its save request id is made when it
 * opens (a retry after a lost answer never makes a second 취소 전표).
 */
export function StockReversalDialog({
  document,
  onClose,
  onReversed,
}: {
  document: StockDocumentDetail
  onClose: () => void
  onReversed: (result: Extract<StockSaveResult, { ok: true }>) => void
}) {
  const today = todayInKorea()
  const settings = useInventorySettings()
  // Until the setting is read: today + 0 (the original's date for a 예정 전표).
  const range = reversalDateRange(
    document.docDate,
    settings?.futureDocDays ?? 0,
    today
  )
  const [requestId] = useState(() => newRequestId())
  const [docDate, setDocDate] = useState(range.defaultDate)
  const [memo, setMemo] = useState("")
  const [error, setError] = useState<{
    message: string
    field: "docDate" | "memo" | null
  } | null>(null)
  const [isPending, startTransition] = useTransition()
  const submittingRef = useRef(false)

  function save() {
    if (submittingRef.current || isPending) return
    if (docDate && docDate < document.docDate) {
      setError({
        message: `취소 일자는 원래 전표 일자(${document.docDate})보다 빠를 수 없습니다.`,
        field: "docDate",
      })
      return
    }
    if (docDate && settings && docDate > range.max) {
      setError({
        message:
          document.docDate > range.max
            ? `이 예정 전표는 원래 전표 일자(${document.docDate})로 취소해 주세요.`
            : docDateLimitMessage(settings.futureDocDays, today, "취소 일자는"),
        field: "docDate",
      })
      return
    }
    submittingRef.current = true
    startTransition(async () => {
      let result: StockSaveResult
      try {
        result = await reverseStockDocument(document.id, {
          requestId,
          docDate: docDate === range.defaultDate ? "" : docDate,
          memo,
        })
      } catch (caught) {
        submittingRef.current = false
        unstable_rethrow(caught)
        console.error(caught)
        setError({
          message:
            "취소하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
          field: null,
        })
        return
      }
      submittingRef.current = false
      if (!result.ok) {
        setError({
          message: result.message,
          field: result.fieldErrors.docDate
            ? "docDate"
            : result.fieldErrors.memo
              ? "memo"
              : null,
        })
        return
      }
      onReversed(result)
      onClose()
    })
  }

  useHotkeys({ F5: () => {}, F8: save })

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) onClose()
      }}
      title={`전표 취소 - ${document.docNo}`}
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
          <ActionButton
            size="lg"
            keyHint="F8"
            disabled={isPending}
            onClick={save}
          >
            {isPending && (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            )}
            취소 전표 저장
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p>
          <strong className="font-bold">
            {stockDocumentKindLabel(document)} 전표 {document.docNo}
          </strong>
          의 수량을 모두 되돌리는{" "}
          <strong className="font-bold">취소 전표</strong>를 만듭니다.
        </p>
        <ul className="flex list-disc flex-col gap-0.5 pl-5 text-[13px] text-muted-foreground marker:text-brand">
          <li>
            원래 전표는 지워지지 않고 ‘취소됨’으로 남습니다. 재고 기록은
            고치거나 지울 수 없고, 이렇게 반대 전표로만 바로잡습니다.
          </li>
          <li>
            되돌릴 재고가 이미 출고·이동되었으면 취소할 수 없습니다. 그 전표를
            먼저 취소해 주세요.
          </li>
          <li>취소 전표는 다시 취소할 수 없습니다.</li>
        </ul>
        <FormTable>
          <FormRow
            label="취소 일자"
            htmlFor="reversal-date"
            required
            error={error?.field === "docDate" ? error.message : undefined}
            errorId="reversal-date-error"
            hint={
              isScheduledDate(document.docDate, today)
                ? `예정 전표: ${range.min} ~ ${range.max}`
                : `원래 전표 일자 ${range.min} ~ ${range.max === today ? "오늘" : range.max}`
            }
          >
            <Input
              id="reversal-date"
              type="date"
              value={docDate}
              min={range.min}
              max={settings ? range.max : undefined}
              aria-invalid={error?.field === "docDate"}
              aria-describedby={
                error?.field === "docDate" ? "reversal-date-error" : undefined
              }
              onChange={(event) => {
                setDocDate(event.target.value)
                setError(null)
              }}
              className="h-8 w-40 rounded-sm"
            />
          </FormRow>
          <FormRow
            label="메모"
            htmlFor="reversal-memo"
            error={error?.field === "memo" ? error.message : undefined}
            errorId="reversal-memo-error"
          >
            <Input
              id="reversal-memo"
              value={memo}
              maxLength={STOCK_LIMITS.memoMaxLength}
              placeholder={`${document.docNo} 취소 (비워 두면 자동)`}
              aria-invalid={error?.field === "memo"}
              onChange={(event) => {
                setMemo(event.target.value)
                setError(null)
              }}
              className="h-8 rounded-sm"
            />
          </FormRow>
        </FormTable>
        {error && error.field === null && (
          <p
            role="alert"
            className="border border-destructive/40 bg-destructive/5 px-3 py-2 text-[13px] font-bold text-destructive"
          >
            {error.message}
          </p>
        )}
      </div>
    </ErpDialog>
  )
}
