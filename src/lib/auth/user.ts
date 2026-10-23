import "server-only"

import { redirect } from "next/navigation"
import { cache } from "react"

import { createClient } from "@/lib/supabase/server"

/** The signed-in employee. */
export type CurrentUser = {
  id: string
  email: string
}

/**
 * Returns the signed-in user, or null when nobody is signed in.
 *
 * - The session is verified with Supabase (getClaims), not just read from the
 *   cookie, so it cannot be faked.
 * - It reads request cookies: render the component that calls it inside a
 *   <Suspense> boundary.
 * - Wrapped in React `cache()`: calling it many times while rendering one
 *   request checks the session only once.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient()

  try {
    const { data, error } = await supabase.auth.getClaims()
    if (error || !data) {
      return null
    }

    return {
      id: data.claims.sub,
      email: data.claims.email ?? "",
    }
  } catch (error) {
    // Network problem or Supabase is unreachable: treat as signed out.
    console.error("Could not verify the Supabase session:", error)
    return null
  }
})

/**
 * Returns the signed-in user, or sends the visitor to the login page.
 * Use it in every page, component or Server Action that needs a user.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser()
  if (!user) {
    redirect("/login")
  }
  return user
}
