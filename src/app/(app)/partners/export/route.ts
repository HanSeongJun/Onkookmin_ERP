import type { NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/auth/user"
import { buildPartnerCsv, partnerExportFileNames } from "@/lib/partners/export"
import { listPartnersForExport } from "@/lib/partners/queries"
import { parsePartnerListParams } from "@/lib/partners/schema"

/**
 * GET /partners/export?<the list's conditions>: the 엑셀 download.
 *
 * Every partner matching the same search and filters as the list (all
 * pages, at most 10,000 rows, in the list's sort order) as a CSV file that
 * Excel opens with the Korean text intact (UTF-8 with BOM). File name
 * 거래처목록_YYYYMMDD.csv (date in Korea time). Only for signed-in
 * employees. The columns and the formula-safe cells are built by
 * buildPartnerCsv (`@/lib/partners/export`): 거래처코드, 사업자번호, phone
 * numbers and 우편번호 stay text in Excel.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return textResponse("로그인이 필요합니다. 다시 로그인해 주세요.", 401)
  }

  // Same reading of the conditions as the list page (first value of each
  // param; anything invalid falls back to the default).
  const searchParams: Record<string, string> = {}
  for (const [key, value] of request.nextUrl.searchParams) {
    if (!(key in searchParams)) searchParams[key] = value
  }
  const params = parsePartnerListParams(searchParams)

  let result: Awaited<ReturnType<typeof listPartnersForExport>>
  try {
    result = await listPartnersForExport(params)
  } catch (error) {
    console.error("Could not export partners:", error)
    return textResponse(
      "엑셀 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
      500
    )
  }

  const { fileName, asciiFileName } = partnerExportFileNames()
  return new Response(buildPartnerCsv(result.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // filename: plain fallback for old browsers; filename*: the Korean name.
      "Content-Disposition": `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
      // For the 엑셀 button's message: rows in the file and all matches.
      "X-Export-Rows": String(result.rows.length),
      "X-Export-Total": String(result.total),
    },
  })
}

function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}
