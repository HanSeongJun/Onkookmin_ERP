"use client"

import {
  ChevronDownIcon,
  LoaderCircleIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { unstable_rethrow } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"

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
import { searchPartnersForStock } from "@/lib/inventory/actions"
import type { StockPartnerOption } from "@/lib/inventory/queries"
import { cn } from "@/lib/utils"

const SEARCH_DELAY = 300

const PARTNER_TYPE_LABELS: Record<StockPartnerOption["partnerType"], string> = {
  sales: "매출처",
  purchase: "매입처",
  both: "매출·매입",
}

/** Which 거래처 a 전표 may pick: "supplier" (입고: 매입처, 매출·매입) or "any" (출고). */
export type StockPartnerKind = "supplier" | "any"

type PartnerResult =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; searched: string; rows: StockPartnerOption[] }

/**
 * 거래처 선택 dialog of a 전표 header: 사용 중인 거래처 by 코드 or 이름
 * (at most 100 shown; type more to narrow). `kind` "supplier" lists 매입처
 * and 매출·매입 only (입고); "any" every kind (출고, e.g. a 매입처 for 반품).
 * Double-click / Enter picks a row. Mount it only while it is open.
 */
export function StockPartnerPickerDialog({
  kind,
  title,
  onPick,
  onClose,
}: {
  kind: StockPartnerKind
  title?: string
  onPick: (partner: StockPartnerOption) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<PartnerResult>({ status: "loading" })
  const [activeId, setActiveId] = useState<string | null>(null)
  const [, startFetch] = useTransition()
  const searchRef = useRef<HTMLInputElement>(null)
  const tableRef = useRef<HTMLTableElement>(null)
  const requestRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function fetchRows(text: string) {
    const request = ++requestRef.current
    startFetch(async () => {
      try {
        const rows = await searchPartnersForStock(text, kind)
        if (request !== requestRef.current) return
        setResult({ status: "ready", searched: text, rows })
      } catch (error) {
        unstable_rethrow(error)
        if (request !== requestRef.current) return
        console.error(error)
        setResult({ status: "error" })
      }
    })
  }

  useEffect(() => {
    const requests = requestRef
    const timer = timerRef
    fetchRows("")
    return () => {
      requests.current++
      if (timer.current) clearTimeout(timer.current)
    }
    // Once when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function search(text: string) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
    setResult({ status: "loading" })
    fetchRows(text)
  }

  const rows = result.status === "ready" ? result.rows : []

  function pick(row: StockPartnerOption | undefined) {
    if (!row) return
    onPick(row)
    onClose()
  }

  function focusRow(element: Element | null | undefined) {
    if (element instanceof HTMLElement) element.focus()
  }

  const focusId =
    activeId && rows.some((row) => row.id === activeId)
      ? activeId
      : (rows[0]?.id ?? null)

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={title ?? (kind === "supplier" ? "매입처 선택" : "거래처 선택")}
      size="md"
      initialFocus={searchRef}
      description={
        kind === "supplier"
          ? "사용 중인 매입처와 매출·매입 거래처가 보입니다. 줄을 두 번 누르거나(또는 Enter) 고른 뒤 [선택]을 누르세요."
          : "사용 중인 거래처가 모두 보입니다(반품은 매입처를 고르세요). 줄을 두 번 누르거나(또는 Enter) 고른 뒤 [선택]을 누르세요."
      }
      footer={
        <>
          <ActionButton variant="secondary" size="lg" onClick={onClose}>
            취소
          </ActionButton>
          <ActionButton
            size="lg"
            disabled={!rows.some((row) => row.id === activeId)}
            onClick={() => pick(rows.find((row) => row.id === activeId))}
          >
            선택
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <div className="relative">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={searchRef}
            type="search"
            aria-label="거래처 검색"
            placeholder="거래처코드, 거래처명으로 찾기"
            className="h-8 rounded-sm pl-8"
            value={query}
            maxLength={100}
            autoComplete="off"
            onChange={(event) => {
              const text = event.target.value
              setQuery(text)
              if (timerRef.current) clearTimeout(timerRef.current)
              timerRef.current = setTimeout(
                () => search(text.trim()),
                SEARCH_DELAY
              )
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                if (event.nativeEvent.isComposing || event.keyCode === 229) {
                  return
                }
                if (
                  result.status === "ready" &&
                  result.searched === query.trim() &&
                  result.rows.length === 1
                ) {
                  pick(result.rows[0])
                  return
                }
                search(query.trim())
              } else if (event.key === "ArrowDown") {
                event.preventDefault()
                focusRow(tableRef.current?.querySelector("tbody tr[tabindex]"))
              }
            }}
          />
        </div>
        <DataGrid
          ref={tableRef}
          aria-label="거래처 목록"
          aria-busy={result.status === "loading"}
          containerClassName="max-h-[min(22rem,45dvh)]"
        >
          <DataGridHeader>
            <tr>
              <DataGridHead className="w-28">거래처코드</DataGridHead>
              <DataGridHead>거래처명</DataGridHead>
              <DataGridHead className="w-24">구분</DataGridHead>
            </tr>
          </DataGridHeader>
          <DataGridBody>
            {result.status === "error" ? (
              <DataGridEmpty colSpan={3}>
                <div role="alert" className="flex flex-col items-center gap-2">
                  <p>거래처를 불러오지 못했습니다.</p>
                  <ActionButton
                    variant="neutral"
                    onClick={() => search(query.trim())}
                  >
                    다시 시도
                  </ActionButton>
                </div>
              </DataGridEmpty>
            ) : result.status === "loading" ? (
              <DataGridEmpty colSpan={3}>
                <span className="inline-flex items-center gap-1.5">
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="size-4 animate-spin"
                  />
                  거래처를 불러오는 중…
                </span>
              </DataGridEmpty>
            ) : rows.length === 0 ? (
              <DataGridEmpty colSpan={3}>
                {result.searched
                  ? `‘${result.searched}’이(가) 들어간 거래처가 없습니다.`
                  : kind === "supplier"
                    ? "사용 중인 매입처가 없습니다. 거래처관리에서 매입처를 먼저 등록해 주세요."
                    : "사용 중인 거래처가 없습니다."}
              </DataGridEmpty>
            ) : (
              rows.map((row) => (
                <DataGridRow
                  key={row.id}
                  selected={row.id === activeId}
                  tabIndex={row.id === focusId ? 0 : -1}
                  onClick={() => setActiveId(row.id)}
                  onFocus={(event) => {
                    if (event.target === event.currentTarget) {
                      setActiveId(row.id)
                    }
                  }}
                  onDoubleClick={() => pick(row)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return
                    if (event.key === "ArrowDown") {
                      event.preventDefault()
                      focusRow(event.currentTarget.nextElementSibling)
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault()
                      const previous =
                        event.currentTarget.previousElementSibling
                      if (previous) focusRow(previous)
                      else searchRef.current?.focus()
                    } else if (event.key === "Enter") {
                      event.preventDefault()
                      pick(row)
                    }
                  }}
                  className="cursor-default outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                >
                  <DataGridCell align="center" className="tabular-nums">
                    {row.code}
                  </DataGridCell>
                  <DataGridCell className="max-w-72 truncate" title={row.name}>
                    {row.name}
                  </DataGridCell>
                  <DataGridCell align="center">
                    {PARTNER_TYPE_LABELS[row.partnerType]}
                  </DataGridCell>
                </DataGridRow>
              ))
            )}
          </DataGridBody>
        </DataGrid>
        {result.status === "ready" && rows.length >= 100 && (
          <p className="text-xs text-muted-foreground">
            앞의 100곳만 보입니다. 코드나 이름을 더 입력해 좁혀 주세요.
          </p>
        )}
      </div>
    </ErpDialog>
  )
}

/**
 * The 거래처 box of a 전표 header: shows "코드 이름" (or the placeholder),
 * opens the 거래처 선택 dialog, × clears it.
 *
 * @example
 * <StockPartnerField id="receipt-partner" kind="supplier" value={partner}
 *   onChange={(next) => { setPartner(next); form.setValue("partnerId", next?.id ?? "") }} />
 */
export function StockPartnerField({
  id,
  kind,
  value,
  onChange,
  placeholder,
  invalid = false,
  disabled = false,
  className,
  "aria-describedby": describedBy,
}: {
  id?: string
  kind: StockPartnerKind
  value: StockPartnerOption | null
  onChange: (partner: StockPartnerOption | null) => void
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  className?: string
  "aria-describedby"?: string
}) {
  const [open, setOpen] = useState(false)
  const label = value
    ? `${value.code} ${value.name}`
    : (placeholder ?? "선택 안 함")
  return (
    <>
      <span
        className={cn("flex w-full max-w-sm min-w-0 items-center", className)}
      >
        <button
          id={id}
          type="button"
          aria-haspopup="dialog"
          data-invalid={invalid || undefined}
          aria-describedby={describedBy}
          disabled={disabled}
          onClick={() => setOpen(true)}
          className="flex h-8 w-full min-w-0 items-center justify-between gap-1 rounded-sm border border-input bg-background pr-1.5 pl-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[invalid=true]:border-destructive"
        >
          <span
            className={cn("truncate", !value && "text-muted-foreground")}
            title={value ? label : undefined}
          >
            {label}
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
        </button>
        {value && !disabled && (
          <button
            type="button"
            aria-label="거래처 지우기"
            onClick={() => onChange(null)}
            className="ml-0.5 flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon aria-hidden="true" className="size-4" />
          </button>
        )}
      </span>
      {open && (
        <StockPartnerPickerDialog
          kind={kind}
          onPick={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
