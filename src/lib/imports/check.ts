/**
 * 자료일괄등록: small building blocks the entity checks share — collecting
 * the messages of a row, turning zod issues into cell messages, finding
 * duplicates inside the file, 분류 paths, and the 미리보기 totals.
 *
 * No server imports: Client Components use this file too.
 */

import type { z } from "zod"

import { cellText } from "@/lib/imports/values"
import {
  IMPORT_DATE_CELL_FLAG,
  type ImportCell,
  type ImportIssue,
  type ImportPreview,
  type ImportRawRow,
  type ImportRowResult,
} from "@/lib/imports/types"

// ---------------------------------------------------------------------------
// Messages of one row
// ---------------------------------------------------------------------------

/**
 * The messages of one row while it is checked. At most one error per
 * column: the first one found is kept (it is usually the clearest).
 */
export class RowIssues {
  readonly errors: ImportIssue[] = []
  readonly warnings: ImportIssue[] = []

  /** Adds an error, unless the column already has one. */
  error(column: string | null, message: string): void {
    if (
      column !== null &&
      this.errors.some((issue) => issue.column === column)
    ) {
      return
    }
    this.errors.push({ column, message })
  }

  warn(column: string | null, message: string): void {
    this.warnings.push({ column, message })
  }

  get hasErrors(): boolean {
    return this.errors.length > 0
  }

  /** Whether this column has an error already. */
  hasError(column: string): boolean {
    return this.errors.some((issue) => issue.column === column)
  }
}

/**
 * Adds what the file itself flags about a row's cells (ImportRawRow.flags):
 * a formula error (#N/A, #REF! …) is an error of its column (the cell was
 * read as empty, which would silently drop e.g. a 영업담당); a date cell in
 * a column that is not a date is a note (Excel turns e.g. 3-15 into a
 * date). Call it first, so its message is the one shown for the column.
 */
export function addCellFlags(issues: RowIssues, raw: ImportRawRow): void {
  for (const [column, flag] of Object.entries(raw.flags ?? {})) {
    if (flag.startsWith("#")) {
      issues.error(
        column,
        `엑셀 수식 오류(${flag})가 난 칸입니다. 엑셀에서 수식을 고치거나 값을 직접 입력해 주세요.`
      )
    } else if (flag === IMPORT_DATE_CELL_FLAG) {
      issues.warn(
        column,
        `엑셀에 날짜로 저장된 칸이라 ‘${cellText(raw.values[column])}’(으)로 읽었습니다. 날짜가 아니라면(예: 3-15) 칸 서식을 ‘텍스트’로 바꾸고 다시 입력해 주세요.`
      )
    }
  }
}

/**
 * Adds the issues of a failed zod check to a row. `fields` maps the form's
 * field names (or "contacts.0.name"-style paths) to column keys; an issue of
 * an unknown field becomes a message for the whole row.
 */
export function addZodIssues(
  issues: RowIssues,
  error: z.ZodError,
  fields: Record<string, string>
): void {
  for (const issue of error.issues) {
    const path = issue.path.map(String)
    const column = fields[path.join(".")] ?? fields[path[0] ?? ""] ?? null
    issues.error(column, issue.message)
  }
}

/** The 미리보기 result of a row from its messages. */
export function rowResult(
  sheet: string,
  excelRow: number,
  issues: RowIssues,
  note: string | null = null
): ImportRowResult {
  return {
    sheet,
    excelRow,
    status: issues.hasErrors ? "error" : "ok",
    errors: issues.errors,
    warnings: issues.warnings,
    note,
  }
}

/** The 미리보기 of all rows with its totals. */
export function buildPreview(
  rows: ImportRowResult[],
  newCategories: string[] = []
): ImportPreview {
  return {
    rows,
    total: rows.length,
    ok: rows.filter((row) => row.status === "ok").length,
    error: rows.filter((row) => row.status === "error").length,
    skipped: rows.filter((row) => row.status === "skipped").length,
    newCategories,
  }
}

// ---------------------------------------------------------------------------
// Duplicates inside the file
// ---------------------------------------------------------------------------

/** Where a value appears in the file: "기준상품 시트 5행" or "5행". */
export type RowPlace = { sheetLabel: string | null; excelRow: number }

/** "기준상품 시트 5행" / "5행". */
export function placeText(place: RowPlace): string {
  return place.sheetLabel
    ? `${place.sheetLabel} 시트 ${place.excelRow}행`
    : `${place.excelRow}행`
}

/**
 * Finds values used by more than one row (compared with `normalize`, e.g.
 * lower case for codes). Returns, for every row that shares its value with
 * another, the OTHER places, so each message can name them.
 */
export function findDuplicates<Row>(
  rows: readonly Row[],
  valueOf: (row: Row) => string | null,
  placeOf: (row: Row) => RowPlace,
  normalize: (value: string) => string = (value) => value
): Map<Row, RowPlace[]> {
  const byValue = new Map<string, Row[]>()
  for (const row of rows) {
    const value = valueOf(row)
    if (value === null || value === "") continue
    const key = normalize(value)
    byValue.set(key, [...(byValue.get(key) ?? []), row])
  }
  const result = new Map<Row, RowPlace[]>()
  for (const group of byValue.values()) {
    if (group.length < 2) continue
    for (const row of group) {
      result.set(row, group.filter((other) => other !== row).map(placeOf))
    }
  }
  return result
}

/** "5행, 9행" (at most `max`, then "외 N곳"). */
export function placesText(places: readonly RowPlace[], max = 3): string {
  const shown = places.slice(0, max).map(placeText).join(", ")
  return places.length > max ? `${shown} 외 ${places.length - max}곳` : shown
}

/** Codes are compared ignoring upper/lower case ("a001" = "A001"). */
export function codeKey(code: string): string {
  return code.toLowerCase()
}

// ---------------------------------------------------------------------------
// 분류 (대분류 / 중분류 / 소분류 by name)
// ---------------------------------------------------------------------------

/** A category tree as both 분류 trees have it (상품분류, 거래처분류). */
export type NamedCategoryNode = {
  name: string
  isActive: boolean
  children: readonly NamedCategoryNode[]
}

/** Separator of the names in a path key (a character no name contains). */
const PATH_SEPARATOR = "\u001f"

function pathKey(names: readonly string[]): string {
  return names.join(PATH_SEPARATOR)
}

/** "가공식품 > 통조림". */
export function pathText(names: readonly string[]): string {
  return names.join(" > ")
}

/**
 * Reads the 대분류 / 중분류 / 소분류 cells of a row. Each name is checked
 * with `nameSchema` (the 분류 name rule: trimmed, NFC, 1–30 characters).
 * Returns the names from the 대분류 down (null when all three are empty),
 * or null after adding the problems to `issues`:
 * - 중분류 without 대분류, 소분류 without 중분류.
 */
export function readCategoryPath(
  values: Record<string, ImportCell>,
  columns: { major: string; middle: string; minor: string },
  nameSchema: z.ZodType<string, string>,
  issues: RowIssues
): string[] | null {
  const levels = [
    {
      key: columns.major,
      label: "대분류",
      text: cellText(values[columns.major]),
    },
    {
      key: columns.middle,
      label: "중분류",
      text: cellText(values[columns.middle]),
    },
    {
      key: columns.minor,
      label: "소분류",
      text: cellText(values[columns.minor]),
    },
  ]
  if (levels.every((level) => level.text === "")) return null

  const names: string[] = []
  let failed = false
  for (let index = 0; index < levels.length; index++) {
    const level = levels[index]
    if (level.text === "") {
      const below = levels.slice(index + 1).find((other) => other.text !== "")
      if (below) {
        issues.error(
          level.key,
          `${below.label}를 적으려면 ${level.label}도 적어 주세요.`
        )
        failed = true
      }
      break
    }
    const parsed = nameSchema.safeParse(level.text)
    if (!parsed.success) {
      issues.error(
        level.key,
        `${level.label}: ${parsed.error.issues[0]?.message ?? "분류 이름을 확인해 주세요."}`
      )
      failed = true
      continue
    }
    names.push(parsed.data)
  }
  return failed ? null : names
}

/** What a category path means for one row. */
export type CategoryPathCheck =
  | {
      ok: true
      /** Levels the import creates for this row ("가공식품 > 통조림"). */
      created: string[]
      /** The whole path exists already (in the database or planned). */
      exists: boolean
      /** Excel row that first planned this exact path (null = database). */
      plannedBy: number | null
    }
  | { ok: false; message: string }

/**
 * Checks 분류 paths of a file against the saved tree, remembering the
 * categories the file's 정상 rows will create (in file order). Call
 * `check` for a row, then `accept` once the row turned out 정상.
 */
export type CategoryPlannerOptions = {
  /** "없는 분류는 자동으로 만들기". */
  createMissing: boolean
  /**
   * Whether a switched-off category (or one below it) may be used: false
   * for 상품/거래처 (nothing new goes into it), true for the 상품분류
   * import (new sub-categories are fine).
   */
  allowInactive: boolean
  /** 상품분류설정 / 거래처분류설정: named in messages. */
  settingsName: string
  /** "상품" / "거래처": what is put into the category. */
  entityLabel: string
}

export class CategoryPlanner {
  private readonly saved = new Map<string, boolean>()
  private readonly planned = new Map<string, number>()
  private readonly options: CategoryPlannerOptions
  readonly created: string[] = []

  constructor(
    tree: readonly NamedCategoryNode[],
    options: CategoryPlannerOptions
  ) {
    this.options = options
    const walk = (nodes: readonly NamedCategoryNode[], above: string[]) => {
      for (const node of nodes) {
        const names = [...above, node.name]
        this.saved.set(pathKey(names), node.isActive)
        walk(node.children, names)
      }
    }
    walk(tree, [])
  }

  /** Checks a path (1–3 names from the 대분류 down). */
  check(names: readonly string[]): CategoryPathCheck {
    const created: string[] = []
    for (let level = 1; level <= names.length; level++) {
      const levelNames = names.slice(0, level)
      const key = pathKey(levelNames)
      const savedActive = this.saved.get(key)
      if (savedActive !== undefined) {
        if (!savedActive && !this.options.allowInactive) {
          return {
            ok: false,
            message: `분류 ‘${pathText(levelNames)}’은(는) 사용 중지되어 있어 ${this.options.entityLabel}을(를) 넣을 수 없습니다. ${this.options.settingsName}에서 사용으로 바꾸거나 다른 분류를 적어 주세요.`,
          }
        }
        continue
      }
      if (this.planned.has(key)) continue
      if (!this.options.createMissing) {
        return {
          ok: false,
          message: `분류 ‘${pathText(levelNames)}’이(가) 없습니다. ${this.options.settingsName}에서 먼저 만들거나 ‘없는 분류는 자동으로 만들기’를 켜 주세요.`,
        }
      }
      created.push(pathText(levelNames))
    }
    const key = pathKey(names)
    return {
      ok: true,
      created,
      exists: created.length === 0,
      plannedBy: this.saved.has(key) ? null : (this.planned.get(key) ?? null),
    }
  }

  /** Remembers the categories a 정상 row creates. */
  accept(names: readonly string[], excelRow: number): void {
    for (let level = 1; level <= names.length; level++) {
      const levelNames = names.slice(0, level)
      const key = pathKey(levelNames)
      if (this.saved.has(key) || this.planned.has(key)) continue
      this.planned.set(key, excelRow)
      this.created.push(pathText(levelNames))
    }
  }
}
