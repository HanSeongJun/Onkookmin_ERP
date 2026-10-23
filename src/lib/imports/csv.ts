/**
 * 자료일괄등록: reading CSV files.
 *
 * Excel on Korean Windows saves "CSV (쉼표로 분리)" in CP949 (EUC-KR),
 * while "CSV UTF-8" and most other programs use UTF-8 (with or without a
 * BOM). decodeCsvBytes tries UTF-8 first and falls back to EUC-KR when the
 * bytes are not valid UTF-8. (Browsers' "euc-kr" decoder is Windows CP949,
 * so the extra Hangul syllables CP949 adds are read correctly too.)
 *
 * No imports: the browser and the Node test scripts use it.
 */

import type { ImportCell } from "@/lib/imports/types"

/** The text of a CSV file and the encoding it was read with. */
export function decodeCsvBytes(bytes: Uint8Array): {
  text: string
  encoding: "utf-8" | "euc-kr"
} {
  try {
    // fatal: invalid UTF-8 throws instead of becoming "�". The BOM, if
    // any, is dropped.
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    return { text, encoding: "utf-8" }
  } catch {
    return { text: new TextDecoder("euc-kr").decode(bytes), encoding: "euc-kr" }
  }
}

/**
 * The rows of a CSV text (RFC 4180): fields separated by commas, a field
 * in double quotes may hold commas, line breaks and "" (one quote).
 * Empty fields become null. A field our own 엑셀 downloads protected with a
 * leading ' (text starting with = + - @) gets the ' removed again.
 * @example parseCsv('a,"b,c"\n1,') // [["a", "b,c"], ["1", null]]
 */
export function parseCsv(text: string): ImportCell[][] {
  const rows: ImportCell[][] = []
  let row: ImportCell[] = []
  let field = ""
  let quoted = false
  let index = 0

  const endField = () => {
    const value = /^'[=+\-@]/.test(field) ? field.slice(1) : field
    row.push(value === "" ? null : value)
    field = ""
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  while (index < text.length) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 2
          continue
        }
        quoted = false
      } else {
        field += char
      }
      index++
      continue
    }
    if (char === '"' && field === "") {
      quoted = true
    } else if (char === ",") {
      endField()
    } else if (char === "\n" || char === "\r") {
      endRow()
      if (char === "\r" && text[index + 1] === "\n") index++
    } else {
      field += char
    }
    index++
  }
  // The last line, unless the file ends with a line break.
  if (field !== "" || row.length > 0) endRow()
  return rows
}
