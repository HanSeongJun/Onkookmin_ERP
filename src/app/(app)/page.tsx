import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowDownToLineIcon,
  ArrowUpFromLineIcon,
  CalendarClockIcon,
  PackageMinusIcon,
  type LucideIcon,
} from "lucide-react"

import { actionButtonClassName } from "@/components/erp/action-bar"
import { PageTitle } from "@/components/erp/page-title"

export const metadata: Metadata = {
  title: "대시보드",
}

type SummaryBox = {
  title: string
  description: string
  icon: LucideIcon
}

// Summary boxes. They will show real numbers once 재고·입고·출고 are built.
const summaryBoxes: SummaryBox[] = [
  {
    title: "기한 임박 재고",
    description: "유통기한·소비기한이 얼마 남지 않은 재고",
    icon: CalendarClockIcon,
  },
  {
    title: "재고 부족 상품",
    description: "적정 재고보다 적게 남은 상품",
    icon: PackageMinusIcon,
  },
  {
    title: "오늘 입고",
    description: "오늘 들어온 입고 건수",
    icon: ArrowDownToLineIcon,
  },
  {
    title: "오늘 출고",
    description: "오늘 나간 출고 건수",
    icon: ArrowUpFromLineIcon,
  },
]

export default function DashboardPage() {
  return (
    <>
      <PageTitle
        title="대시보드"
        description="재고와 입고·출고 현황을 한눈에 확인하는 화면입니다."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryBoxes.map((box) => {
          const Icon = box.icon
          return (
            <section
              key={box.title}
              className="flex flex-col border border-input"
            >
              <div className="flex items-center gap-2 bg-brand px-3 py-2 text-brand-foreground">
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                <h2 className="font-bold">{box.title}</h2>
              </div>
              <div className="flex flex-1 flex-col items-start gap-3 px-3 py-3">
                <p className="text-[13px] text-muted-foreground">
                  {box.description}
                </p>
                <span className="mt-auto rounded-sm bg-label px-2 py-0.5 text-xs font-bold text-muted-foreground">
                  준비 중
                </span>
              </div>
            </section>
          )
        })}
      </div>

      <section className="border border-input" aria-labelledby="welcome-title">
        <h2
          id="welcome-title"
          className="border-b border-input bg-label px-4 py-2.5 font-bold"
        >
          식자재 ERP에 오신 것을 환영합니다
        </h2>
        <div className="flex flex-col gap-3 px-4 py-4">
          <p className="text-muted-foreground">
            지금은 왼쪽 전체메뉴의 상품 › 상품관리에서 상품을, 거래처 ›
            거래처관리에서 매출처·매입처를, 기초정보 › 직원관리에서 직원을
            등록할 수 있습니다. 재고 관리, 구매·입고, 판매·출고, 정산은 차례로
            열릴 예정이며, 위 현황도 해당 기능이 열리면 실제 숫자를 보여
            드립니다.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Link href="/products" className={actionButtonClassName()}>
              상품관리 바로가기
            </Link>
            <Link
              href="/products/categories"
              className={actionButtonClassName({ variant: "neutral" })}
            >
              상품분류설정 바로가기
            </Link>
            <Link href="/partners" className={actionButtonClassName()}>
              거래처관리 바로가기
            </Link>
            <Link
              href="/employees"
              className={actionButtonClassName({ variant: "neutral" })}
            >
              직원관리 바로가기
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
