/**
 * 자료일괄등록: the column specs of an import (the single source for the
 * template, reading the file and the messages) and reading the sheets of a
 * file into rows (title row → column keys).
 *
 * Each entity's spec (PRODUCT_CATEGORY_IMPORT, PRODUCT_IMPORT,
 * PARTNER_IMPORT, EMPLOYEE_IMPORT) lists its sheets and columns. A column's
 * `header` is the title in the template; titles in a file are matched by
 * name, in any order, ignoring spaces, "*", brackets and upper/lower case
 * (matchKey), and `aliases` are accepted too.
 *
 * No server imports: Client Components use this file too.
 */

import { cellText, isEmptyCell, matchKey } from "@/lib/imports/values"
import {
  IMPORT_CELL_MAX_CHARS,
  IMPORT_DATE_CELL_FLAG,
  IMPORT_MAX_ROWS,
  type ImportCell,
  type ImportKind,
  type ImportRawRow,
} from "@/lib/imports/types"

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

/** One column of an import sheet. */
export type ImportColumn = {
  /**
   * Key of the column in ImportRawRow.values, ImportIssue.column and the
   * database's error detail ("field"), e.g. "code".
   */
  key: string
  /** Title in the template (without "*"), e.g. "상품코드". */
  header: string
  /** Other titles accepted in a file (e.g. the titles of our 엑셀 downloads). */
  aliases?: readonly string[]
  /**
   * Titles that look like this column but may mean something else (e.g.
   * ‘매입가’ may be without 부가세): such a column is not read, and the file
   * gets a note asking to rename it if it really is this column.
   */
  notAccepted?: readonly string[]
  /**
   * The column holds a date (입사일, 퇴사일). In every other column a date
   * cell gets a note: Excel may have turned e.g. 3-15 into a date.
   */
  dateColumn?: boolean
  /**
   * The column must be in the file and every row must fill it. The template
   * marks its title with "*".
   */
  required: boolean
  /** 작성방법: how to write the value. */
  format: string
  /** 작성방법: the values allowed (exact Korean labels), when limited. */
  allowed?: string
  /** 작성방법: what the column means and its rules. */
  help: string
  /** Column width in the template (characters). */
  width: number
  /**
   * Cells of this column are text in the template ("@" format), so Excel
   * keeps leading zeros (00123, 010…) and never turns the value into a date
   * or a number (3-15, 1.10).
   */
  textFormat: boolean
}

/** One sheet of an import (상품 has two: 기준상품, 묶음상품). */
export type ImportSheetSpec = {
  /** Key in ImportInput.sheets and ImportRowResult.sheet. */
  key: string
  /** Name of the data sheet in the template, e.g. "기준상품". */
  sheetName: string
  columns: readonly ImportColumn[]
  /**
   * Example rows for the template's 예시 sheet (by column key). They are
   * never read back: only the data sheet is imported.
   */
  examples: readonly Record<string, string | number>[]
}

/** One kind of 자료일괄등록. */
export type ImportSpec = {
  kind: ImportKind
  /** Page title, e.g. "상품 일괄등록". */
  title: string
  /** What one row registers, e.g. "상품", "거래처". */
  entityLabel: string
  /** File name of the template, e.g. "상품_일괄등록_양식.xlsx". */
  templateFileName: string
  sheets: readonly ImportSheetSpec[]
  /** Lines at the top of the 작성방법 sheet. */
  instructions: readonly string[]
  /** The list screen of what was registered (link in the result panel). */
  listHref: string
  /** Its menu name, e.g. "상품관리". */
  listLabel: string
  /**
   * How to correct registered rows (the last line of the 등록 confirm).
   * Default: "고칠 내용은 ‘<listLabel>’에서 수정해 주세요."
   */
  fixHint?: string
  /**
   * What the result's list of codes holds (ImportCommitResult.codes), e.g.
   * "로트번호" for 기초재고. Default "코드" ("등록한 코드: …").
   */
  savedCodesLabel?: string
  /** The screen offers "없는 분류는 자동으로 만들기" (default on). */
  hasCategoryOption: boolean
}

/** Sheet key of a one-sheet import. */
export const MAIN_SHEET = "main"

/**
 * Titles that our 오류 목록 file adds after the data columns. They are
 * skipped silently, so that file can be fixed and uploaded again.
 */
export const IMPORT_EXTRA_HEADERS = {
  originalRow: "원래 행",
  errors: "오류 내용",
} as const

/** The column of a sheet with this key. */
export function findImportColumn(
  sheet: ImportSheetSpec,
  key: string
): ImportColumn | undefined {
  return sheet.columns.find((column) => column.key === key)
}

/** The sheet of a spec with this key. */
export function findImportSheet(
  spec: ImportSpec,
  key: string
): ImportSheetSpec | undefined {
  return spec.sheets.find((sheet) => sheet.key === key)
}

/**
 * The title of a column in the template: "상품코드*" for a required column.
 */
export function templateHeader(column: ImportColumn): string {
  return column.required ? `${column.header}*` : column.header
}

// ---------------------------------------------------------------------------
// Reading the sheets of a file
// ---------------------------------------------------------------------------

/** One sheet (or a CSV file) as rows of cells, top to bottom. */
export type ImportTable = {
  /** Sheet name ("" for a CSV file). */
  name: string
  /** Row 1 of the sheet is rows[0]. */
  rows: ImportCell[][]
  /** A hidden sheet (시트 숨기기): never read. */
  hidden?: boolean
  /**
   * Cells whose formula failed, by "<row index>:<column index>" (0-based),
   * with the error code (e.g. "#N/A"). Their value in `rows` is empty.
   */
  errorCells?: ReadonlyMap<string, string>
  /** Date cells (now "YYYY-MM-DD" text in `rows`), by "<row>:<column>". */
  dateCells?: ReadonlySet<string>
  /** Merged ranges (0-based, inclusive): the value sits in the top-left cell. */
  merges?: readonly {
    top: number
    left: number
    bottom: number
    right: number
  }[]
}

/** The key of a cell in ImportTable.errorCells / dateCells. */
export function tableCellKey(row: number, column: number): string {
  return `${row}:${column}`
}

/** "D5" for row index 4, column index 3. */
function cellRef(row: number, column: number): string {
  let letters = ""
  for (let rest = column + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters
  }
  return `${letters}${row + 1}`
}

/** The rows of one data sheet, read from a file. */
export type ImportFileSheet = {
  /** ImportSheetSpec.key. */
  key: string
  /** The sheet's name in the file ("CSV" for a CSV file). */
  sheetName: string
  /** Excel row number of the title row. */
  headerRow: number
  /** Column keys found in the file, in the file's order. */
  columns: string[]
  /** Data rows (blank rows left out), top to bottom. */
  rows: ImportRawRow[]
}

/** Result of reading the sheets of a file. */
export type ImportFileResult =
  | {
      ok: true
      /** Every sheet of the spec, by key (empty rows when not in the file). */
      sheets: Record<string, ImportFileSheet>
      /** Data rows of all sheets together. */
      rowCount: number
      /** Korean notes that do not stop the import (e.g. unknown columns). */
      warnings: string[]
    }
  | { ok: false; message: string }

/** Sheets of our template that hold no data (작성방법, 예시). */
function isHelperSheet(name: string): boolean {
  const key = matchKey(name)
  return key === matchKey("작성방법") || key.includes(matchKey("예시"))
}

/** The column a title names (by header or alias), or undefined. */
function columnOfHeader(
  sheet: ImportSheetSpec,
  title: string
): ImportColumn | undefined {
  const key = matchKey(title)
  if (key === "") return undefined
  return sheet.columns.find(
    (column) =>
      matchKey(column.header) === key ||
      column.aliases?.some((alias) => matchKey(alias) === key)
  )
}

/** Whether a title is one of IMPORT_EXTRA_HEADERS. */
function isExtraHeader(title: string): boolean {
  const key = matchKey(title)
  return Object.values(IMPORT_EXTRA_HEADERS).some(
    (header) => matchKey(header) === key
  )
}

/** How many of the cells of a row are titles of this sheet's columns. */
function headerScore(sheet: ImportSheetSpec, row: ImportCell[]): number {
  const keys = new Set<string>()
  for (const cell of row) {
    const column = columnOfHeader(sheet, cellText(cell))
    if (column) keys.add(column.key)
  }
  return keys.size
}

/** Rows looked at to find the title row (rows above it are left out). */
const HEADER_SEARCH_ROWS = 10

/**
 * The title row of a table for this sheet: the first row (of the first 10)
 * with at least one known title. Returns its index and score.
 */
function findHeaderRow(
  sheet: ImportSheetSpec,
  table: ImportTable
): { index: number; score: number } | null {
  const last = Math.min(table.rows.length, HEADER_SEARCH_ROWS)
  for (let index = 0; index < last; index++) {
    const score = headerScore(sheet, table.rows[index] ?? [])
    if (score > 0) return { index, score }
  }
  return null
}

/**
 * Reads the data rows of one table for one sheet spec: maps the title row
 * to column keys, then every non-blank row below it to an ImportRawRow.
 */
function readTable(
  sheet: ImportSheetSpec,
  table: ImportTable,
  headerIndex: number,
  sheetLabel: string
):
  | { ok: true; sheet: ImportFileSheet; warnings: string[] }
  | {
      ok: false
      message: string
    } {
  const header = table.rows[headerIndex] ?? []
  const keyAt = new Map<number, string>()
  const unknown: string[] = []
  const notAccepted: string[] = []
  const duplicated: string[] = []
  header.forEach((cell, index) => {
    const title = cellText(cell)
    if (title === "" || isExtraHeader(title)) return
    const column = columnOfHeader(sheet, title)
    if (!column) {
      const lookalike = sheet.columns.find((item) =>
        item.notAccepted?.some((other) => matchKey(other) === matchKey(title))
      )
      if (lookalike) {
        notAccepted.push(
          `‘${title}’ 열은 읽지 않았습니다. ‘${lookalike.header}’ 열이 맞다면 열 이름을 ‘${lookalike.header}’(으)로 바꿔 주세요.`
        )
      } else {
        unknown.push(title)
      }
      return
    }
    if ([...keyAt.values()].includes(column.key)) {
      duplicated.push(title)
      return
    }
    keyAt.set(index, column.key)
  })

  const missing = sheet.columns.filter(
    (column) => column.required && ![...keyAt.values()].includes(column.key)
  )
  if (missing.length > 0) {
    return {
      ok: false,
      message: `${sheetLabel}에 꼭 있어야 하는 열이 없습니다: ${missing
        .map((column) => `‘${column.header}’`)
        .join(
          ", "
        )}. [양식 다운로드]로 받은 양식의 첫 줄(열 이름)을 지우거나 바꾸지 말고 작성해 주세요.`,
    }
  }

  // Merged cells (셀 병합) below the title row, within one column: every
  // row of the range reads the value of its top cell, as Excel shows it.
  const mergedValues = new Map<string, ImportCell>()
  const mergedRanges: string[] = []
  for (const range of table.merges ?? []) {
    if (range.top <= headerIndex || range.left !== range.right) continue
    if (range.bottom === range.top || !keyAt.has(range.left)) continue
    const value = table.rows[range.top]?.[range.left] ?? null
    if (isEmptyCell(value)) continue
    for (let row = range.top + 1; row <= range.bottom; row++) {
      mergedValues.set(tableCellKey(row, range.left), value)
    }
    mergedRanges.push(
      `${cellRef(range.top, range.left)}:${cellRef(range.bottom, range.left)}`
    )
  }

  const columnOfKey = new Map(
    sheet.columns.map((column) => [column.key, column])
  )
  const rows: ImportRawRow[] = []
  for (let index = headerIndex + 1; index < table.rows.length; index++) {
    const cells = table.rows[index] ?? []
    // Only filled cells are kept (a missing key reads as empty), so the
    // request to the Server Actions stays small.
    const values: Record<string, ImportCell> = {}
    const flags: Record<string, string> = {}
    let ownValues = 0
    for (const [position, key] of keyAt) {
      const cellKey = tableCellKey(index, position)
      const own = cells[position] ?? null
      if (!isEmptyCell(own)) ownValues++
      let cell = own ?? mergedValues.get(cellKey) ?? null
      if (typeof cell === "string" && cell.length > IMPORT_CELL_MAX_CHARS) {
        cell = cell.slice(0, IMPORT_CELL_MAX_CHARS)
      }
      if (!isEmptyCell(cell)) values[key] = cell
      const formulaError = table.errorCells?.get(cellKey)
      if (formulaError) {
        flags[key] = formulaError
      } else if (
        table.dateCells?.has(cellKey) &&
        !columnOfKey.get(key)?.dateColumn
      ) {
        flags[key] = IMPORT_DATE_CELL_FLAG
      }
    }
    // A row without a value of its own is blank, even when a formula
    // copied down below the data shows #N/A in it, or a merged cell
    // reaches into it.
    if (ownValues === 0) continue
    rows.push({
      excelRow: index + 1,
      values,
      ...(Object.keys(flags).length > 0 ? { flags } : {}),
    })
  }

  const warnings: string[] = []
  warnings.push(...notAccepted.map((note) => `${sheetLabel}: ${note}`))
  if (mergedRanges.length > 0) {
    warnings.push(
      `${sheetLabel}: 세로로 병합된 칸(${mergedRanges.slice(0, 5).join(", ")}${mergedRanges.length > 5 ? ` 외 ${mergedRanges.length - 5}곳` : ""})은 병합된 모든 행에 같은 값을 넣어 읽었습니다.`
    )
  }
  if (unknown.length > 0) {
    warnings.push(
      `${sheetLabel}: 양식에 없는 열은 무시했습니다 (${unknown.map((title) => `‘${title}’`).join(", ")}).`
    )
  }
  if (duplicated.length > 0) {
    warnings.push(
      `${sheetLabel}: 같은 열이 두 번 있어 앞의 열만 읽었습니다 (${duplicated.map((title) => `‘${title}’`).join(", ")}).`
    )
  }
  return {
    ok: true,
    sheet: {
      key: sheet.key,
      sheetName: table.name || "CSV",
      headerRow: headerIndex + 1,
      columns: [...keyAt.values()],
      rows,
    },
    warnings,
  }
}

/**
 * Whether a table could be read for this sheet spec and holds data: its
 * title row has every required title and at least one row below it has a
 * value in one of the sheet's columns.
 */
function hasReadableData(sheet: ImportSheetSpec, table: ImportTable): boolean {
  const header = findHeaderRow(sheet, table)
  if (!header) return false
  const positions: number[] = []
  const keys = new Set<string>()
  ;(table.rows[header.index] ?? []).forEach((cell, index) => {
    const column = columnOfHeader(sheet, cellText(cell))
    if (!column) return
    positions.push(index)
    keys.add(column.key)
  })
  if (
    sheet.columns.some((column) => column.required && !keys.has(column.key))
  ) {
    return false
  }
  return table.rows
    .slice(header.index + 1)
    .some((row) => positions.some((index) => !isEmptyCell(row[index])))
}

/**
 * Finds the data sheets of `spec` among the tables of a file and reads
 * their rows.
 * - A table belongs to the sheet spec with its name (e.g. "기준상품"); a
 *   table with another name (or a CSV file) to the sheet spec whose column
 *   titles it matches best (상품: a table with ‘구성상품’ is 묶음상품).
 *   작성방법 and 예시 sheets, and hidden sheets, are never read.
 * - Another sheet that could be read and holds data is never left out
 *   silently: when every data sheet was found by its template name it is
 *   a note ("‘Sheet2’ 시트는 읽지 않았습니다"); when a sheet was only
 *   guessed by its titles (e.g. 거래처 split into ‘매출처’ and ‘매입처’
 *   sheets) it is an error, as it is unclear which one is meant.
 * - The title row is the first row (of the first 10) with a known title.
 *   Columns are matched by title, in any order; a missing required column
 *   is an error, unknown columns are only a warning.
 * - Merged cells within one column are read as the value of their top
 *   cell; cells with a formula error and date cells in other columns are
 *   flagged (ImportRawRow.flags).
 * - Blank rows are left out; at most IMPORT_MAX_ROWS data rows in total.
 */
export function extractImportSheets(
  spec: ImportSpec,
  tables: readonly ImportTable[]
): ImportFileResult {
  const candidates = tables.filter(
    (table) => !isHelperSheet(table.name) && !table.hidden
  )
  const assigned = new Map<
    string,
    { table: ImportTable; headerIndex: number }
  >()

  // 1. Tables named like a sheet of the spec.
  for (const sheet of spec.sheets) {
    const table = candidates.find(
      (candidate) => matchKey(candidate.name) === matchKey(sheet.sheetName)
    )
    if (!table) continue
    const header = findHeaderRow(sheet, table)
    if (header) assigned.set(sheet.key, { table, headerIndex: header.index })
  }
  const allByName = assigned.size === spec.sheets.length

  // 2. Other tables: the sheet whose titles they match best.
  const used = new Set([...assigned.values()].map((entry) => entry.table))
  for (const table of candidates) {
    if (used.has(table)) continue
    let best: { sheet: ImportSheetSpec; index: number; score: number } | null =
      null
    for (const sheet of spec.sheets) {
      if (assigned.has(sheet.key)) continue
      const header = findHeaderRow(sheet, table)
      if (header && (!best || header.score > best.score)) {
        best = { sheet, index: header.index, score: header.score }
      }
    }
    if (best) {
      assigned.set(best.sheet.key, { table, headerIndex: best.index })
      used.add(table)
    }
  }

  if (assigned.size === 0) {
    const sheetNames = spec.sheets.map((sheet) => `‘${sheet.sheetName}’`)
    const hiddenMatch = tables.find(
      (table) =>
        table.hidden &&
        !isHelperSheet(table.name) &&
        spec.sheets.some((sheet) => findHeaderRow(sheet, table))
    )
    return {
      ok: false,
      message: hiddenMatch
        ? `‘${hiddenMatch.name}’ 시트가 숨겨져 있어 읽지 않았습니다. 엑셀에서 시트 탭을 오른쪽 클릭 → [숨기기 취소]로 시트를 보이게 한 뒤 다시 올려 주세요.`
        : `양식에 맞는 시트를 찾지 못했습니다. [양식 다운로드]로 받은 양식의 ${sheetNames.join(", ")} 시트에, 첫 줄의 열 이름(예: ‘${spec.sheets[0].columns[0].header}’)을 그대로 두고 작성해 주세요.`,
    }
  }

  // Other sheets with the same titles and data are not read. When every
  // data sheet was found by its template name, that is clear (a note);
  // when a sheet was only guessed by its titles, it is not: an error.
  const usedTables = new Set([...assigned.values()].map((entry) => entry.table))
  const unread = candidates.filter(
    (table) =>
      !usedTables.has(table) &&
      spec.sheets.some((sheet) => hasReadableData(sheet, table))
  )
  const readNames = spec.sheets
    .map((sheet) => assigned.get(sheet.key)?.table.name)
    .filter((name): name is string => !!name)
    .map((name) => `‘${name}’`)
    .join(", ")
  const unreadNames = unread.map((table) => `‘${table.name}’`).join(", ")
  if (unread.length > 0 && !allByName) {
    return {
      ok: false,
      message: `이 파일에는 ${readNames} 시트 말고도 같은 열 이름에 내용이 있는 시트가 있습니다: ${unreadNames}. ${spec.entityLabel} 자료는 ${spec.sheets.length > 1 ? "시트마다 한 시트만" : "한 시트만"} 읽으므로, 등록할 내용을 한 시트에 모으거나 파일을 나눠서 올려 주세요. (필요 없는 시트는 지우거나 숨기면 읽지 않습니다.)`,
    }
  }

  const sheets: Record<string, ImportFileSheet> = {}
  const warnings: string[] = []
  if (unread.length > 0) {
    warnings.push(
      `${unreadNames} 시트는 읽지 않았습니다. 이 화면은 ${readNames} 시트만 읽습니다. 그 시트의 내용도 등록하려면 ${readNames} 시트로 옮겨 주세요.`
    )
  }
  let rowCount = 0
  for (const sheet of spec.sheets) {
    const entry = assigned.get(sheet.key)
    if (!entry) {
      sheets[sheet.key] = {
        key: sheet.key,
        sheetName: sheet.sheetName,
        headerRow: 1,
        columns: [],
        rows: [],
      }
      continue
    }
    const label =
      spec.sheets.length > 1 || entry.table.name
        ? `‘${entry.table.name || sheet.sheetName}’ 시트`
        : "파일"
    const result = readTable(sheet, entry.table, entry.headerIndex, label)
    if (!result.ok) return result
    sheets[sheet.key] = result.sheet
    warnings.push(...result.warnings)
    rowCount += result.sheet.rows.length
  }

  if (rowCount === 0) {
    return {
      ok: false,
      message:
        "등록할 행이 없습니다. 첫 줄(열 이름) 아래에 내용을 입력해 주세요. (‘예시’ 시트의 내용은 등록되지 않습니다.)",
    }
  }
  if (rowCount > IMPORT_MAX_ROWS) {
    return {
      ok: false,
      message: `한 번에 ${IMPORT_MAX_ROWS.toLocaleString("ko-KR")}행까지 올릴 수 있습니다. 지금 파일은 ${rowCount.toLocaleString("ko-KR")}행입니다. 파일을 나눠서 올려 주세요.`,
    }
  }
  return { ok: true, sheets, rowCount, warnings }
}

/**
 * The rows to send to validate<Entity>Import / commit<Entity>Import:
 * ImportInput.sheets from a read file.
 */
export function importSheetsInput(
  sheets: Record<string, ImportFileSheet>
): Record<string, ImportRawRow[]> {
  return Object.fromEntries(
    Object.entries(sheets).map(([key, sheet]) => [key, sheet.rows])
  )
}
