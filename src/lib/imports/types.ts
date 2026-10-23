/**
 * 자료일괄등록 (bulk registration from Excel): the types every import
 * screen shares, and the rule keys of the database's import functions.
 *
 * How one import works (same for 상품분류, 상품, 거래처, 직원):
 * 1. [양식 다운로드]: an .xlsx template built from the entity's column
 *    specs (`@/lib/imports/download`, `@/lib/imports/workbook`).
 * 2. 파일 선택: the browser reads the .xlsx / .csv file into raw rows
 *    (`readImportFile` in `@/lib/imports/read-file`): ImportInput.
 * 3. 미리보기: the Server Action validate<Entity>Import(input) checks every
 *    row (the same zod rules as the 등록 screens, rows against each other,
 *    and the database) and returns an ImportPreview.
 * 4. [정상 M건 등록]: commit<Entity>Import(input, okRowKeys) checks again
 *    and sends the 정상 rows to ONE database function (all or nothing).
 *
 * No server imports: Client Components use this file too.
 */

/** The kinds of 자료일괄등록 (also the last part of the page address). */
export type ImportKind =
  "product-categories" | "products" | "partners" | "employees" | "opening-stock"

/** Most data rows one file may have (all sheets together). */
export const IMPORT_MAX_ROWS = 3000

/**
 * Longest text one cell may hold when it is sent to the Server Actions.
 * Longer text is cut to this length when the file is read (every column's
 * own limit is far below it, so the row still shows "N자 이하로…").
 */
export const IMPORT_CELL_MAX_CHARS = 10_000

/**
 * One cell as read from the file: text, a number, TRUE/FALSE, or empty.
 * Date cells are turned into "YYYY-MM-DD" text when the file is read.
 */
export type ImportCell = string | number | boolean | null

/**
 * One data row of a sheet: its Excel row number (as Excel shows it, the
 * title row is row 1) and its cells by column key (see ImportColumn.key).
 * Only filled cells are listed: an empty cell, and a column the file does
 * not have, are both simply missing (the checks read them as empty).
 */
export type ImportRawRow = {
  excelRow: number
  values: Record<string, ImportCell>
  /**
   * Cells the .xlsx file itself flags, by column key (see addCellFlags in `@/lib/imports/check`):
   * a formula error such as "#N/A" (the cell is read as empty), or "date"
   * for a date cell in a column that is not a date (Excel turned e.g. 3-15
   * into a date). Missing when nothing is flagged.
   */
  flags?: Record<string, string>
}

/** The "date" flag of ImportRawRow.flags (formula errors start with "#"). */
export const IMPORT_DATE_CELL_FLAG = "date"

/**
 * What the browser sends to the Server Actions: the rows of each sheet,
 * by sheet key ("main" for a one-sheet import; "base" / "bundle" for 상품),
 * and the options of the screen.
 */
export type ImportInput = {
  sheets: Record<string, ImportRawRow[]>
  /**
   * "없는 분류는 자동으로 만들기" (상품, 거래처; default true). Ignored by
   * the other imports.
   */
  createMissingCategories?: boolean
  /**
   * One id (a UUID) per uploaded file, made by the screen. An import whose
   * database function keeps it (기초재고) saves a file once: the same
   * commit sent again (e.g. a retry after the answer was lost) returns what
   * it already registered instead of registering it twice. Ignored by the
   * other imports.
   */
  requestId?: string
}

/** 상태 of a row in the 미리보기. */
export type ImportRowStatus = "ok" | "error" | "skipped"

/** Korean label of each 상태: 정상, 오류, 건너뜀. */
export const IMPORT_ROW_STATUS_LABELS: Record<ImportRowStatus, string> = {
  ok: "정상",
  error: "오류",
  skipped: "건너뜀",
}

/** One message about a row: the column it belongs to (or null = the whole row). */
export type ImportIssue = {
  /** Column key (ImportColumn.key), or null for the row as a whole. */
  column: string | null
  message: string
}

/** The 미리보기 result of one row. */
export type ImportRowResult = {
  /** Sheet key ("main", "base", "bundle"). */
  sheet: string
  excelRow: number
  status: ImportRowStatus
  /** Why the row cannot be registered (status "error"). */
  errors: ImportIssue[]
  /** Notes that do not stop it (e.g. 같은 사업자번호가 이미 있음). */
  warnings: ImportIssue[]
  /**
   * Short note for the 상태 column, e.g. "이미 있음", "자동 0015",
   * "새 분류 2개", or null.
   */
  note: string | null
}

/** The 미리보기 of a whole file. */
export type ImportPreview = {
  /** Every data row, sheet by sheet, in file order. */
  rows: ImportRowResult[]
  total: number
  /** Rows that [정상 N건 등록] would register. */
  ok: number
  error: number
  /** Rows left out on purpose (상품분류 that already exist). */
  skipped: number
  /**
   * Categories the import would create, as paths ("가공식품 > 통조림"), in
   * file order (상품분류, 상품, 거래처).
   */
  newCategories: string[]
}

/** The key of a row in okRowKeys: "<sheet>:<excelRow>", e.g. "base:5". */
export function importRowKey(row: { sheet: string; excelRow: number }): string {
  return `${row.sheet}:${row.excelRow}`
}

/** What validate<Entity>Import returns. */
export type ImportValidateResult =
  { ok: true; preview: ImportPreview } | { ok: false; message: string }

/** What commit<Entity>Import returns. */
export type ImportCommitResult =
  | {
      ok: true
      /** Records registered (상품분류: categories created). */
      inserted: number
      /** Categories created on the way (상품, 거래처; 상품분류: same as inserted). */
      createdCategories: number
      /** Rows left out because they already existed (상품분류). */
      skipped: number
      /** The registered codes in file order (직원: incl. the automatic ones). */
      codes: string[]
      /**
       * The same file (requestId) had been registered before: nothing new
       * was registered, the result is that earlier registration.
       */
      alreadySaved?: boolean
      /** Korean summary for a toast, e.g. "상품 120건을 등록했습니다." */
      message: string
    }
  | {
      ok: false
      /** Korean message; nothing was registered. */
      message: string
      /**
       * A fresh 미리보기 when the file had to be checked again (the rows
       * found 정상 changed since the last 미리보기, e.g. someone registered
       * one of the codes meanwhile): show it instead of the old one.
       */
      preview?: ImportPreview
      /** The row the database refused (when it names one). */
      failedRow?: { sheet: string; excelRow: number; column: string | null }
    }

/**
 * HINT keys of the database's import functions
 * (supabase/migrations/*_bulk_import.sql). Change both places together.
 */
export const IMPORT_DB_RULES = {
  /** A row was refused; detail = JSON {sheet, excel_row, field, rule, reason}. */
  rowInvalid: "import_row_invalid",
  /** The request could not be read (not a list of rows). */
  rowsInvalid: "import_rows_invalid",
  /** Nothing to register. */
  rowsEmpty: "import_rows_empty",
  /** More than IMPORT_MAX_ROWS rows. */
  tooManyRows: "import_too_many_rows",
  /** A 분류 named in a row does not exist (and may not be created). */
  categoryNotFound: "import_category_not_found",
  /** A 분류 named in a row (or one above it) is 사용 중지. */
  categoryInactive: "import_category_inactive",
  /** A 분류 path that is not 1–3 names. */
  categoryInvalid: "import_category_invalid",
  /** A 영업담당 / 배송담당 직원코드 that no employee has. */
  employeeNotFound: "import_employee_not_found",
  /** 직원 without 휴대폰번호1. */
  employeeMobileRequired: "employee_mobile_required",
} as const
