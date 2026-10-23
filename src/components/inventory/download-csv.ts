"use client"

import { toast } from "sonner"

import { formatNumber } from "@/lib/format"

/**
 * Downloads a CSV from one of our 엑셀 Route Handlers (e.g.
 * "/inventory/receipts/export?from=…") and shows the result as a toast
 * ("엑셀 파일(입고전표_20261023.csv)을 내려받았습니다. 12건"). Signed out →
 * a Korean message asking to log in again. Returns whether it worked.
 *
 * @example
 * <ActionButton keyHint="Ctrl+F9" onClick={() => void downloadInventoryCsv(href, "재고현황.csv")}>엑셀</ActionButton>
 */
export async function downloadInventoryCsv(
  href: string,
  fallbackFileName: string
): Promise<boolean> {
  const toastId = toast.loading("엑셀 파일을 만드는 중입니다…")
  try {
    const response = await fetch(href, { cache: "no-store" })
    const contentType = response.headers.get("content-type") ?? ""
    if (
      response.status === 401 ||
      (response.ok && !contentType.includes("text/csv"))
    ) {
      toast.error(
        "로그인이 필요합니다. 페이지를 새로고침한 뒤 다시 로그인해 주세요.",
        { id: toastId }
      )
      return false
    }
    if (response.status === 503) {
      toast.error(await response.text(), { id: toastId })
      return false
    }
    if (!response.ok) throw new Error(`Export failed: ${response.status}`)

    const blob = await response.blob()
    const fileName =
      fileNameFromDisposition(response.headers.get("content-disposition")) ??
      fallbackFileName
    saveFile(blob, fileName)
    const rowCount = Number(response.headers.get("x-export-rows"))
    toast.success(
      Number.isFinite(rowCount)
        ? `엑셀 파일(${fileName})을 내려받았습니다. ${formatNumber(rowCount, 0)}건`
        : `엑셀 파일(${fileName})을 내려받았습니다.`,
      { id: toastId }
    )
    return true
  } catch (error) {
    console.error(error)
    toast.error("엑셀 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", {
      id: toastId,
    })
    return false
  }
}

/** The file name from a Content-Disposition header (filename* first). */
function fileNameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1])
    } catch {
      // Fall through to the plain file name.
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header)
  return plain ? plain[1] : null
}

/** Lets the browser save `blob` as a file called `fileName`. */
function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  // Give the browser time to start the download before freeing the memory.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
