"use client"

import { LoaderCircleIcon, Undo2Icon } from "lucide-react"
import Link from "next/link"
import { unstable_rethrow } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { ActionButton } from "@/components/erp/action-bar"
import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridEmpty,
  DataGridHead,
  DataGridHeadGroup,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { FormRow, FormTable } from "@/components/erp/form-table"
import { newRequestId } from "@/components/inventory/dialog-helpers"
import { ScheduledBadge } from "@/components/inventory/scheduled-badge"
import { useInventorySettings } from "@/components/inventory/use-inventory-settings"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { EMPTY_VALUE, formatDateTime, formatNumber } from "@/lib/format"
import {
  loadStockDocument,
  reverseStockDocument,
  type StockSaveResult,
} from "@/lib/inventory/actions"
import {
  expiryKindLabel,
  formatStockQuantity,
  reversalDateRange,
  STOCK_LIMITS,
} from "@/lib/inventory/constants"
import type { StockDocumentDetail } from "@/lib/inventory/queries"
import {
  buildStockLedgerHref,
  parseStockDocumentModal,
  todayInKorea,
} from "@/lib/inventory/schema"
import { isUuid } from "@/lib/products/schema"
import { cn } from "@/lib/utils"

const COLUMN_COUNT = 11

type LoadState =
  | { status: "loading" }
  | { status: "ready"; document: StockDocumentDetail }
  | { status: "missing" }
  | { status: "error" }

/**
 * 전표 보기 modal (?modal=view&id=…) of 실사재고조정: the 전표 header
 * (번호, 일자, 상태, 사유, 조정 금액) and every line (위치, 상품, 로트, 기한,
 * 조정 수량 + / −, 입고 단가, 금액 부가세 포함 / 별도, 메모). A 상품명 opens
 * 상품별 거래수불 from the 전표 date.
 *
 * [전표 취소] (when it is not a 취소 전표 and not undone yet) makes a 취소
 * 전표 with the opposite of every line; the database refuses it while the
 * stock the 취소 takes back is gone (e.g. a found lot issued since). The
 * links between a 전표 and its 취소 전표 open the other one.
 */
export function CountDocumentDialog({
  documentId,
  onClose,
  onOpenDocument,
}: {
  documentId: string
  onClose: () => void
  /** Opens another 전표 (its 취소 전표, or the 전표 a 취소 undoes). */
  onOpenDocument: (id: string) => void
}) {
  const [load, setLoad] = useState<LoadState>(
    isUuid(documentId) ? { status: "loading" } : { status: "missing" }
  )
  const [attempt, setAttempt] = useState(0)
  const [reverseOpen, setReverseOpen] = useState(false)
  const [, startLoad] = useTransition()

  // Read the 전표 (again after a 취소). In a transition, so a redirect from
  // the server (e.g. to the login page) is carried out by Next.js.
  useEffect(() => {
    if (!isUuid(documentId)) return
    let ignore = false
    startLoad(async () => {
      let document: StockDocumentDetail | null
      try {
        document = await loadStockDocument(documentId)
      } catch (error) {
        if (ignore) return
        unstable_rethrow(error)
        console.error(error)
        setLoad({ status: "error" })
        return
      }
      if (ignore) return
      setLoad(
        document && isCountDocument(document)
          ? { status: "ready", document }
          : { status: "missing" }
      )
    })
    return () => {
      ignore = true
    }
  }, [documentId, attempt])

  const document = load.status === "ready" ? load.document : null
  const isReversal = document?.docType === "reversal"
  const title = document
    ? `${isReversal ? "실사조정 취소 전표" : "실사조정 전표"} - ${document.docNo}`
    : "실사조정 전표"

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={title}
      footer={
        <>
          <ActionButton variant="secondary" size="lg" onClick={onClose}>
            닫기
          </ActionButton>
          {document?.canReverse && (
            <ActionButton
              variant="neutral"
              size="lg"
              onClick={() => setReverseOpen(true)}
            >
              <Undo2Icon aria-hidden="true" />
              전표 취소
            </ActionButton>
          )}
        </>
      }
    >
      {load.status === "loading" ? (
        <div className="flex flex-col gap-3" aria-busy="true">
          <span className="sr-only">전표를 불러오는 중…</span>
          <Skeleton className="h-24 w-full rounded-sm" />
          <Skeleton className="h-48 w-full rounded-sm" />
        </div>
      ) : load.status === "missing" ? (
        <Message
          title="전표를 찾을 수 없습니다"
          description="주소가 잘못되었거나 실사조정 전표가 아닙니다. 창을 닫고 목록에서 다시 골라 주세요."
        />
      ) : load.status === "error" ? (
        <Message
          title="전표를 불러오지 못했습니다"
          description="인터넷 연결을 확인한 뒤 다시 시도해 주세요."
        >
          <ActionButton
            variant="neutral"
            onClick={() => {
              setLoad({ status: "loading" })
              setAttempt((value) => value + 1)
            }}
          >
            다시 시도
          </ActionButton>
        </Message>
      ) : (
        <div className="flex flex-col gap-4">
          <DocumentHeader
            document={load.document}
            onOpenDocument={onOpenDocument}
          />
          <DocumentLines document={load.document} />
          {reverseOpen && (
            // Inside the 전표 dialog, so Esc closes only this one.
            <ReverseDialog
              document={load.document}
              onClose={() => setReverseOpen(false)}
              onReversed={() => {
                setReverseOpen(false)
                setAttempt((value) => value + 1)
              }}
            />
          )}
        </div>
      )}
    </ErpDialog>
  )
}

/** 실사조정 전표, or the 취소 전표 of one. */
function isCountDocument(document: StockDocumentDetail): boolean {
  return document.effectiveType === "count"
}

function DocumentHeader({
  document,
  onOpenDocument,
}: {
  document: StockDocumentDetail
  onOpenDocument: (id: string) => void
}) {
  const increased = document.lines.filter((line) => line.quantityDelta > 0)
  const decreased = document.lines.filter((line) => line.quantityDelta < 0)
  const linkClass =
    "rounded-sm font-bold text-brand tabular-nums underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <FormTable>
        <FormRow label="전표번호">
          <span className="font-bold tabular-nums">{document.docNo}</span>
        </FormRow>
        <FormRow label="전표 일자">
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            {document.docDate}
            <ScheduledBadge date={document.docDate} today={todayInKorea()} />
          </span>
        </FormRow>
        <FormRow label="구분">
          {document.docType === "reversal" ? "실사조정 취소" : "실사조정"}
        </FormRow>
        <FormRow label="상태">
          {document.reversedById ? (
            <span className="flex flex-wrap items-center gap-x-1.5">
              <span className="font-bold text-destructive">취소됨</span>
              <button
                type="button"
                className={linkClass}
                onClick={() => onOpenDocument(document.reversedById as string)}
              >
                {document.reversedByDocNo}
              </button>
              {document.reversedAt && (
                <span className="text-xs text-muted-foreground">
                  ({formatDateTime(document.reversedAt)})
                </span>
              )}
            </span>
          ) : document.reversesId ? (
            <span className="flex flex-wrap items-center gap-x-1.5">
              <button
                type="button"
                className={linkClass}
                onClick={() => onOpenDocument(document.reversesId as string)}
              >
                {document.reversesDocNo}
              </button>
              을(를) 되돌린 취소 전표
            </span>
          ) : (
            "정상"
          )}
        </FormRow>
      </FormTable>
      <FormTable>
        <FormRow label="사유·메모">
          <span className="whitespace-pre-wrap">
            {document.memo ?? EMPTY_VALUE}
          </span>
        </FormRow>
        <FormRow label="조정">
          <span>
            늘어남{" "}
            <strong className="font-bold text-brand">
              {formatNumber(increased.length, 0)}줄
            </strong>{" "}
            · 줄어듦{" "}
            <strong className="font-bold text-destructive">
              {formatNumber(decreased.length, 0)}줄
            </strong>
          </span>
        </FormRow>
        <FormRow label="조정 금액">
          <span className="tabular-nums">
            +{formatNumber(document.valueInInclVat, 0)}원 / −
            {formatNumber(document.valueOutInclVat, 0)}원
            <span className="ml-1 text-xs text-muted-foreground">
              (부가세 포함
              {document.costUnknown ? ", 단가 없는 로트 제외" : ""})
            </span>
          </span>
        </FormRow>
        <FormRow label="등록일시">
          <span className="tabular-nums">
            {formatDateTime(document.createdAt)}
          </span>
        </FormRow>
      </FormTable>
    </div>
  )
}

function DocumentLines({ document }: { document: StockDocumentDetail }) {
  const today = todayInKorea()
  return (
    <DataGrid
      aria-label="전표 내용"
      containerClassName="max-h-[min(30rem,50dvh)]"
      className={document.lines.length > 0 ? "min-w-[74rem]" : undefined}
    >
      <DataGridHeader>
        <tr>
          <DataGridHead rowSpan={2} className="w-10">
            줄
          </DataGridHead>
          <DataGridHead rowSpan={2} className="w-48">
            위치
          </DataGridHead>
          <DataGridHead rowSpan={2} className="w-28">
            상품코드
          </DataGridHead>
          <DataGridHead rowSpan={2} className="min-w-44">
            상품명
          </DataGridHead>
          <DataGridHead rowSpan={2} className="w-32">
            로트번호
          </DataGridHead>
          <DataGridHead rowSpan={2} className="w-40">
            기한
          </DataGridHead>
          <DataGridHead rowSpan={2} className="w-28">
            조정 수량
          </DataGridHead>
          <DataGridHead rowSpan={2} className="w-24">
            입고단가
          </DataGridHead>
          <DataGridHeadGroup colSpan={2}>금액</DataGridHeadGroup>
          <DataGridHead rowSpan={2} className="min-w-36">
            메모
          </DataGridHead>
        </tr>
        <tr>
          <DataGridHead subHead className="w-24">
            부가세 포함
          </DataGridHead>
          <DataGridHead subHead className="w-24">
            부가세 별도
          </DataGridHead>
        </tr>
      </DataGridHeader>
      <DataGridBody>
        {document.lines.length === 0 && (
          <DataGridEmpty colSpan={COLUMN_COUNT}>줄이 없습니다.</DataGridEmpty>
        )}
        {document.lines.map((line) => {
          const sign = line.quantityDelta > 0 ? 1 : -1
          return (
            <DataGridRow key={line.id}>
              <DataGridCell numeric className="text-muted-foreground">
                {line.lineNo}
              </DataGridCell>
              <DataGridCell
                className="max-w-48 truncate"
                title={`${line.warehouseName} > ${line.zoneName} > ${line.locationCode}`}
              >
                <span className="text-muted-foreground">
                  {line.zoneName} &gt;{" "}
                </span>
                <span className="font-bold">{line.locationCode}</span>
              </DataGridCell>
              <DataGridCell align="center" className="tabular-nums">
                {line.productCode}
              </DataGridCell>
              <DataGridCell
                className="max-w-64 truncate"
                title={line.productName}
              >
                <Link
                  href={buildStockLedgerHref({
                    productId: line.productId,
                    from: document.docDate,
                    to: today,
                  })}
                  className="rounded-sm text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                  title="상품별 거래수불 보기"
                >
                  {line.productName}
                </Link>
                {line.productSpec && (
                  <span className="text-muted-foreground">
                    {" "}
                    {line.productSpec}
                  </span>
                )}
              </DataGridCell>
              <DataGridCell className="tabular-nums">{line.lotNo}</DataGridCell>
              <DataGridCell className="tabular-nums">
                {line.expiryKind === "none" || !line.expiryDate ? (
                  <span className="text-muted-foreground">기한 없음</span>
                ) : (
                  <>
                    <span className="text-xs text-muted-foreground">
                      {expiryKindLabel(line.expiryKind)}
                    </span>{" "}
                    {line.expiryDate}
                  </>
                )}
              </DataGridCell>
              <DataGridCell
                numeric
                className={cn(
                  "font-bold",
                  sign > 0 ? "text-brand" : "text-destructive"
                )}
              >
                {sign > 0 ? "+" : "−"}
                {formatStockQuantity(
                  Math.abs(line.quantityDelta),
                  line.productUnit
                )}
              </DataGridCell>
              <DataGridCell numeric>
                {line.unitCostInclVat === null
                  ? EMPTY_VALUE
                  : formatNumber(line.unitCostInclVat, 0)}
              </DataGridCell>
              <DataGridCell numeric>
                <SignedNumber value={line.amountInclVat} sign={sign} />
              </DataGridCell>
              <DataGridCell numeric>
                <SignedNumber value={line.amountExclVat} sign={sign} />
              </DataGridCell>
              <DataGridCell
                className="max-w-56 truncate"
                title={line.memo ?? ""}
              >
                {line.memo ?? EMPTY_VALUE}
              </DataGridCell>
            </DataGridRow>
          )
        })}
      </DataGridBody>
    </DataGrid>
  )
}

function SignedNumber({ value, sign }: { value: number | null; sign: number }) {
  if (value === null) return <span className="text-muted-foreground">-</span>
  return (
    <span className={sign > 0 ? "text-brand" : "text-destructive"}>
      {sign > 0 ? "+" : "−"}
      {formatNumber(Math.abs(value), 0)}
    </span>
  )
}

function Message({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 py-10 text-center"
    >
      <p className="font-bold">{title}</p>
      <p className="text-muted-foreground">{description}</p>
      {children}
    </div>
  )
}

/**
 * [전표 취소] confirm: 취소 일자 (today by default, or the 전표 date of a
 * 예정 실사; not before the 전표 date; at most today + the 재고 설정's days
 * — reversalDateRange) and a memo (empty = "<전표번호> 취소"). F8 = 취소
 * 전표 등록.
 */
function ReverseDialog({
  document,
  onClose,
  onReversed,
}: {
  document: StockDocumentDetail
  onClose: () => void
  onReversed: () => void
}) {
  const [today] = useState(() => todayInKorea())
  const settings = useInventorySettings()
  // Until the setting is read: today + 0 (the 전표 date of a 예정 실사).
  const range = reversalDateRange(
    document.docDate,
    settings?.futureDocDays ?? 0,
    today
  )
  const [docDate, setDocDate] = useState(range.defaultDate)
  const [memo, setMemo] = useState("")
  const [error, setError] = useState<{
    message: string
    docDate?: string
  } | null>(null)
  // One request id per opening: a retry after a network error never makes
  // a second 취소 전표.
  const [requestId] = useState(() => newRequestId())
  const [isPending, startTransition] = useTransition()
  const submittingRef = useRef(false)

  function isStillShown(): boolean {
    const shown = parseStockDocumentModal(
      new URLSearchParams(window.location.search)
    )
    return shown?.mode === "view" && shown.id === document.id
  }

  function submit() {
    if (submittingRef.current) return
    if (
      docDate &&
      (docDate < range.min || (settings !== null && docDate > range.max))
    ) {
      setError({
        message: `취소 일자는 ${range.min}부터 ${range.max === today ? `오늘(${today})` : range.max}까지 고를 수 있습니다.`,
        docDate: "날짜를 확인해 주세요.",
      })
      return
    }
    submittingRef.current = true
    startTransition(async () => {
      let result: StockSaveResult
      try {
        result = await reverseStockDocument(document.id, {
          requestId,
          docDate,
          memo,
        })
      } catch (caught) {
        submittingRef.current = false
        unstable_rethrow(caught)
        console.error(caught)
        setError({
          message:
            "취소했는지 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요. (다시 눌러도 취소 전표는 하나만 생깁니다.)",
        })
        return
      }
      submittingRef.current = false
      if (!result.ok) {
        if (!isStillShown()) {
          toast.error(result.message)
          return
        }
        setError({
          message: result.message,
          docDate: result.fieldErrors.docDate,
        })
        return
      }
      toast.success(result.message)
      if (isStillShown()) onReversed()
    })
  }

  useHotkeys({ F5: () => {}, F8: submit })

  return (
    <ErpDialog
      open
      size="md"
      onOpenChange={(open) => {
        if (!open && !isPending) onClose()
      }}
      title={`전표 취소 - ${document.docNo}`}
      footer={
        <>
          <ActionButton
            variant="secondary"
            size="lg"
            disabled={isPending}
            onClick={onClose}
          >
            돌아가기
          </ActionButton>
          <ActionButton
            size="lg"
            keyHint="F8"
            disabled={isPending}
            onClick={submit}
          >
            {isPending && (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            )}
            취소 전표 등록
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-[13px]">
        <ul className="flex list-disc flex-col gap-1 pl-5">
          <li>
            이 실사 전표의 조정을 모두 반대로 되돌리는{" "}
            <strong className="font-bold">취소 전표</strong>가 새로 생깁니다.
            원래 전표는 지워지지 않고 ‘취소됨’으로 남습니다.
          </li>
          <li>
            실사로 늘린 재고(발견 재고 포함)가 그 뒤 출고·이동·폐기되었다면
            취소할 수 없습니다. 그 전표들을 먼저 취소해 주세요.
          </li>
          <li>취소 전표는 다시 취소할 수 없습니다.</li>
        </ul>
        <FormTable>
          <FormRow
            label="취소 일자"
            htmlFor="reverse-date"
            error={error?.docDate}
            errorId="reverse-date-error"
            hint={`${range.min} ~ ${range.max === today ? "오늘" : range.max}`}
          >
            <Input
              id="reverse-date"
              type="date"
              min={range.min}
              max={settings ? range.max : undefined}
              value={docDate}
              aria-invalid={error?.docDate ? true : undefined}
              aria-describedby={
                error?.docDate ? "reverse-date-error" : undefined
              }
              onChange={(event) => setDocDate(event.target.value)}
              className="h-8 w-40 rounded-sm tabular-nums"
            />
          </FormRow>
          <FormRow label="메모" htmlFor="reverse-memo">
            <Input
              id="reverse-memo"
              value={memo}
              maxLength={STOCK_LIMITS.memoMaxLength}
              placeholder={`${document.docNo} 취소`}
              autoComplete="off"
              onChange={(event) => setMemo(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.preventDefault()
              }}
              className="h-8 w-full rounded-sm"
            />
          </FormRow>
        </FormTable>
        {error && (
          <p role="alert" className="font-bold text-destructive">
            {error.message}
          </p>
        )}
      </div>
    </ErpDialog>
  )
}
