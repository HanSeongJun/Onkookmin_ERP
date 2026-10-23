"use client" // Error screens must be Client Components.

import { ActionButton } from "@/components/erp/action-bar"
import { APP_NAME } from "@/config/navigation"

import { paperlogy } from "./fonts/paperlogy"
import "./globals.css"

/**
 * Last-resort error screen, used when even the root layout fails.
 * It replaces the whole page, so it has its own <html> and <body>.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown
  retry: () => void
}) {
  // `digest` is an ID that matches the error in the server logs.
  const digest =
    error instanceof Error &&
    "digest" in error &&
    typeof error.digest === "string"
      ? error.digest
      : null

  return (
    <html lang="ko" className={paperlogy.variable}>
      <body className="flex min-h-svh flex-col items-center justify-center bg-canvas p-4">
        <title>{`오류가 발생했습니다 | ${APP_NAME}`}</title>
        <main className="w-full max-w-md border border-input bg-background text-center shadow-sm">
          <p className="bg-brand px-6 py-3 text-left text-lg font-bold text-brand-foreground">
            {APP_NAME}
          </p>
          <div className="flex flex-col items-center gap-2 px-6 py-8">
            <h1 className="text-2xl font-bold">일시적인 오류가 발생했습니다</h1>
            <p className="text-muted-foreground">
              잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의해
              주세요.
            </p>
            {digest && (
              <p className="text-xs text-muted-foreground">
                오류 코드: {digest}
              </p>
            )}
            <ActionButton size="lg" className="mt-4" onClick={() => retry()}>
              다시 시도
            </ActionButton>
          </div>
        </main>
      </body>
    </html>
  )
}
