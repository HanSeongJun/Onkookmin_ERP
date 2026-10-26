import type { Metadata } from "next"
import Link from "next/link"
import { unstable_rethrow } from "next/navigation"
import { Suspense } from "react"
import {
  CalendarClockIcon,
  CalendarX2Icon,
  ChevronRightIcon,
  PackageIcon,
  ThermometerIcon,
  type LucideIcon,
} from "lucide-react"

import { actionButtonClassName } from "@/components/erp/action-bar"
import { InventoryNotReady } from "@/components/inventory/inventory-notices"
import { ScheduledBadge } from "@/components/inventory/scheduled-badge"
import {
  stockDocumentHref,
  stockDocumentKindLabel,
  stockDocumentProductsLabel,
} from "@/components/inventory/document-screens"
import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridEmpty,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { PageTitle } from "@/components/erp/page-title"
import { Skeleton } from "@/components/ui/skeleton"
import { requireUser } from "@/lib/auth/user"
import { EMPTY_VALUE, formatKRW, formatNumber } from "@/lib/format"
import {
  getStockDashboard,
  INVENTORY_NOT_READY_MESSAGE,
  InventoryNotReadyError,
  type StockDashboard,
} from "@/lib/inventory/queries"
import { shiftDate } from "@/lib/inventory/constants"
import {
  buildLotStockHref,
  buildStockDocumentListHref,
  buildStockReportHref,
  defaultLotStockParams,
  defaultStockDocumentListParams,
  defaultStockReportParams,
  STOCK_DOCUMENT_SCREENS,
} from "@/lib/inventory/schema"
import { cn } from "@/lib/utils"

export const metadata: Metadata = {
  title: "대시보드",
}

/**
 * "/": 대시보드. The 재고 cards (기한 경과, 기한 임박, 보관온도 불일치,
 * 전체 재고 — each opens the filtered 재고처별 재고현황 / 상품별
 * 재고현황), the latest 전표, and shortcuts.
 */
export default function DashboardPage() {
  return (
    <>
      <PageTitle
        title="대시보드"
        description="재고와 입고·출고 현황을 한눈에 확인하는 화면입니다."
      />

      {/* The numbers depend on the signed-in user, so they load at request
          time inside this boundary. */}
      <Suspense fallback={<StockDashboardSkeleton />}>
        <StockDashboardSection />
      </Suspense>

      <section className="border border-input" aria-labelledby="welcome-title">
        <h2
          id="welcome-title"
          className="border-b border-input bg-label px-4 py-2.5 font-bold"
        >
          바로가기
        </h2>
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-muted-foreground">
            왼쪽 전체메뉴의 재고관리에서 입고·출고·폐기·이동·실사조정을
            등록하고, 상품별·재고처별 재고와 거래수불을 확인할 수 있습니다.
            처음이라면 창고·로케이션 설정에서 창고·구역·선반을 만든 뒤
            자료일괄등록 › 기초재고 일괄등록으로 지금 재고를 넣어 주세요.
            구매·입고(발주), 판매·출고(주문), 정산은 차례로 열릴 예정입니다.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Link href="/inventory" className={actionButtonClassName()}>
              상품별 재고현황
            </Link>
            <Link
              href={STOCK_DOCUMENT_SCREENS.receipt.path}
              className={actionButtonClassName()}
            >
              입고 등록
            </Link>
            <Link
              href={STOCK_DOCUMENT_SCREENS.issue.path}
              className={actionButtonClassName()}
            >
              출고 등록
            </Link>
            <Link
              href="/products"
              className={actionButtonClassName({ variant: "neutral" })}
            >
              상품관리
            </Link>
            <Link
              href="/partners"
              className={actionButtonClassName({ variant: "neutral" })}
            >
              거래처관리
            </Link>
            <Link
              href="/inventory/settings"
              className={actionButtonClassName({ variant: "neutral" })}
            >
              창고·로케이션 설정
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}

async function StockDashboardSection() {
  await requireUser()

  let dashboard: StockDashboard
  try {
    dashboard = await getStockDashboard(8)
  } catch (error) {
    unstable_rethrow(error)
    if (error instanceof InventoryNotReadyError) {
      return <InventoryNotReady message={INVENTORY_NOT_READY_MESSAGE} />
    }
    throw error
  }

  const { expired, imminent, mismatch, stock } = dashboard
  const lotsHref = (changes: Partial<typeof defaultLotStockParams>) =>
    buildLotStockHref({ ...defaultLotStockParams, ...changes })

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StockCard
          title="기한 경과 재고"
          icon={CalendarX2Icon}
          href={lotsHref({ expiry: "expired" })}
          tone={expired.rowCount > 0 ? "danger" : "calm"}
          figure={
            expired.rowCount > 0 ? formatNumber(expired.lotCount, 0) : "없음"
          }
          figureUnit={expired.rowCount > 0 ? "개 로트" : undefined}
          lines={
            expired.rowCount > 0
              ? [
                  `상품 ${formatNumber(expired.productCount, 0)}개 · 위치 ${formatNumber(expired.rowCount, 0)}곳`,
                  `재고금액 ${formatKRW(expired.valueInclVat)} (부가세 포함)`,
                ]
              : ["소비기한·유통기한이 지난 재고가 없습니다."]
          }
          linkLabel="폐기할 재고 보기"
        />
        <StockCard
          title={`기한 임박 재고 (${formatNumber(dashboard.expiryWarningDays, 0)}일 이내)`}
          icon={CalendarClockIcon}
          href={lotsHref({ expiry: "imminent" })}
          tone={imminent.rowCount > 0 ? "warning" : "calm"}
          figure={
            imminent.rowCount > 0 ? formatNumber(imminent.lotCount, 0) : "없음"
          }
          figureUnit={imminent.rowCount > 0 ? "개 로트" : undefined}
          lines={
            imminent.rowCount > 0
              ? [
                  `상품 ${formatNumber(imminent.productCount, 0)}개 · 위치 ${formatNumber(imminent.rowCount, 0)}곳`,
                  `재고금액 ${formatKRW(imminent.valueInclVat)} (부가세 포함)`,
                ]
              : [
                  `기한이 ${formatNumber(dashboard.expiryWarningDays, 0)}일 안에 끝나는 재고가 없습니다.`,
                ]
          }
          linkLabel="먼저 출고할 재고 보기"
        />
        <StockCard
          title="보관온도 불일치"
          icon={ThermometerIcon}
          href={lotsHref({ mismatch: true })}
          tone={
            mismatch.tooWarmCount > 0
              ? "danger"
              : mismatch.rowCount > 0
                ? "warning"
                : "calm"
          }
          figure={
            mismatch.rowCount > 0 ? formatNumber(mismatch.rowCount, 0) : "없음"
          }
          figureUnit={mismatch.rowCount > 0 ? "건" : undefined}
          lines={
            mismatch.rowCount > 0
              ? [
                  `그중 위험(구역이 더 따뜻함) ${formatNumber(mismatch.tooWarmCount, 0)}건`,
                  `상품 ${formatNumber(mismatch.productCount, 0)}개 · 로트 ${formatNumber(mismatch.lotCount, 0)}개`,
                ]
              : ["모든 재고가 알맞은 온도의 구역에 있습니다."]
          }
          linkLabel="옮길 재고 보기"
        />
        <StockCard
          title="전체 재고"
          icon={PackageIcon}
          href={buildStockReportHref({
            ...defaultStockReportParams(),
            withStock: true,
          })}
          tone="calm"
          figure={formatNumber(stock.productCount, 0)}
          figureUnit="개 상품"
          lines={[
            `로트 ${formatNumber(stock.lotCount, 0)}개 · 위치 ${formatNumber(stock.rowCount, 0)}곳`,
            `재고금액 ${formatKRW(stock.valueInclVat)} (부가세 별도 ${formatKRW(stock.valueExclVat)})`,
            ...(stock.costEstimated
              ? ["* 입고단가가 없는 재고는 기본 매입가로 계산했습니다."]
              : []),
            ...(stock.costMissing
              ? ["※ 단가를 모르는 재고는 0원으로 계산했습니다."]
              : []),
          ]}
          linkLabel="상품별 재고현황 보기"
        />
      </div>

      <RecentDocuments dashboard={dashboard} />
    </>
  )
}

type CardTone = "danger" | "warning" | "calm"

/** Colors of a card's figure and left edge (text ≥ 4.5:1 contrast). */
const TONE_CLASSES: Record<CardTone, { edge: string; figure: string }> = {
  danger: { edge: "border-l-destructive", figure: "text-destructive" },
  warning: { edge: "border-l-chart-4", figure: "text-foreground" },
  calm: { edge: "border-l-brand", figure: "text-brand" },
}

/** One 재고 card: brand title bar, a big figure, details, and its link. */
function StockCard({
  title,
  icon: Icon,
  href,
  tone,
  figure,
  figureUnit,
  lines,
  linkLabel,
}: {
  title: string
  icon: LucideIcon
  href: string
  tone: CardTone
  figure: string
  figureUnit?: string
  lines: string[]
  linkLabel: string
}) {
  const colors = TONE_CLASSES[tone]
  return (
    <section
      className={cn(
        "flex flex-col border border-l-4 border-input",
        colors.edge
      )}
    >
      <div className="flex items-center gap-2 bg-brand px-3 py-2 text-brand-foreground">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        <h2 className="font-bold">{title}</h2>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 px-3 py-3">
        <p className={cn("text-2xl font-bold tabular-nums", colors.figure)}>
          {figure}
          {figureUnit && (
            <span className="ml-1 text-sm text-muted-foreground">
              {figureUnit}
            </span>
          )}
        </p>
        {lines.map((line) => (
          <p key={line} className="text-[13px] text-muted-foreground">
            {line}
          </p>
        ))}
        <Link
          href={href}
          className="mt-auto inline-flex items-center gap-0.5 self-start pt-1 text-[13px] font-bold text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {linkLabel}
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </section>
  )
}

/** "예정 전표 N건 (출고 M건) · 10-24 ~ 10-25 — 재고에는 이미 반영". */
function ScheduledSummary({ dashboard }: { dashboard: StockDashboard }) {
  const scheduled = dashboard.scheduled
  return (
    <>
      <ScheduledBadge
        date={scheduled.lastDate}
        today={dashboard.today}
        title="오늘 이후 날짜의 예정 전표"
      />
      예정 전표 {formatNumber(scheduled.documentCount, 0)}건
      {scheduled.issueCount > 0 &&
        ` (출고 ${formatNumber(scheduled.issueCount, 0)}건)`}
      {scheduled.firstDate &&
        scheduled.lastDate &&
        ` · ${scheduled.firstDate.slice(5)}${scheduled.lastDate !== scheduled.firstDate ? ` ~ ${scheduled.lastDate.slice(5)}` : ""}`}
      {" — 재고에는 이미 반영"}
    </>
  )
}

/**
 * The latest 전표 (newest first); each opens on its 전표 screen. 전표 dated
 * after today carry "예정" (e.g. tomorrow's 새벽배송 출고), and a line above
 * counts every 예정 전표 with a link to the 예정 출고.
 */
function RecentDocuments({ dashboard }: { dashboard: StockDashboard }) {
  const documents = dashboard.recentDocuments
  const scheduled = dashboard.scheduled
  const scheduledIssuesHref = buildStockDocumentListHref("issue", {
    ...defaultStockDocumentListParams(),
    from: shiftDate(dashboard.today, 1),
  })
  return (
    <section
      aria-labelledby="recent-documents-title"
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 id="recent-documents-title" className="font-bold">
            최근 재고 전표
          </h2>
          {scheduled.documentCount > 0 &&
            // A link to the 예정 출고 only when there are some (other 예정
            // 전표, e.g. a 예정 입고, are listed on their own screens).
            (scheduled.issueCount > 0 ? (
              <Link
                href={scheduledIssuesHref}
                className="inline-flex items-center gap-1.5 rounded-sm text-[13px] text-brand-active underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ScheduledSummary dashboard={dashboard} />
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-brand-active">
                <ScheduledSummary dashboard={dashboard} />
              </span>
            ))}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px]">
          {Object.values(STOCK_DOCUMENT_SCREENS).map((screen) => (
            <Link
              key={screen.path}
              href={screen.path}
              className="text-brand underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {screen.title}
            </Link>
          ))}
        </div>
      </div>
      <DataGrid aria-label="최근 재고 전표" containerClassName="max-h-none">
        <DataGridHeader>
          <tr>
            <DataGridHead className="w-32">전표일자</DataGridHead>
            <DataGridHead className="w-40">전표번호</DataGridHead>
            <DataGridHead className="w-24">구분</DataGridHead>
            <DataGridHead className="min-w-32">거래처</DataGridHead>
            <DataGridHead className="min-w-48">상품</DataGridHead>
            <DataGridHead className="w-44">상태</DataGridHead>
          </tr>
        </DataGridHeader>
        <DataGridBody>
          {documents.length === 0 && (
            <DataGridEmpty colSpan={6}>
              아직 재고 전표가 없습니다. 입고 등록이나 기초재고 일괄등록으로
              시작해 보세요.
            </DataGridEmpty>
          )}
          {documents.map((document) => {
            const kind = stockDocumentKindLabel(document)
            const products = stockDocumentProductsLabel(document)
            const href = stockDocumentHref(document.effectiveType, document.id)
            return (
              <DataGridRow key={document.id}>
                <DataGridCell align="center" className="tabular-nums">
                  <span className="inline-flex items-center gap-1">
                    {document.docDate}
                    <ScheduledBadge
                      date={document.docDate}
                      today={dashboard.today}
                    />
                  </span>
                </DataGridCell>
                <DataGridCell align="center" className="tabular-nums">
                  {href ? (
                    <Link
                      href={href}
                      prefetch={false}
                      className="rounded-sm underline underline-offset-4 outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {document.docNo}
                    </Link>
                  ) : (
                    document.docNo
                  )}
                </DataGridCell>
                <DataGridCell
                  align="center"
                  className={cn(
                    document.docType === "reversal" && "text-destructive"
                  )}
                >
                  {kind}
                </DataGridCell>
                <DataGridCell className="max-w-48 truncate">
                  {document.partnerName ?? EMPTY_VALUE}
                </DataGridCell>
                <DataGridCell className="max-w-80 truncate" title={products}>
                  {products}
                </DataGridCell>
                <DataGridCell
                  align="center"
                  className={cn(
                    document.reversedByDocNo && "text-muted-foreground"
                  )}
                >
                  {document.reversedByDocNo
                    ? `취소됨 (${document.reversedByDocNo})`
                    : document.reversesDocNo
                      ? `${document.reversesDocNo} 취소`
                      : "정상"}
                </DataGridCell>
              </DataGridRow>
            )
          })}
        </DataGridBody>
      </DataGrid>
    </section>
  )
}

/** Placeholder of the 재고 cards and the 전표 list while they load. */
function StockDashboardSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only">재고 현황을 불러오는 중…</span>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex flex-col border border-input">
            <Skeleton className="h-9 rounded-none bg-brand-tint-strong" />
            <div className="flex flex-col gap-2 px-3 py-3">
              <Skeleton className="h-8 w-24 rounded-sm" />
              <Skeleton className="h-4 w-full max-w-48 rounded-sm" />
              <Skeleton className="h-4 w-full max-w-40 rounded-sm" />
            </div>
          </div>
        ))}
      </div>
      <Skeleton className="h-5 w-32 rounded-sm" />
      <div className="flex flex-col gap-px border border-input">
        <Skeleton className="h-9 rounded-none bg-brand-tint-strong" />
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-7 rounded-none" />
        ))}
      </div>
    </div>
  )
}
