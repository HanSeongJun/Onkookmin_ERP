import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/** The four steps of every 자료일괄등록 screen, in order. */
const IMPORT_STEPS = [
  {
    title: "양식 다운로드",
    help: "[양식 다운로드]로 엑셀 양식을 받아 내용을 채웁니다.",
  },
  {
    title: "파일 선택",
    help: "채운 파일을 아래 칸에 끌어다 놓거나 [파일 선택]을 누릅니다.",
  },
  {
    title: "미리보기 확인",
    help: "행마다 정상·오류를 확인합니다. 오류 행은 등록되지 않습니다.",
  },
  {
    title: "등록",
    help: "[정상 N건 등록]을 누르면 정상 행을 한꺼번에 등록합니다.",
  },
] as const

/** The step to do now (1–4); 5 = every step is done. */
export type ImportStep = 1 | 2 | 3 | 4 | 5

/**
 * Progress strip at the top of a 자료일괄등록 screen:
 * 1 양식 다운로드 → 2 파일 선택 → 3 미리보기 확인 → 4 등록.
 * Steps before `current` show a check mark; `current` is tinted.
 */
export function ImportSteps({ current }: { current: ImportStep }) {
  return (
    <ol
      aria-label="일괄등록 순서"
      className="grid grid-cols-2 border-t border-l border-input xl:grid-cols-4"
    >
      {IMPORT_STEPS.map((step, index) => {
        const number = index + 1
        const done = number < current
        const active = number === current
        return (
          <li
            key={step.title}
            aria-current={active ? "step" : undefined}
            className={cn(
              "flex min-w-0 items-start gap-2 border-r border-b border-input px-2.5 py-2 sm:gap-2.5 sm:px-3",
              active && "bg-brand-tint"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                done || active
                  ? "bg-brand text-brand-foreground"
                  : "border border-input bg-background text-muted-foreground"
              )}
            >
              {done ? <CheckIcon className="size-3.5" /> : number}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span
                className={cn(
                  "text-[13px] font-bold",
                  active && "text-brand-active",
                  !done && !active && "text-muted-foreground"
                )}
              >
                <span className="sr-only">{number}단계 </span>
                {step.title}
                {done && <span className="sr-only"> (완료)</span>}
              </span>
              {/* Only the titles on phones, to keep the strip short. */}
              <span className="hidden text-xs text-muted-foreground sm:block">
                {step.help}
              </span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}
