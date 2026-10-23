import { Suspense } from "react"
import Link from "next/link"

import { AppMenuButton } from "@/components/app-menu-button"
import { NavUser, NavUserSkeleton } from "@/components/nav-user"
import { APP_NAME } from "@/config/navigation"
import { requireUser } from "@/lib/auth/user"

/**
 * Brand-colored bar across the top of every signed-in page:
 * menu button and app name on the left, the signed-in user and 로그아웃 on the
 * right. Its height is the --header-height set in src/app/(app)/layout.tsx.
 */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-(--header-height) w-full shrink-0 items-center gap-1 bg-brand px-2 text-brand-foreground md:gap-2 md:px-3">
      <AppMenuButton />
      <Link
        href="/"
        className="rounded-sm px-1 text-lg font-bold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-white md:text-xl"
      >
        {APP_NAME}
      </Link>

      <div className="ml-auto flex min-w-0 items-center">
        {/* Reading the login session needs the request, so it streams in here. */}
        <Suspense fallback={<NavUserSkeleton />}>
          <SignedInUser />
        </Suspense>
      </div>
    </header>
  )
}

/** Loads the signed-in user (redirects to /login when signed out). */
async function SignedInUser() {
  const user = await requireUser()
  return <NavUser email={user.email} />
}
