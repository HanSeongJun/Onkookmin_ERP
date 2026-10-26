"use client"

import { LoaderCircleIcon, PackageSearchIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useOptimistic, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import {
  ActionBar,
  ActionButton,
  actionButtonClassName,
} from "@/components/erp/action-bar"
import { SearchField, SearchPanel } from "@/components/erp/search-panel"
import { downloadInventoryCsv } from "@/components/inventory/download-csv"
import { StockProductPickerDialog } from "@/components/inventory/stock-product-picker-dialog"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { formatNumber } from "@/lib/format"
import type { StockLedger, StockWarehouseNode } from "@/lib/inventory/queries"
import {
  buildLotStockHref,
  buildStockLedgerExportHref,
  buildStockLedgerHref,
  buildStockReportHref,
  defaultLotStockParams,
  defaultStockReportParams,
  type StockLedgerParams,
} from "@/lib/inventory/schema"
import { storageTypeLabel, taxTypeLabel } from "@/lib/products/constants"

import { placeLabel } from "../../_components/place-filter"
import {
  PeriodInputs,
  PlaceSelects,
  readPeriod,
} from "../../_components/search-controls"
import { LedgerGrid } from "./ledger-grid"

/** Id of the search <form>; the 조회 button submits it with form="…". */
const SEARCH_FORM_ID = "stock-ledger-search"

/**
 * The 상품별 거래수불 screen: pick a 기준상품 and a 조회기간 (optionally a
 * 창고 / 구역 / 위치), then every 입고·출고·폐기·이동·실사조정·취소 line of it
 * in date order with the running 잔량, starting from the 이월.
 *
 * Buttons: 조회 (F4), 상품 선택 (F2), 엑셀 (Ctrl+F9); links to the
 * product's 재고처별 재고 and 상품별 재고현황. Everything is in the URL
 * (?product=…&from=…&to=…&warehouse=…).
 */
export function LedgerScreen({
  params,
  ledger,
  places,
  today,
  productMissing,
}: {
  params: StockLedgerParams
  /** Null when no product is chosen (or it was not found). */
  ledger: StockLedger | null
  places: StockWarehouseNode[]
  /** Today in Korea ("YYYY-MM-DD"). */
  today: string
  /** The URL names a product that does not exist. */
  productMissing: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [shown, setShown] = useOptimistic(params)
  const searchFormRef = useRef<HTMLFormElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  function openLedger(next: StockLedgerParams) {
    const href = buildStockLedgerHref(next)
    startTransition(() => {
      setShown(next)
      if (href === buildStockLedgerHref(params)) {
        router.refresh()
      } else {
        router.push(href)
      }
    })
  }

  /** Applies changes with the 조회기간 typed in the form. */
  function applyChanges(changes: Partial<StockLedgerParams>) {
    const period = readPeriod(searchFormRef.current, {
      from: shown.from,
      to: shown.to,
    })
    if ("message" in period) {
      toast.error(period.message)
      return
    }
    openLedger({ ...shown, ...period, ...changes })
  }

  async function downloadExcel() {
    if (isExporting) return
    if (!ledger) {
      toast.info("상품을 먼저 골라 주세요.")
      return
    }
    setIsExporting(true)
    try {
      await downloadInventoryCsv(
        buildStockLedgerExportHref(params),
        "상품별거래수불.csv"
      )
    } finally {
      setIsExporting(false)
    }
  }

  // F4 = 조회, F2 = 상품 선택, Ctrl+F9 = 엑셀. Off while the picker is open.
  useHotkeys(
    {
      F2: () => setPickerOpen(true),
      F4: () => searchFormRef.current?.requestSubmit(),
      "Ctrl+F9": () => void downloadExcel(),
    },
    { enabled: !pickerOpen }
  )

  const product = ledger?.product ?? null

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <ActionBar
        end={
          <ActionButton
            keyHint="Ctrl+F9"
            disabled={isExporting || !ledger}
            onClick={() => void downloadExcel()}
          >
            {isExporting && (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            )}
            엑셀
          </ActionButton>
        }
      >
        <ActionButton type="submit" form={SEARCH_FORM_ID} keyHint="F4">
          조회
        </ActionButton>
        <ActionButton
          variant="secondary"
          keyHint="F2"
          aria-haspopup="dialog"
          onClick={() => setPickerOpen(true)}
        >
          상품 선택
        </ActionButton>
        {product && (
          <Link
            href={buildLotStockHref({
              ...defaultLotStockParams,
              productId: product.id,
            })}
            className={actionButtonClassName({ variant: "neutral" })}
          >
            이 상품의 로트별 재고
          </Link>
        )}
        <Link
          href={buildStockReportHref({
            ...defaultStockReportParams(),
            from: params.from,
            to: params.to,
          })}
          className={actionButtonClassName({ variant: "neutral" })}
        >
          상품별 재고현황
        </Link>
      </ActionBar>

      <form
        ref={searchFormRef}
        id={SEARCH_FORM_ID}
        role="search"
        aria-label="거래수불 조회 조건"
        onSubmit={(event) => {
          event.preventDefault()
          applyChanges({})
        }}
      >
        <SearchPanel className="2xl:grid-cols-3">
          <SearchField label="상품" className="md:col-span-2 xl:col-span-1">
            <span className="min-w-0 truncate text-[13px]">
              {product ? (
                <>
                  <span className="mr-1 text-muted-foreground tabular-nums">
                    {product.code}
                  </span>
                  <span className="font-bold">{product.name}</span>
                </>
              ) : (
                <span className="text-muted-foreground">
                  상품을 골라 주세요
                </span>
              )}
            </span>
            <ActionButton
              size="sm"
              variant="secondary"
              aria-haspopup="dialog"
              onClick={() => setPickerOpen(true)}
            >
              선택
            </ActionButton>
          </SearchField>
          <SearchField label="조회기간" span={2}>
            <PeriodInputs
              key={`${shown.from}~${shown.to}`}
              idPrefix="stock-ledger"
              from={shown.from}
              to={shown.to}
              today={today}
              onPick={(from, to) => openLedger({ ...shown, from, to })}
            />
          </SearchField>
          <SearchField label="창고·구역·위치" span="full">
            <PlaceSelects
              idPrefix="stock-ledger"
              places={places}
              withLocation
              value={{
                warehouseId: shown.warehouseId,
                zoneId: shown.zoneId,
                locationId: shown.locationId,
              }}
              onChange={(place) => applyChanges(place)}
            />
          </SearchField>
        </SearchPanel>
      </form>

      <div
        aria-busy={isPending}
        data-pending={isPending}
        className="flex min-w-0 flex-col gap-2.5 transition-opacity data-[pending=true]:opacity-60"
      >
        {ledger ? (
          <>
            <LedgerSummary
              ledger={ledger}
              placeText={placeLabel(places, params)}
              isPending={isPending}
            />
            {ledger.product.productType === "bundle" ? (
              <p className="border border-input bg-label px-3 py-2 text-[13px]">
                묶음상품은 재고가 따로 없습니다. 입고·출고할 때 구성
                기준상품으로 나뉘어 기록되니, 구성 기준상품을 골라 보세요.
              </p>
            ) : (
              <>
                {ledger.laterLines && (
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border border-dashed border-brand bg-brand-tint px-3 py-2 text-[13px] text-brand-active">
                    <span>
                      조회기간 뒤에 오늘 이후 날짜의{" "}
                      <strong className="font-bold">
                        예정 수불 {formatNumber(ledger.laterLines.count, 0)}줄
                      </strong>
                      이 있습니다 (마지막 {ledger.laterLines.lastDate}).
                      재고처별 재고현황의 수량에는 이미 반영되어 있습니다.
                    </span>
                    <ActionButton
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        openLedger({
                          ...shown,
                          to: ledger.laterLines?.lastDate ?? shown.to,
                        })
                      }
                    >
                      예정까지 보기
                    </ActionButton>
                  </p>
                )}
                <LedgerGrid ledger={ledger} />
              </>
            )}
          </>
        ) : (
          <NoProduct
            productMissing={productMissing}
            onPick={() => setPickerOpen(true)}
          />
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        이월은 조회 시작일 전날까지의 재고입니다. 같은 날의 줄은 저장한
        순서대로이고, 잔량은 그 줄까지의 재고입니다. 이동은 보내는 위치의 출고와
        받는 위치의 입고로 두 줄이 생기며(창고·위치를 고르지 않으면 합이 0),
        취소 전표는 원래 전표의 반대 줄(예: 출고취소 = 입고)로 보입니다.
        전표번호를 누르면 그 전표가 열립니다. 위의 입고·출고·조정·폐기·이동은
        상품별 재고현황과 같은 기준이라(취소는 원래 구분에서 빠짐), 표의
        입고·출고 칸(들어오고 나간 줄 전부)을 더한 값과 다를 수 있습니다. 오늘
        이후 날짜의 줄(예: 내일 새벽배송 출고)에는 ‘예정’이 붙습니다. 조회기간을
        [내일까지]처럼 오늘 이후까지 넓히면 보입니다.
      </p>

      {pickerOpen && (
        <StockProductPickerDialog
          includeBundles={false}
          includeInactiveWithStock
          multiple={false}
          title="기준상품 선택"
          onClose={() => setPickerOpen(false)}
          onPick={([picked]) => {
            if (picked) applyChanges({ productId: picked.id })
          }}
        />
      )}
    </div>
  )
}

/**
 * The product's details and the period's figures — the same columns and
 * numbers as its row on 상품별 재고현황 (이월, 입고, 출고, 조정, 폐기,
 * 이동, 기말), not the sums of the line table's 입고/출고 columns (those
 * hold every + / − line, 폐기·이동·조정 included).
 */
function LedgerSummary({
  ledger,
  placeText,
  isPending,
}: {
  ledger: StockLedger
  placeText: string
  isPending: boolean
}) {
  const { product } = ledger
  const { summary } = ledger
  const figures = [
    { label: "이월재고", value: ledger.openingQty },
    { label: "입고", value: summary.inboundQty },
    { label: "출고", value: summary.issueQty },
    { label: "조정", value: summary.adjustNetQty, signed: true },
    { label: "폐기", value: summary.disposalQty },
    { label: "이동", value: summary.transferNetQty, signed: true },
    { label: "기말재고", value: ledger.closingQty, strong: true },
  ]
  return (
    <section
      aria-label="상품과 기간 합계"
      className="flex flex-col gap-2 border border-input px-3 py-2 lg:flex-row lg:items-center lg:justify-between"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="text-muted-foreground tabular-nums">
            {product.code}
          </span>
          <span className="font-bold">{product.name}</span>
          {!product.isActive && (
            <span className="rounded-sm bg-label px-1 text-xs font-bold text-muted-foreground">
              사용중지
            </span>
          )}
          {isPending && (
            <LoaderCircleIcon
              className="size-4 animate-spin self-center text-muted-foreground"
              aria-label="불러오는 중"
            />
          )}
        </p>
        <p className="text-[13px] text-muted-foreground">
          {[
            product.spec,
            `단위 ${product.unit}`,
            product.storageType ? storageTypeLabel(product.storageType) : null,
            product.taxType ? taxTypeLabel(product.taxType) : null,
            `${ledger.dateFrom} ~ ${ledger.dateTo}`,
            placeText,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <dl className="grid shrink-0 grid-cols-2 gap-px border border-input bg-grid-line sm:grid-cols-4 xl:grid-cols-7">
        {figures.map((figure) => (
          <div
            key={figure.label}
            className="flex flex-col items-end bg-background px-3 py-1"
          >
            <dt className="text-xs text-muted-foreground">{figure.label}</dt>
            <dd
              className={
                figure.strong
                  ? "text-base font-bold text-brand tabular-nums"
                  : "text-base font-bold tabular-nums"
              }
            >
              {figure.signed && figure.value > 0 ? "+" : ""}
              {formatNumber(figure.value, 3)}
              <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                {product.unit}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Shown before a product is chosen (or when the URL's product is gone). */
function NoProduct({
  productMissing,
  onPick,
}: {
  productMissing: boolean
  onPick: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-2 border border-input px-4 py-10 text-center text-[13px] text-muted-foreground">
      <PackageSearchIcon aria-hidden="true" className="size-8" />
      <p className="font-bold text-foreground">
        {productMissing
          ? "상품을 찾을 수 없습니다."
          : "거래수불을 볼 기준상품을 골라 주세요."}
      </p>
      <p>
        상품별 재고현황이나 재고처별 재고현황에서 상품명을 눌러도 이 화면이
        열립니다.
      </p>
      <ActionButton keyHint="F2" onClick={onPick}>
        상품 선택
      </ActionButton>
    </div>
  )
}
