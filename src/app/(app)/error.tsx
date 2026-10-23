"use client" // Error screens must be Client Components.

import { CircleAlertIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

/**
 * Shown in the content area when a signed-in page fails unexpectedly.
 * The sidebar and header stay, so the user can try again or go elsewhere.
 * (src/app/global-error.tsx is only for when the whole app fails.)
 */
export default function AppError({
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
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <CircleAlertIcon />
        </EmptyMedia>
        <EmptyTitle>일시적인 오류가 발생했습니다</EmptyTitle>
        <EmptyDescription>
          잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의해 주세요.
        </EmptyDescription>
        {digest && (
          <p className="text-xs text-muted-foreground">오류 코드: {digest}</p>
        )}
      </EmptyHeader>
      <EmptyContent>
        <Button onClick={() => retry()}>다시 시도</Button>
      </EmptyContent>
    </Empty>
  )
}
