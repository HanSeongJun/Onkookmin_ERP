"use client"

import { LoaderCircleIcon, Undo2Icon } from "lucide-react"
import { unstable_rethrow } from "next/navigation"
import { useEffect, useState, useTransition } from "react"
import { toast } from "sonner"

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
import { FormRow, FormTable } from "@/components/erp/form-table"
import { Skeleton } from "@/components/ui/skeleton"
import { useHotkeys } from "@/hooks/use-hotkeys"
import {
  loadStockDocument,
  type StockSaveResult,
} from "@/lib/inventory/actions"
import {
  disposalReasonLabel,
  formatPlacePath,
  formatStockQuantity,
  stockDocumentTypeLabel,
} from "@/lib/inventory/constants"
import type {
  StockDocumentDetail,
  StockDocumentLine,
} from "@/lib/inventory/queries"
import { isUuid } from "@/lib/products/schema"
import { daysUntil, formatDateTime, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

import { isNestedDialogOpen } from "./dialog-helpers"
import { stockDocumentKindLabel } from "./document-screens"
import { ExpiryText } from "./expiry-badge"
import { StockDocumentStatus } from "./stock-document-grid"
import { StockReversalDialog } from "./stock-reversal-dialog"
import { StorageFitIcon } from "./storage-fit"

type LoadState =
  | { status: "loading" }
  | { status: "ready"; document: StockDocumentDetail }
  | { status: "missing" }
  | { status: "error" }

/**
 * 전표 보기 modal (?modal=view&id=…): the header (전표번호, 구분, 일자,
 * 거래처, 상태, 메모, 등록일시) and every line (상품, 로트, 기한, 위치,
 * 수량, 단가, 금액). A 이동 전표 shows each line as 보내는 위치 → 받는
 * 위치. 전표 are never edited: [전표 취소] makes a 취소 전표 (see
 * StockReversalDialog). Links to the 취소 전표 / the 전표 a 취소 전표 undoes
 * open that one here (`onOpenDocument`). `onNew` adds [신규 | F5].
 *
 * Mount it with a `key` per document id.
 */
export function StockDocumentViewDialog({
  documentId,
  expiryWarningDays,
  onClose,
  onOpenDocument,
  onNew,
  newLabel = "신규",
}: {
  documentId: string
  expiryWarningDays: number
  onClose: () => void
  /** Opens another 전표 (취소 전표 links) in place of this one. */
  onOpenDocument: (documentId: string) => void
  /** [신규 | F5]: opens the 등록 modal in place of this one. */
  onNew?: () => void
  newLabel?: string
}) {
  const [load, setLoad] = useState<LoadState>(
    isUuid(documentId) ? { status: "loading" } : { status: "missing" }
  )
  const [attempt, setAttempt] = useState(0)
  const [reversalOpen, setReversalOpen] = useState(false)
  const [, startLoad] = useTransition()

  useEffect(() => {
    if (!isUuid(documentId)) return
    let ignore = false
    startLoad(async () => {
      try {
        const document = await loadStockDocument(documentId)
        if (ignore) return
        setLoad(
          document ? { status: "ready", document } : { status: "missing" }
        )
      } catch (error) {
        unstable_rethrow(error)
        if (ignore) return
        console.error(error)
        setLoad({ status: "error" })
      }
    })
    return () => {
      ignore = true
    }
  }, [documentId, attempt])

  useHotkeys({
    F5:
      reversalOpen || !onNew
        ? undefined
        : () => {
            if (!isNestedDialogOpen()) onNew()
          },
  })

  function reversed(result: Extract<StockSaveResult, { ok: true }>) {
    toast.success(result.message, {
      description: "원래 전표는 ‘취소됨’으로 표시됩니다.",
    })
    setAttempt((value) => value + 1)
  }

  const document = load.status === "ready" ? load.document : null
  const title = document
    ? `${stockDocumentKindLabel(document)} 전표 - ${document.docNo}`
    : "전표 보기"

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={title}
      footer={
        <>
          {document?.canReverse && (
            <ActionButton
              variant="secondary"
              size="lg"
              onClick={() => setReversalOpen(true)}
            >
              <Undo2Icon aria-hidden="true" />
              전표 취소
            </ActionButton>
          )}
          {onNew && (
            <ActionButton
              variant="neutral"
              size="lg"
              keyHint="F5"
              onClick={onNew}
            >
              {newLabel}
            </ActionButton>
          )}
          <ActionButton size="lg" onClick={onClose}>
            닫기
          </ActionButton>
        </>
      }
    >
      {load.status === "loading" ? (
        <ViewLoading />
      ) : load.status === "missing" ? (
        <ViewMessage
          title="전표를 찾을 수 없습니다"
          description="주소가 잘못되었거나 없는 전표입니다. 창을 닫고 목록에서 다시 선택해 주세요."
        />
      ) : load.status === "error" ? (
        <ViewMessage
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
        </ViewMessage>
      ) : (
        <DocumentBody
          document={load.document}
          expiryWarningDays={expiryWarningDays}
          onOpenDocument={onOpenDocument}
        />
      )}
      {reversalOpen && document && (
        <StockReversalDialog
          document={document}
          onClose={() => setReversalOpen(false)}
          onReversed={reversed}
        />
      )}
    </ErpDialog>
  )
}

function DocumentBody({
  document,
  expiryWarningDays,
  onOpenDocument,
}: {
  document: StockDocumentDetail
  expiryWarningDays: number
  onOpenDocument: (documentId: string) => void
}) {
  const isTransfer = document.effectiveType === "transfer"
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-x-5 gap-y-2 lg:grid-cols-2">
        <FormTable>
          <FormRow label="전표번호">
            <span className="font-bold tabular-nums">{document.docNo}</span>
          </FormRow>
          <FormRow label="구분">{stockDocumentKindLabel(document)}</FormRow>
          <FormRow label="전표일자">
            <span className="tabular-nums">{document.docDate}</span>
          </FormRow>
          {document.partnerName && (
            <FormRow label="거래처">
              {document.partnerCode} {document.partnerName}
            </FormRow>
          )}
        </FormTable>
        <FormTable>
          <FormRow label="상태">
            <StockDocumentStatus row={document} />
            {document.reversedById && document.reversedByDocNo && (
              <DocumentLink
                label={`취소 전표 ${document.reversedByDocNo} 보기`}
                onClick={() => onOpenDocument(document.reversedById!)}
              />
            )}
            {document.reversesId && document.reversesDocNo && (
              <DocumentLink
                label={`원래 전표 ${document.reversesDocNo} 보기`}
                onClick={() => onOpenDocument(document.reversesId!)}
              />
            )}
          </FormRow>
          <FormRow label="메모">
            <span className="whitespace-pre-wrap">{document.memo ?? "-"}</span>
          </FormRow>
          <FormRow label="등록일시">
            <span className="tabular-nums">
              {formatDateTime(document.createdAt)}
            </span>
          </FormRow>
        </FormTable>
      </div>

      {isTransfer ? (
        <TransferLines
          document={document}
          expiryWarningDays={expiryWarningDays}
        />
      ) : (
        <MovementLines
          document={document}
          expiryWarningDays={expiryWarningDays}
        />
      )}
      {document.costUnknown && (
        <p className="text-xs text-muted-foreground">
          * 입고 단가를 모르는 로트는 금액이 비어 있고 합계에서 빠집니다.
        </p>
      )}
    </div>
  )
}

function DocumentLink({
  label,
  onClick,
}: {
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[13px] text-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </button>
  )
}

function linePlace(line: StockDocumentLine): string {
  return formatPlacePath(line.warehouseName, line.zoneName, line.locationCode)
}

/**
 * The 금액 합계 (부가세 포함) of a 전표: + in, − out. A 묶음상품 입고 line
 * (and its 취소) counts once with the typed 묶음상품 단가 × 수량, exactly as
 * typed (same rule as stock_document_list_items.value_in_incl_vat); every
 * other line |수량| × the lot's 단가.
 */
function documentTotalInclVat(lines: StockDocumentDetail["lines"]): number {
  let total = 0
  const countedBundleLines = new Set<string>()
  for (const line of lines) {
    const sign = Math.sign(line.quantityDelta)
    if (
      line.bundleUnitCostInclVat !== null &&
      line.bundleQuantity !== null &&
      line.bundleId !== null
    ) {
      const key = `${line.lineNo}:${line.bundleId}`
      if (countedBundleLines.has(key)) continue
      countedBundleLines.add(key)
      total +=
        Math.round(line.bundleQuantity * line.bundleUnitCostInclVat) * sign
      continue
    }
    total += (line.amountInclVat ?? 0) * sign
  }
  return total
}

function signedQuantity(value: number, unit: string): string {
  const text = formatStockQuantity(Math.abs(value), unit)
  return value > 0 ? `+${text}` : `−${text}`
}

/** The lines of every kind but 이동: one row per ledger line. */
function MovementLines({
  document,
  expiryWarningDays,
}: {
  document: StockDocumentDetail
  expiryWarningDays: number
}) {
  const kind = document.effectiveType
  const showReason = kind === "disposal"
  const showManufactured = kind === "receipt" || kind === "opening"
  const lines = document.lines
  const totalIncl = documentTotalInclVat(lines)
  const hasBundleCost = lines.some(
    (line) => line.bundleUnitCostInclVat !== null
  )
  const columnCount = 11 + (showReason ? 1 : 0) + (showManufactured ? 1 : 0)

  return (
    <section aria-label="전표 내용" className="flex flex-col gap-1.5">
      <h3 className="text-[15px] font-bold">
        전표 내용{" "}
        <span className="text-[13px] font-normal text-muted-foreground">
          ({formatNumber(document.lineCount, 0)}줄
          {document.movementCount !== document.lineCount &&
            ` · 기준상품·로트별 ${formatNumber(document.movementCount, 0)}건`}
          )
        </span>
      </h3>
      <DataGrid
        aria-label="전표 내용"
        containerClassName="max-h-[min(30rem,55dvh)]"
        className={lines.length > 0 ? "min-w-[78rem]" : undefined}
      >
        <DataGridHeader>
          <tr>
            <DataGridHead className="w-10">줄</DataGridHead>
            <DataGridHead className="w-28">상품코드</DataGridHead>
            <DataGridHead className="min-w-44">상품명</DataGridHead>
            <DataGridHead className="w-36">로트번호</DataGridHead>
            {showManufactured && (
              <DataGridHead className="w-24">제조일자</DataGridHead>
            )}
            <DataGridHead className="w-56">기한</DataGridHead>
            <DataGridHead className="min-w-44">위치</DataGridHead>
            <DataGridHead className="w-28">수량</DataGridHead>
            <DataGridHead className="w-24">단가(포함)</DataGridHead>
            <DataGridHead className="w-28">금액(포함)</DataGridHead>
            <DataGridHead className="w-28">금액(별도)</DataGridHead>
            {showReason && <DataGridHead className="w-20">사유</DataGridHead>}
            <DataGridHead className="min-w-32">메모</DataGridHead>
          </tr>
        </DataGridHeader>
        <DataGridBody>
          {lines.length === 0 ? (
            <DataGridEmpty colSpan={columnCount}>줄이 없습니다.</DataGridEmpty>
          ) : (
            lines.map((line) => (
              <DataGridRow key={line.id}>
                <DataGridCell numeric>{line.lineNo}</DataGridCell>
                <DataGridCell align="center" className="tabular-nums">
                  {line.productCode}
                </DataGridCell>
                <DataGridCell className="max-w-72">
                  <span className="block truncate" title={line.productName}>
                    {line.productName}
                  </span>
                  {line.bundleName && (
                    <span className="block truncate text-xs text-muted-foreground">
                      묶음: {line.bundleName}
                      {line.bundleQuantity !== null &&
                        ` × ${formatStockQuantity(line.bundleQuantity, line.bundleUnit ?? "")}`}
                      {line.bundleUnitCostInclVat !== null &&
                        ` · ${line.bundleUnit ?? "1개"}당 ${formatNumber(line.bundleUnitCostInclVat, 0)}원`}
                    </span>
                  )}
                </DataGridCell>
                <DataGridCell className="tabular-nums">
                  {line.lotNo}
                </DataGridCell>
                {showManufactured && (
                  <DataGridCell align="center" className="tabular-nums">
                    {line.manufacturedDate ?? "-"}
                  </DataGridCell>
                )}
                <DataGridCell>
                  <ExpiryText
                    kind={line.expiryKind}
                    date={line.expiryDate}
                    daysLeft={daysUntil(line.expiryDate)}
                    warningDays={expiryWarningDays}
                  />
                </DataGridCell>
                <DataGridCell className="max-w-64">
                  <span className="flex items-center gap-1">
                    <span className="truncate" title={linePlace(line)}>
                      {linePlace(line)}
                    </span>
                    {line.quantityDelta > 0 && (
                      <StorageFitIcon
                        productStorage={line.productStorageType}
                        zoneStorage={line.zoneStorageType}
                      />
                    )}
                  </span>
                </DataGridCell>
                <DataGridCell
                  numeric
                  className={cn(
                    "font-bold",
                    line.quantityDelta < 0 ? "text-destructive" : "text-brand"
                  )}
                >
                  {signedQuantity(line.quantityDelta, line.productUnit)}
                </DataGridCell>
                <DataGridCell numeric>
                  {formatNumber(line.unitCostInclVat, 0)}
                </DataGridCell>
                <DataGridCell numeric>
                  {formatNumber(line.amountInclVat, 0)}
                </DataGridCell>
                <DataGridCell numeric>
                  {formatNumber(line.amountExclVat, 0)}
                </DataGridCell>
                {showReason && (
                  <DataGridCell align="center">
                    {line.reason ? disposalReasonLabel(line.reason) : "-"}
                  </DataGridCell>
                )}
                <DataGridCell
                  className="max-w-56 truncate"
                  title={line.memo ?? undefined}
                >
                  {line.memo ?? ""}
                </DataGridCell>
              </DataGridRow>
            ))
          )}
        </DataGridBody>
      </DataGrid>
      {lines.length > 0 && (
        <p className="text-right text-[13px]">
          금액 합계(부가세 포함):{" "}
          <strong className="font-bold tabular-nums">
            {formatNumber(totalIncl, 0)}원
          </strong>
          <span className="ml-1 text-xs text-muted-foreground">
            (들어온 금액은 +, 나간 금액은 −
            {hasBundleCost &&
              "; 묶음상품 줄은 입력한 묶음상품 단가 × 수량으로 더함 — 기준상품별 금액은 원 단위로 나눈 값이라 합이 조금 다를 수 있음"}
            )
          </span>
        </p>
      )}
    </section>
  )
}

/** One move of a 이동 전표: the − line (from) and the + line (to). */
type TransferPair = {
  key: string
  lineNo: number
  from: StockDocumentLine | null
  to: StockDocumentLine | null
}

function transferPairs(lines: StockDocumentLine[]): TransferPair[] {
  const pairs = new Map<string, TransferPair>()
  for (const line of lines) {
    const key = `${line.lineNo}:${line.lotId}`
    const pair = pairs.get(key) ?? {
      key,
      lineNo: line.lineNo,
      from: null,
      to: null,
    }
    if (line.quantityDelta < 0) pair.from = line
    else pair.to = line
    pairs.set(key, pair)
  }
  return [...pairs.values()]
}

/** The lines of a 이동 전표 (or its 취소): 보내는 위치 → 받는 위치. */
function TransferLines({
  document,
  expiryWarningDays,
}: {
  document: StockDocumentDetail
  expiryWarningDays: number
}) {
  const pairs = transferPairs(document.lines)
  return (
    <section aria-label="이동 내용" className="flex flex-col gap-1.5">
      <h3 className="text-[15px] font-bold">
        이동 내용{" "}
        <span className="text-[13px] font-normal text-muted-foreground">
          ({formatNumber(pairs.length, 0)}줄)
        </span>
      </h3>
      <DataGrid
        aria-label="이동 내용"
        containerClassName="max-h-[min(30rem,55dvh)]"
        className={pairs.length > 0 ? "min-w-[72rem]" : undefined}
      >
        <DataGridHeader>
          <tr>
            <DataGridHead className="w-10">줄</DataGridHead>
            <DataGridHead className="w-28">상품코드</DataGridHead>
            <DataGridHead className="min-w-44">상품명</DataGridHead>
            <DataGridHead className="w-36">로트번호</DataGridHead>
            <DataGridHead className="w-56">기한</DataGridHead>
            <DataGridHead className="min-w-44">보내는 위치</DataGridHead>
            <DataGridHead className="min-w-44">받는 위치</DataGridHead>
            <DataGridHead className="w-28">수량</DataGridHead>
            <DataGridHead className="min-w-32">메모</DataGridHead>
          </tr>
        </DataGridHeader>
        <DataGridBody>
          {pairs.length === 0 ? (
            <DataGridEmpty colSpan={9}>줄이 없습니다.</DataGridEmpty>
          ) : (
            pairs.map((pair) => {
              const line = (pair.to ?? pair.from)!
              return (
                <DataGridRow key={pair.key}>
                  <DataGridCell numeric>{pair.lineNo}</DataGridCell>
                  <DataGridCell align="center" className="tabular-nums">
                    {line.productCode}
                  </DataGridCell>
                  <DataGridCell
                    className="max-w-72 truncate"
                    title={line.productName}
                  >
                    {line.productName}
                  </DataGridCell>
                  <DataGridCell className="tabular-nums">
                    {line.lotNo}
                  </DataGridCell>
                  <DataGridCell>
                    <ExpiryText
                      kind={line.expiryKind}
                      date={line.expiryDate}
                      daysLeft={daysUntil(line.expiryDate)}
                      warningDays={expiryWarningDays}
                    />
                  </DataGridCell>
                  <DataGridCell className="max-w-64 truncate">
                    {pair.from ? linePlace(pair.from) : "-"}
                  </DataGridCell>
                  <DataGridCell className="max-w-64">
                    {pair.to ? (
                      <span className="flex items-center gap-1">
                        <span className="truncate" title={linePlace(pair.to)}>
                          {linePlace(pair.to)}
                        </span>
                        <StorageFitIcon
                          productStorage={pair.to.productStorageType}
                          zoneStorage={pair.to.zoneStorageType}
                        />
                      </span>
                    ) : (
                      "-"
                    )}
                  </DataGridCell>
                  <DataGridCell numeric className="font-bold">
                    {formatStockQuantity(
                      Math.abs(line.quantityDelta),
                      line.productUnit
                    )}
                  </DataGridCell>
                  <DataGridCell
                    className="max-w-56 truncate"
                    title={line.memo ?? undefined}
                  >
                    {line.memo ?? ""}
                  </DataGridCell>
                </DataGridRow>
              )
            })
          )}
        </DataGridBody>
      </DataGrid>
      <p className="text-xs text-muted-foreground">
        이동은 재고 수량이 같은 로트 그대로 다른 위치로 옮겨집니다(전체 재고는
        그대로). 받는 위치의 ⚠는 보관온도가 맞지 않는 구역입니다.
        {document.docType === "reversal" &&
          ` 이 전표는 ${stockDocumentTypeLabel("transfer")}을 되돌린 취소 전표입니다.`}
      </p>
    </section>
  )
}

function ViewLoading() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only">전표를 불러오는 중…</span>
      <div className="grid gap-5 lg:grid-cols-2">
        {[4, 3].map((rows, index) => (
          <div
            key={index}
            className="flex flex-col gap-px border border-grid-line"
          >
            {Array.from({ length: rows }, (_, row) => (
              <Skeleton key={row} className="h-10 rounded-none" />
            ))}
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-px border border-input">
        <Skeleton className="h-9 rounded-none bg-brand-tint-strong" />
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-8 rounded-none" />
        ))}
      </div>
      <LoaderCircleIcon
        aria-hidden="true"
        className="mx-auto size-5 animate-spin text-muted-foreground"
      />
    </div>
  )
}

function ViewMessage({
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
      className="flex flex-col items-center gap-2 px-4 py-16 text-center"
    >
      <p className="text-base font-bold">{title}</p>
      <p className="text-[13px] text-muted-foreground">{description}</p>
      {children}
    </div>
  )
}
