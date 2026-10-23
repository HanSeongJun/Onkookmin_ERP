/**
 * 자료일괄등록: reading the chosen file in the browser.
 *
 * - .xlsx: every sheet with read-excel-file (date cells become
 *   "YYYY-MM-DD", numbers stay numbers, text is trimmed), plus what
 *   `scanXlsx` finds in the file's XML: hidden sheets, formula errors,
 *   merged cells, and numbers shown with leading zeros ("000000" format,
 *   read as the text Excel shows).
 * - .csv: UTF-8 (with or without BOM) or CP949/EUC-KR, see
 *   `@/lib/imports/csv`.
 * Then the import's data sheets are found and their rows read
 * (extractImportSheets in `@/lib/imports/columns`).
 *
 * Browser only: call it from Client Components (event handlers).
 */

import {
  extractImportSheets,
  importSheetsInput,
  tableCellKey,
  type ImportFileResult,
  type ImportSpec,
  type ImportTable,
} from "@/lib/imports/columns"
import { decodeCsvBytes, parseCsv } from "@/lib/imports/csv"
import type { ImportCell } from "@/lib/imports/types"
import { scanXlsx, type XlsxSheetFacts } from "@/lib/imports/xlsx-scan"

/** The `accept` of the file input: .xlsx and .csv. */
export const IMPORT_FILE_ACCEPT =
  ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"

/** Largest file accepted (bytes): 20MB. */
export const IMPORT_FILE_MAX_BYTES = 20 * 1024 * 1024

/**
 * Largest request the rows may make (characters of JSON): below the
 * Server Actions' body limit (next.config.ts: 8mb) with room to spare.
 */
const IMPORT_PAYLOAD_MAX_CHARS = 6 * 1024 * 1024

/** A cell from read-excel-file as an ImportCell (dates → "YYYY-MM-DD"). */
function toImportCell(value: unknown): ImportCell {
  if (value === null || value === undefined) return null
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    // read-excel-file gives the calendar day of the cell at 00:00 UTC.
    return value.toISOString().slice(0, 10)
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value
  }
  return String(value)
}

/** Whether an error is read-excel-file's "this is not a readable .xlsx". */
function invalidInputCode(error: unknown): string | null {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "InvalidInputError"
  ) {
    return "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN"
  }
  return null
}

/** Every sheet of an .xlsx file. */
async function readXlsxTables(file: File): Promise<ImportTable[]> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  // The XML scan runs while read-excel-file reads the cells.
  const scanning = scanXlsx(bytes)
  let sheets: { sheet: string; data: unknown[][] }[]
  try {
    const { default: readExcelFile } = await import("read-excel-file/browser")
    sheets = (await readExcelFile(file)) as {
      sheet: string
      data: unknown[][]
    }[]
  } catch (error) {
    if (invalidInputCode(error)) throw error
    // The browser version reads in a Web Worker; if that is not possible
    // here, read the file on the page instead (slower, same result).
    console.warn("Reading the Excel file again without a worker:", error)
    const { default: readExcelFile } = await import("read-excel-file/universal")
    sheets = (await readExcelFile(bytes.buffer)) as {
      sheet: string
      data: unknown[][]
    }[]
  }
  const facts = (await scanning) ?? []
  return sheets.map((sheet) =>
    xlsxTable(
      sheet.sheet,
      sheet.data,
      facts.find((item) => item.name === sheet.sheet)
    )
  )
}

/**
 * One sheet as an ImportTable: its cells (dates → "YYYY-MM-DD", remembered
 * in dateCells), with what the XML scan found (hidden, formula errors,
 * merged ranges; zero-padded numbers as the text Excel shows).
 */
function xlsxTable(
  name: string,
  data: unknown[][],
  facts: XlsxSheetFacts | undefined
): ImportTable {
  const dateCells = new Set<string>()
  const rows = data.map((row, rowIndex) =>
    row.map((value, columnIndex) => {
      if (value instanceof Date) {
        dateCells.add(tableCellKey(rowIndex, columnIndex))
      }
      return toImportCell(value)
    })
  )
  for (const cell of facts?.zeroPadded ?? []) {
    if (typeof rows[cell.row]?.[cell.column] === "number") {
      rows[cell.row][cell.column] = cell.text
    }
  }
  return {
    name,
    rows,
    hidden: facts?.hidden ?? false,
    errorCells: new Map(
      (facts?.errorCells ?? []).map((cell) => [
        tableCellKey(cell.row, cell.column),
        cell.code,
      ])
    ),
    dateCells,
    merges: facts?.merges ?? [],
  }
}

/**
 * Reads the chosen file for this import: finds its data sheets and reads
 * their rows (see extractImportSheets). Returns a Korean message when the
 * file cannot be used (wrong type, too big, damaged, no matching sheet,
 * missing required columns, no rows, more than 3,000 rows).
 */
export async function readImportFile(
  file: File,
  spec: ImportSpec
): Promise<ImportFileResult> {
  const name = file.name.toLowerCase()
  if (name.endsWith(".xls")) {
    return {
      ok: false,
      message:
        "예전 엑셀 형식(.xls)은 읽을 수 없습니다. 엑셀에서 [파일] → [다른 이름으로 저장] → ‘Excel 통합 문서(*.xlsx)’로 저장한 뒤 올려 주세요.",
    }
  }
  if (!name.endsWith(".xlsx") && !name.endsWith(".csv")) {
    return {
      ok: false,
      message: "엑셀 파일(.xlsx) 또는 CSV 파일(.csv)만 올릴 수 있습니다.",
    }
  }
  if (file.size === 0) {
    return {
      ok: false,
      message: "빈 파일입니다. 내용을 입력한 파일을 올려 주세요.",
    }
  }
  if (file.size > IMPORT_FILE_MAX_BYTES) {
    return {
      ok: false,
      message:
        "파일이 너무 큽니다(20MB 초과). 필요한 행만 남기거나 파일을 나눠서 올려 주세요.",
    }
  }

  let tables: ImportTable[]
  try {
    if (name.endsWith(".csv")) {
      const { text } = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()))
      tables = [{ name: "", rows: parseCsv(text) }]
    } else {
      tables = await readXlsxTables(file)
    }
  } catch (error) {
    const code = invalidInputCode(error)
    console.error("Could not read the import file:", error)
    if (code === "XLS_FILE_NOT_SUPPORTED") {
      return {
        ok: false,
        message:
          "이 파일은 예전 엑셀 형식(.xls)이거나 암호가 걸려 있어 읽을 수 없습니다. 암호를 풀고 ‘Excel 통합 문서(*.xlsx)’로 다시 저장해 올려 주세요.",
      }
    }
    return {
      ok: false,
      message:
        "파일을 읽지 못했습니다. 파일이 손상되었거나 엑셀(.xlsx) 파일이 아닙니다. 엑셀에서 열어 다시 저장한 뒤 올려 주세요.",
    }
  }

  const result = extractImportSheets(spec, tables)
  if (!result.ok) return result
  if (
    JSON.stringify(importSheetsInput(result.sheets)).length >
    IMPORT_PAYLOAD_MAX_CHARS
  ) {
    return {
      ok: false,
      message:
        "파일 내용이 너무 많습니다. 행을 나눠서 두세 번에 걸쳐 올려 주세요.",
    }
  }
  return result
}
