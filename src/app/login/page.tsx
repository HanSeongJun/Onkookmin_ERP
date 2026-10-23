import type { Metadata } from "next"

import { APP_NAME } from "@/config/navigation"

import { LoginForm } from "./login-form"

export const metadata: Metadata = {
  title: "로그인",
}

/**
 * Login page (/login). The only page that can be opened without signing in.
 * Signed-in users are sent to the dashboard by the proxy (src/proxy.ts).
 * There is no sign-up: accounts are created by an admin in the Supabase dashboard.
 */
export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm border border-input bg-background shadow-sm">
        <div className="bg-brand px-6 py-5 text-brand-foreground">
          <h1 className="text-2xl font-bold">{APP_NAME}</h1>
          <p className="mt-1 text-[13px] text-white/90">
            회사 계정으로 로그인하세요.
          </p>
        </div>
        <div className="px-6 py-6">
          <LoginForm />
        </div>
      </div>
    </main>
  )
}
