import { createBrowserClient } from "@supabase/ssr"

import type { Database } from "@/types/database"

import { getSupabaseEnv } from "./env"

/**
 * Supabase client for Client Components (code that runs in the browser).
 *
 * The login session is read from and saved to cookies automatically,
 * so the browser and the server always see the same signed-in user.
 */
export function createClient() {
  const { url, publishableKey } = getSupabaseEnv()

  return createBrowserClient<Database>(url, publishableKey)
}
