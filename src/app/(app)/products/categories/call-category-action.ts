import { unstable_rethrow } from "next/navigation"
import { toast } from "sonner"

import type { CategoryActionResult } from "@/lib/categories/actions"

/**
 * Calls a 분류 Server Action from a button or dialog.
 * If the request itself fails (no internet connection, the server was
 * updated meanwhile, ...), it shows a toast and returns null, so the page
 * stays as it is instead of switching to the error screen.
 */
export async function callCategoryAction(
  action: () => Promise<CategoryActionResult>
): Promise<CategoryActionResult | null> {
  try {
    return await action()
  } catch (error) {
    // A redirect from the server (e.g. to the login page when the session
    // has expired) is not an error: let Next.js carry it out.
    unstable_rethrow(error)
    console.error(error)
    toast.error(
      "저장하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
    )
    return null
  }
}

/**
 * Shows a Server Action's result as a toast (nothing when there's no
 * message, or when the request failed: callCategoryAction already said so).
 */
export function showCategoryResult(result: CategoryActionResult | null) {
  if (!result) return
  if (!result.ok) toast.error(result.error)
  else if (result.message) toast.success(result.message)
}
