/**
 * 자료일괄등록: the sheets of the downloaded Excel files, built from an
 * import's spec (no file is written here; `@/lib/imports/download` writes
 * them with write-excel-file in the browser):
 * - buildTemplateSheets: the [양식 다운로드] template — the data sheet(s)
 *   with a styled title row (required titles marked "*"), then 작성방법
 *   (every column: 필수, 형식, 입력할 수 있는 값, 예시, 설명) and the 예시
 *   sheet(s). The examples sit in their own sheets, so they can never be
 *   imported by accident (only the data sheets are read).
 * - buildErrorSheets: [오류 목록 엑셀로 받기] — the 오류 rows with the same
 *   titles plus "원래 행" and "오류 내용", so the file can be fixed and
 *   uploaded again.
 *
 * Plain data only (no browser APIs): Node test scripts use it too.
 */

import type { Cell, SheetData } from "write-excel-file/browser"

import {
  findImportColumn,
  IMPORT_EXTRA_HEADERS,
  templateHeader,
  type ImportColumn,
  type ImportFileSheet,
  type ImportSheetSpec,
  type ImportSpec,
} from "@/lib/imports/columns"
import type { ImportCell, ImportPreview } from "@/lib/imports/types"

/** One sheet as write-excel-file takes it. */
export type WorkbookSheet = {
  sheet: string
  data: SheetData
  columns: { width: number }[]
  /** Rows kept in view while scrolling (the title row). */
  stickyRowsCount?: number
}

// Colors (Excel files cannot use the app's CSS tokens). BRAND = #475a19,
// the app's brand color; white text on it has a contrast of 7.5:1.
const BRAND = "#475a19"
const WHITE = "#FFFFFF"
const BORDER = "#9AA58A"
const EXAMPLE_FILL = "#EFEFEF"
const EXAMPLE_TEXT = "#595959"
const LABEL_FILL = "#F2F2F2"
const REQUIRED_TEXT = "#C00000"
const ERROR_FILL = "#FDE2E2"

/** Empty rows of the data sheet pre-formatted as text (see textFormat). */
export const TEMPLATE_TEXT_ROWS = 500

const headerStyle = {
  backgroundColor: BRAND,
  textColor: WHITE,
  fontWeight: "bold",
  align: "center",
  alignVertical: "center",
  borderColor: BORDER,
  borderStyle: "thin",
  height: 24,
} as const

/** The styled title row of a data sheet (also used by the error file). */
function headerRow(
  columns: readonly ImportColumn[],
  extra: string[] = []
): Cell[] {
  return [
    ...columns.map((column) => ({
      value: templateHeader(column),
      type: String,
      ...headerStyle,
    })),
    ...extra.map((title) => ({ value: title, type: String, ...headerStyle })),
  ]
}

/** A value of an example row: text columns as text, numbers as numbers. */
function exampleCell(
  column: ImportColumn,
  value: string | number | undefined
): Cell {
  const style = { backgroundColor: EXAMPLE_FILL, textColor: EXAMPLE_TEXT }
  if (value === undefined || value === "") return { ...style, type: String }
  if (typeof value === "number") {
    return { value, type: Number, format: "#,##0", ...style }
  }
  return {
    value,
    type: String,
    ...(column.textFormat ? { format: "@" } : {}),
    ...style,
  }
}

/** The data sheet: title row + empty rows (text columns formatted as text). */
function dataSheet(sheet: ImportSheetSpec): WorkbookSheet {
  const emptyRow: Cell[] = sheet.columns.map((column) =>
    column.textFormat ? { type: String, format: "@" } : null
  )
  const data: SheetData = [headerRow(sheet.columns)]
  for (let index = 0; index < TEMPLATE_TEXT_ROWS; index++) data.push(emptyRow)
  return {
    sheet: sheet.sheetName,
    data,
    columns: sheet.columns.map((column) => ({ width: column.width })),
    stickyRowsCount: 1,
  }
}

/** Name of the 예시 sheet of a data sheet. */
export function exampleSheetName(
  spec: ImportSpec,
  sheet: ImportSheetSpec
): string {
  return spec.sheets.length > 1 ? `${sheet.sheetName} 예시` : "예시"
}

/** The 예시 sheet: a note, the title row, the example rows (grey). */
function exampleSheet(spec: ImportSpec, sheet: ImportSheetSpec): WorkbookSheet {
  const note: Cell[] = [
    {
      value: `이 시트는 작성 예시입니다. 여기 적은 내용은 등록되지 않습니다. 실제 내용은 ‘${sheet.sheetName}’ 시트에 입력해 주세요.`,
      type: String,
      fontWeight: "bold",
      textColor: REQUIRED_TEXT,
      columnSpan: sheet.columns.length,
    },
  ]
  return {
    sheet: exampleSheetName(spec, sheet),
    data: [
      note,
      headerRow(sheet.columns),
      ...sheet.examples.map((example) =>
        sheet.columns.map((column) => exampleCell(column, example[column.key]))
      ),
    ],
    columns: sheet.columns.map((column) => ({ width: column.width })),
    stickyRowsCount: 2,
  }
}

/** The 작성방법 sheet: the instructions, then one row per column. */
function guideSheet(spec: ImportSpec): WorkbookSheet {
  const multi = spec.sheets.length > 1
  const titles = [
    ...(multi ? ["시트"] : []),
    "열 이름",
    "필수",
    "형식",
    "입력할 수 있는 값",
    "예시",
    "설명",
  ]
  const span = titles.length
  const data: SheetData = [
    [
      {
        value: `${spec.title} 작성방법`,
        type: String,
        fontWeight: "bold",
        fontSize: 14,
        columnSpan: span,
        height: 26,
      },
    ],
    ...spec.instructions.map((line, index): Cell[] => [
      {
        value: `${index + 1}. ${line}`,
        type: String,
        wrap: true,
        columnSpan: span,
      },
    ]),
    [],
    titles.map((title) => ({ value: title, type: String, ...headerStyle })),
  ]
  for (const sheet of spec.sheets) {
    for (const column of sheet.columns) {
      const example = sheet.examples.find(
        (row) => row[column.key] !== undefined && row[column.key] !== ""
      )?.[column.key]
      const cell = (value: string, extra: object = {}): Cell => ({
        value,
        type: String,
        wrap: true,
        alignVertical: "top",
        borderColor: BORDER,
        borderStyle: "thin",
        ...extra,
      })
      data.push([
        ...(multi
          ? [cell(sheet.sheetName, { backgroundColor: LABEL_FILL })]
          : []),
        cell(column.header, {
          fontWeight: "bold",
          backgroundColor: LABEL_FILL,
        }),
        cell(
          column.required ? "필수" : "선택",
          column.required
            ? { textColor: REQUIRED_TEXT, fontWeight: "bold" }
            : {}
        ),
        cell(column.format),
        cell(column.allowed ?? ""),
        cell(
          example === undefined
            ? ""
            : typeof example === "number"
              ? example.toLocaleString("ko-KR")
              : example
        ),
        cell(column.help),
      ])
    }
  }
  return {
    sheet: "작성방법",
    data,
    columns: [
      ...(multi ? [{ width: 12 }] : []),
      { width: 22 },
      { width: 7 },
      { width: 36 },
      { width: 40 },
      { width: 24 },
      { width: 60 },
    ],
  }
}

/**
 * The sheets of the [양식 다운로드] file, in order: data sheet(s),
 * 작성방법, 예시 sheet(s). Excel opens it on the first data sheet.
 */
export function buildTemplateSheets(spec: ImportSpec): WorkbookSheet[] {
  return [
    ...spec.sheets.map(dataSheet),
    guideSheet(spec),
    ...spec.sheets.map((sheet) => exampleSheet(spec, sheet)),
  ]
}

/** A cell read from the file, written back as it was (text stays text). */
function originalCell(
  column: ImportColumn,
  value: ImportCell | undefined,
  hasError: boolean
): Cell {
  const fill = hasError ? { backgroundColor: ERROR_FILL } : {}
  if (value === null || value === undefined || value === "") {
    return {
      type: String,
      ...(column.textFormat ? { format: "@" } : {}),
      ...fill,
    }
  }
  if (typeof value === "number") return { value, type: Number, ...fill }
  if (typeof value === "boolean") return { value, type: Boolean, ...fill }
  return {
    value,
    type: String,
    ...(column.textFormat ? { format: "@" } : {}),
    ...fill,
  }
}

/**
 * The sheets of the [오류 목록 엑셀로 받기] file: for every data sheet with
 * 오류 rows, the same title row plus "원래 행" and "오류 내용", then each
 * 오류 row with its cells as read (cells with an error in red) and its
 * messages ("‘상품코드’ 이미 등록된 …", one per line). The sheet names are
 * the template's, so the fixed file can be uploaded again as it is.
 * Returns [] when no row has an error.
 */
export function buildErrorSheets(
  spec: ImportSpec,
  sheets: Record<string, ImportFileSheet>,
  preview: ImportPreview
): WorkbookSheet[] {
  const result: WorkbookSheet[] = []
  for (const sheet of spec.sheets) {
    const errorRows = preview.rows.filter(
      (row) => row.sheet === sheet.key && row.status === "error"
    )
    if (errorRows.length === 0) continue
    const fileRows = new Map(
      (sheets[sheet.key]?.rows ?? []).map((row) => [row.excelRow, row])
    )
    const data: SheetData = [
      headerRow(sheet.columns, [
        IMPORT_EXTRA_HEADERS.originalRow,
        IMPORT_EXTRA_HEADERS.errors,
      ]),
    ]
    for (const row of errorRows) {
      const values = fileRows.get(row.excelRow)?.values ?? {}
      const errorColumns = new Set(row.errors.map((issue) => issue.column))
      const messages = row.errors.map((issue) => {
        const column = issue.column
          ? findImportColumn(sheet, issue.column)
          : null
        return column ? `‘${column.header}’ ${issue.message}` : issue.message
      })
      data.push([
        ...sheet.columns.map((column) =>
          originalCell(column, values[column.key], errorColumns.has(column.key))
        ),
        { value: row.excelRow, type: Number },
        {
          value: messages.join("\n"),
          type: String,
          wrap: true,
          textColor: REQUIRED_TEXT,
        },
      ])
    }
    result.push({
      sheet: sheet.sheetName,
      data,
      columns: [
        ...sheet.columns.map((column) => ({ width: column.width })),
        { width: 8 },
        { width: 60 },
      ],
      stickyRowsCount: 1,
    })
  }
  return result
}
