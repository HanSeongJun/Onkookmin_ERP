import type { NextRequest } from "next/server"

import { updateSession } from "@/lib/supabase/proxy"

/**
 * Next.js Proxy (called "middleware" in older Next.js versions).
 * Runs before every matching request: it keeps the login session fresh and
 * sends signed-out visitors to /login. The logic lives in src/lib/supabase/proxy.ts.
 */
export async function proxy(request: NextRequest) {
  return updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Run on every path except:
     * - _next/static (JavaScript and CSS files)
     * - _next/image (optimized images)
     * - favicon.ico, the app icon (src/app/icon.svg) and image files from the public/ folder
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
}
