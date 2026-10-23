import type { NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/auth/user"
import {
  buildEmployeeCsv,
  employeeExportFileNames,
} from "@/lib/employees/export"
import { listEmployeesForExport } from "@/lib/employees/queries"
import { parseEmployeeListParams } from "@/lib/employees/schema"

/**
 * GET /employees/export?<the list's conditions>: the 엑셀 download.
 *
 * Every employee matching the same search and filters as the list (all
 * pages, at most 10,000 rows, in the list's sort order) as a CSV file that
 * Excel opens with the Korean text intact (UTF-8 with BOM). File name
 * 직원목록_YYYYMMDD.csv (date in Korea time). Only for signed-in
 * employees. The columns and the formula-safe cells are built by
 * buildEmployeeCsv (`@/lib/employees/export`): 직원코드, phone numbers and
 * 우편번호 stay text in Excel.
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
  const params = parseEmployeeListParams(searchParams)

  let result: Awaited<ReturnType<typeof listEmployeesForExport>>
  try {
    result = await listEmployeesForExport(params)
  } catch (error) {
    console.error("Could not export employees:", error)
    return textResponse(
      "엑셀 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
      500
    )
  }

  const { fileName, asciiFileName } = employeeExportFileNames()
  return new Response(buildEmployeeCsv(result.rows), {
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
