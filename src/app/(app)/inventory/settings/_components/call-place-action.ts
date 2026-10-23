import { unstable_rethrow } from "next/navigation"
import { toast } from "sonner"

/**
 * Calls a 창고·구역·위치 Server Action from a button or dialog. When the
 * request itself fails (no connection, the server was updated meanwhile)
 * it shows a toast and returns null, so the screen stays as it is. A
 * redirect from the server (session expired → /login) is carried out.
 */
export async function callPlaceAction<Result>(
  action: () => Promise<Result>
): Promise<Result | null> {
  try {
    return await action()
  } catch (error) {
    unstable_rethrow(error)
    console.error(error)
    toast.error(
      "저장하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
    )
    return null
  }
}
