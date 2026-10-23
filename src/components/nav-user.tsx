"use client"

import { useFormStatus } from "react-dom"
import { CircleUserRoundIcon } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { signOut } from "@/lib/auth/actions"

/**
 * Signed-in user on the right side of the header bar: email + 로그아웃.
 * On phones only the icon and the button are shown (the email is still read
 * out by screen readers).
 */
export function NavUser({ email }: { email: string }) {
  // Every account should have an email, but don't show a blank label if not.
  const label = email || "로그인 사용자"

  return (
    <div className="flex min-w-0 items-center gap-2">
      <CircleUserRoundIcon aria-hidden="true" className="size-5 shrink-0" />
      <span className="hidden max-w-64 truncate text-sm sm:block" title={label}>
        {label}
      </span>
      <span className="sr-only sm:hidden">로그인 계정: {label}</span>
      {/* signOut is a Server Action: it ends the session and moves to /login. */}
      <form action={signOut} className="shrink-0">
        <SignOutButton />
      </form>
    </div>
  )
}

/** The "로그아웃" button. Must be rendered inside the sign-out <form>. */
function SignOutButton() {
  // `pending` is true while the sign-out request is running.
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="h-7 rounded-sm bg-background px-2.5 text-[13px] font-bold whitespace-nowrap text-brand outline-none hover:bg-brand-tint focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand disabled:opacity-70"
    >
      {pending ? "로그아웃 중…" : "로그아웃"}
    </button>
  )
}

/** Placeholder shown while the signed-in user is being loaded. */
export function NavUserSkeleton() {
  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <Skeleton className="hidden h-4 w-40 bg-white/25 sm:block" />
      <Skeleton className="h-7 w-16 bg-white/25" />
    </div>
  )
}
