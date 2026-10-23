import type { Metadata } from "next"
import Link from "next/link"

import { actionButtonClassName } from "@/components/erp/action-bar"
import { APP_NAME } from "@/config/navigation"

export const metadata: Metadata = {
  title: "페이지를 찾을 수 없습니다",
}

/** Shown for any address that doesn't exist (404). */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md border border-input bg-background text-center shadow-sm">
        <p className="bg-brand px-6 py-3 text-left text-lg font-bold text-brand-foreground">
          {APP_NAME}
        </p>
        <div className="flex flex-col items-center gap-2 px-6 py-8">
          <p className="text-sm font-bold text-brand">404</p>
          <h1 className="text-2xl font-bold">페이지를 찾을 수 없습니다</h1>
          <p className="text-muted-foreground">
            주소가 잘못되었거나 더 이상 사용하지 않는 페이지입니다.
          </p>
          <Link
            href="/"
            className={actionButtonClassName({ size: "lg", className: "mt-4" })}
          >
            대시보드로 돌아가기
          </Link>
        </div>
      </div>
    </main>
  )
}
