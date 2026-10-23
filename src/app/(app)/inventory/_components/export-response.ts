import type { NextRequest } from "next/server"

// Small helpers of the 재고 엑셀 Route Handlers (GET /inventory/export,
// /inventory/locations/export, /inventory/ledger/export), the same answers
// as the 상품 / 거래처 / 직원 downloads.

/**
 * The URL's params as the list pages read them: the first value of each
 * (anything invalid falls back to the default in the parse function).
 */
export function firstSearchParams(
  request: NextRequest
): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [key, value] of request.nextUrl.searchParams) {
    if (!(key in params)) params[key] = value
  }
  return params
}

/** The CSV file, with the Korean file name and the row count (X-Export-Rows). */
export function csvResponse(
  body: string,
  {
    fileName,
    asciiFileName,
    rows,
  }: { fileName: string; asciiFileName: string; rows: number }
): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      // filename: plain fallback for old browsers; filename*: the Korean name.
      "Content-Disposition": `attachment; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
      // For the 엑셀 button's message.
      "X-Export-Rows": String(rows),
    },
  })
}

/** A short Korean message (the 엑셀 button shows it as an error toast). */
export function textResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  })
}
