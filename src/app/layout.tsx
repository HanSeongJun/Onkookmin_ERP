import type { Metadata } from "next"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { APP_NAME } from "@/config/navigation"

import { paperlogy } from "./fonts/paperlogy"
import "./globals.css"

export const metadata: Metadata = {
  title: {
    template: `%s | ${APP_NAME}`,
    default: APP_NAME,
  },
  description:
    "식자재 유통 업무를 위한 사내 ERP — 상품, 재고, 구매·입고, 판매·출고, 정산 관리",
}

// The root layout must stay free of request-time data (cookies, headers)
// so it can be part of the prerendered static shell.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Paperlogy font (src/app/fonts/paperlogy.ts), the default via globals.css.
    <html lang="ko" className={`${paperlogy.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        {/* The app has no dark mode, so toasts always use the light theme. */}
        <Toaster
          theme="light"
          position="top-center"
          containerAriaLabel="알림"
        />
      </body>
    </html>
  )
}
