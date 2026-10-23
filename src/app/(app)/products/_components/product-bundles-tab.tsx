"use client"

import { PlusIcon } from "lucide-react"

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
import { FormSection } from "@/components/erp/form-table"
import { EMPTY_VALUE, formatNumber } from "@/lib/format"
import type { ContainingBundle } from "@/lib/products/queries"
import { buildProductModalHref } from "@/lib/products/schema"
import { cn } from "@/lib/utils"

/** Number of columns (for the full-width empty row). */
const COLUMN_COUNT = 9

/**
 * 묶음상품 tab of a 기준상품's 상품 수정 modal: every 묶음상품 that contains
 * this 기준상품 (with how many of it), and [묶음상품 추가], which opens a
 * new 묶음상품 with this 기준상품 already in its 구성상품.
 *
 * A click on a 상품명 (or a double-click / Enter on a row) opens that
 * 묶음상품; closing it comes back here. 판매단가 is the 묶음상품's own
 * 기본 판매가, as 부가세 별도 and 부가세 포함 (like the product list).
 */
export function ProductBundlesTab({
  baseName,
  baseUnit,
  baseIsActive,
  bundles,
  onOpenBundle,
  onAddBundle,
}: {
  /** The 기준상품's name and unit (for the texts). */
  baseName: string
  baseUnit: string
  /** The saved 사용 여부 of the 기준상품. */
  baseIsActive: boolean
  bundles: ContainingBundle[]
  onOpenBundle: (bundleId: string) => void
  onAddBundle: () => void
}) {
  const activeCount = bundles.filter((bundle) => bundle.isActive).length

  function handleRowKeyDown(
    event: React.KeyboardEvent<HTMLTableRowElement>,
    bundle: ContainingBundle
  ) {
    if (event.target !== event.currentTarget) return
    if (event.key === "Enter") {
      event.preventDefault()
      onOpenBundle(bundle.id)
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const sibling =
        event.key === "ArrowDown"
          ? event.currentTarget.nextElementSibling
          : event.currentTarget.previousElementSibling
      if (sibling instanceof HTMLElement) sibling.focus()
    }
  }

  return (
    <FormSection
      title="이 기준상품이 들어간 묶음상품"
      description={
        bundles.length > 0
          ? `${formatNumber(bundles.length, 0)}개 (사용 ${formatNumber(activeCount, 0)}개). 상품명을 누르면 그 묶음상품이 열립니다.`
          : undefined
      }
      actions={
        <ActionButton
          size="sm"
          disabled={!baseIsActive}
          title={
            baseIsActive
              ? "이 기준상품이 들어간 새 묶음상품을 등록합니다."
              : "사용중지된 기준상품으로는 묶음상품을 만들 수 없습니다."
          }
          onClick={onAddBundle}
        >
          <PlusIcon aria-hidden="true" />
          묶음상품 추가
        </ActionButton>
      }
    >
      {!baseIsActive && (
        <p className="text-xs text-muted-foreground">
          이 기준상품은 사용중지 상태라 새 묶음상품에 넣을 수 없습니다. 먼저
          사용으로 저장해 주세요.
        </p>
      )}
      <DataGrid
        aria-label="이 기준상품이 들어간 묶음상품"
        containerClassName="max-h-[min(28rem,55dvh)]"
        className={bundles.length > 0 ? "min-w-[56rem]" : undefined}
      >
        <DataGridHeader>
          <tr>
            <DataGridHead rowSpan={2} className="w-32">
              상품코드
            </DataGridHead>
            <DataGridHead rowSpan={2} className="min-w-56">
              상품명
            </DataGridHead>
            <DataGridHead rowSpan={2} className="w-24">
              규격
            </DataGridHead>
            <DataGridHead rowSpan={2} className="w-14">
              단위
            </DataGridHead>
            <DataGridHead rowSpan={2} className="w-28">
              <span className="flex flex-col items-center leading-tight">
                수량
                <span className="text-[11px] font-normal">이 기준상품</span>
              </span>
            </DataGridHead>
            <DataGridHead rowSpan={2} className="w-20">
              구성
            </DataGridHead>
            <DataGridHeadGroup colSpan={2}>판매단가</DataGridHeadGroup>
            <DataGridHead rowSpan={2} className="w-20">
              사용여부
            </DataGridHead>
          </tr>
          <tr>
            <DataGridHead subHead className="w-24">
              부가세 별도
            </DataGridHead>
            <DataGridHead subHead className="w-24">
              부가세 포함
            </DataGridHead>
          </tr>
        </DataGridHeader>
        <DataGridBody>
          {bundles.length === 0 && (
            <DataGridEmpty colSpan={COLUMN_COUNT}>
              <div className="flex flex-col items-center gap-1">
                <p className="font-bold text-foreground">
                  이 기준상품이 들어간 묶음상품이 없습니다.
                </p>
                <p>
                  예: ‘[묶음] {baseName} X 6개입’처럼 여러 개를 묶어 파는 상품은
                  [묶음상품 추가]로 만듭니다.
                </p>
              </div>
            </DataGridEmpty>
          )}
          {bundles.map((bundle, index) => (
            <DataGridRow
              key={bundle.id}
              tabIndex={index === 0 ? 0 : -1}
              onDoubleClick={() => onOpenBundle(bundle.id)}
              onKeyDown={(event) => handleRowKeyDown(event, bundle)}
              className={cn(
                "cursor-default outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
                !bundle.isActive && "text-muted-foreground"
              )}
            >
              <DataGridCell align="center" className="tabular-nums">
                {bundle.code}
              </DataGridCell>
              <DataGridCell className="max-w-80 truncate" title={bundle.name}>
                <a
                  href={buildProductModalHref("", {
                    mode: "edit",
                    id: bundle.id,
                  })}
                  onClick={(event) => {
                    // Ctrl/⌘/Shift-click: the browser opens a new tab/window.
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    ) {
                      return
                    }
                    event.preventDefault()
                    onOpenBundle(bundle.id)
                  }}
                  className="rounded-sm underline-offset-4 outline-none hover:text-brand hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {bundle.name}
                </a>
              </DataGridCell>
              <DataGridCell
                align="center"
                className="max-w-32 truncate"
                title={bundle.spec ?? undefined}
              >
                {bundle.spec ?? EMPTY_VALUE}
              </DataGridCell>
              <DataGridCell align="center">{bundle.unit}</DataGridCell>
              <DataGridCell numeric>
                {formatNumber(bundle.quantity, 0)} {baseUnit}
              </DataGridCell>
              <DataGridCell align="center">
                {bundle.componentCount > 1
                  ? `혼합 ${formatNumber(bundle.componentCount, 0)}종`
                  : `×${formatNumber(bundle.quantity, 0)}`}
              </DataGridCell>
              <DataGridCell
                numeric
                title={
                  bundle.salePriceInclVat !== null &&
                  bundle.salePriceExclVat === null
                    ? "혼합 묶음상품은 구성상품(기준상품)의 기본 판매가 비율로 부가세를 나눕니다. 기본 판매가가 비어 있는 구성상품이 있거나 모두 0원이라 계산할 수 없습니다."
                    : undefined
                }
              >
                {formatNumber(bundle.salePriceExclVat, 0)}
              </DataGridCell>
              <DataGridCell numeric>
                {formatNumber(bundle.salePriceInclVat, 0)}
              </DataGridCell>
              <DataGridCell
                align="center"
                className={cn(!bundle.isActive && "font-bold text-destructive")}
              >
                {bundle.isActive ? "사용" : "사용중지"}
              </DataGridCell>
            </DataGridRow>
          ))}
        </DataGridBody>
      </DataGrid>
      <p className="text-xs text-muted-foreground">
        이 기준상품을 사용중지하면 위의 사용 중인 묶음상품도 함께
        사용중지됩니다. 기준상품을 다시 사용으로 바꿔도 묶음상품은 자동으로
        사용되지 않습니다.
      </p>
    </FormSection>
  )
}
