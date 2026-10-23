import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import type { Database } from "@/types/database"

import { getSupabaseEnv } from "./env"

/** Pages that can be opened without signing in. Every other page requires login. */
const PUBLIC_PATHS = ["/login"]

type CookieToSet = {
  name: string
  value: string
  options: CookieOptions
}

/**
 * Runs before every page request (called from src/proxy.ts).
 *
 * 1. Keeps the login session fresh: when the access token has expired,
 *    Supabase issues a new one and we save it to the browser's cookies.
 * 2. Sends signed-out visitors to /login, remembering the page they wanted
 *    in a "next" query parameter (e.g. /login?next=/products).
 * 3. Sends signed-in users away from /login to the dashboard ("/").
 *
 * This is only a fast first check. Pages and Server Actions must still check
 * the user themselves (see src/lib/auth/user.ts).
 */
export async function updateSession(
  request: NextRequest
): Promise<NextResponse> {
  const { url, publishableKey } = getSupabaseEnv()

  // Cookies and headers that Supabase asks us to send back to the browser.
  const cookiesToSet: CookieToSet[] = []
  const headersToSet: Record<string, string> = {}

  const supabase = createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookies, headers) {
        // Also update the incoming request, so the page rendered for this
        // request already sees the refreshed session.
        cookies.forEach(({ name, value }) => request.cookies.set(name, value))
        cookiesToSet.push(...cookies)
        Object.assign(headersToSet, headers)
      },
    },
  })

  // IMPORTANT: keep this call directly after createServerClient.
  // getClaims() verifies the session and refreshes an expired token
  // (which calls setAll above).
  let isSignedIn = false
  try {
    const { data } = await supabase.auth.getClaims()
    isSignedIn = Boolean(data?.claims)
  } catch (error) {
    // Network problem or Supabase is unreachable: treat the visitor as
    // signed out instead of crashing the whole site.
    console.error("[proxy] Could not verify the Supabase session:", error)
  }

  const response = decideResponse(request, isSignedIn)

  // Send the refreshed session cookies (and no-cache headers) to the browser,
  // whether we continue to the page or redirect.
  cookiesToSet.forEach(({ name, value, options }) =>
    response.cookies.set(name, value, options)
  )
  Object.entries(headersToSet).forEach(([key, value]) =>
    response.headers.set(key, value)
  )

  return response
}

/** Decides whether to continue to the requested page or redirect. */
function decideResponse(
  request: NextRequest,
  isSignedIn: boolean
): NextResponse {
  const { pathname, search } = request.nextUrl

  // Server Actions (form submissions handled on the server) check the user
  // themselves. Redirecting their request here would break them, so let them through.
  // Server Actions are always POST requests; checking the method stops a normal
  // page request from skipping this check just by adding the header.
  const isServerAction =
    request.method === "POST" && request.headers.has("next-action")
  const isPublicPath = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  )

  if (!isServerAction && !isSignedIn && !isPublicPath) {
    const loginUrl = new URL("/login", request.url)
    // The dashboard ("/") is where login goes anyway, so it needs no "next".
    const requestedPage = pathname + search
    if (requestedPage !== "/") {
      loginUrl.searchParams.set("next", requestedPage)
    }
    return NextResponse.redirect(loginUrl)
  }

  if (!isServerAction && isSignedIn && isPublicPath) {
    return NextResponse.redirect(new URL("/", request.url))
  }

  // Continue to the page. Passing `request` forwards the refreshed cookies.
  return NextResponse.next({ request })
}
