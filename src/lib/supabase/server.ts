import "server-only"

import { createServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import { connection } from "next/server"

import type { Database } from "@/types/database"

import { getSupabaseEnv } from "./env"

/**
 * Supabase client for server code: Server Components, Server Actions and
 * Route Handlers.
 *
 * - Create a new client for every request. Never keep one in a global variable.
 * - It reads the request cookies, so a Server Component that uses it must be
 *   rendered inside a <Suspense> boundary (a Cache Components rule).
 * - Do not call it inside a "use cache" or "use cache: private" function
 *   (cookies() and connection() are not allowed there).
 */
export async function createClient() {
  // Read cookies first: while Next.js prerenders pages at build time it stops
  // here, so the build does not need the Supabase settings.
  const cookieStore = await cookies()
  // Supabase compares the login token's expiry time with Date.now() as soon as
  // the client is created. connection() tells Cache Components to run the rest
  // only for a real request, not while preparing a page in advance.
  await connection()
  const { url, publishableKey } = getSupabaseEnv()

  return createServerClient<Database>(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Server Components are not allowed to write cookies, so this fails
          // there. That is fine: the proxy (src/proxy.ts) already refreshes the
          // session cookies before every page is rendered.
        }
      },
    },
  })
}
