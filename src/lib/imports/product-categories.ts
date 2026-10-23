/**
 * 상품분류 일괄등록 (/imports/product-categories): one row = one 분류 path
 * (대분류 > 중분류 > 소분류). Missing levels are created, levels that
 * exist are reused (never changed); a row whose whole path exists already
 * is 건너뜀 (이미 있음).
 *
 * The spec (columns, template examples) and the check of a file. No server
 * imports: Client Components use this file too.
 */

import { categoryNameSchema } from "@/lib/categories/schema"
import {
  addCellFlags,
  buildPreview,
  CategoryPlanner,
  readCategoryPath,
  RowIssues,
  type NamedCategoryNode,
} from "@/lib/imports/check"
import { MAIN_SHEET, type ImportSpec } from "@/lib/imports/columns"
import type {
  ImportInput,
  ImportPreview,
  ImportRowResult,
} from "@/lib/imports/types"
import {
  choiceLabels,
  matchChoice,
  NO_WORDS,
  YES_WORDS,
  type ImportChoice,
} from "@/lib/imports/values"

/** 사용여부 of 상품 and 상품분류: 사용 / 사용중지 (also Y/N …). */
export const PRODUCT_STATUS_CHOICES: readonly ImportChoice<boolean>[] = [
  { value: true, label: "사용", aliases: [...YES_WORDS, "사용중"] },
  {
    value: false,
    label: "사용중지",
    aliases: [...NO_WORDS, "미사용", "중지", "사용안함"],
  },
]

const CATEGORY_NAME_FORMAT = "글자 1~30자"

export const PRODUCT_CATEGORY_IMPORT: ImportSpec = {
  kind: "product-categories",
  title: "상품분류 일괄등록",
  entityLabel: "상품분류",
  templateFileName: "상품분류_일괄등록_양식.xlsx",
  listHref: "/products/categories",
  listLabel: "상품분류설정",
  hasCategoryOption: false,
  instructions: [
    "‘상품분류’ 시트의 2행부터 한 줄에 분류 하나씩(대분류 > 중분류 > 소분류 경로) 적어 주세요. 첫 줄(열 이름)은 지우거나 바꾸지 마세요.",
    "없는 분류만 새로 만들고, 이미 있는 분류는 그대로 둡니다. 경로 전체가 이미 있는 줄은 ‘건너뜀(이미 있음)’으로 표시됩니다.",
    "대분류만 적으면 대분류만, 대분류와 중분류를 적으면 중분류까지 만듭니다. 소분류를 적으려면 중분류도 적어야 합니다.",
    "같은 상위 분류 안에서는 같은 이름을 두 번 쓸 수 없습니다. 이름이 같으면 같은 분류로 봅니다.",
    "‘예시’ 시트는 작성 예입니다. 등록되지 않습니다.",
    "엑셀(.xlsx) 또는 CSV 파일을 올릴 수 있고, 한 번에 3,000행까지 올릴 수 있습니다.",
  ],
  sheets: [
    {
      key: MAIN_SHEET,
      sheetName: "상품분류",
      columns: [
        {
          key: "major",
          header: "대분류",
          required: true,
          format: CATEGORY_NAME_FORMAT,
          help: "가장 위 단계의 분류. 예: 가공식품",
          width: 20,
          textFormat: true,
        },
        {
          key: "middle",
          header: "중분류",
          required: false,
          format: CATEGORY_NAME_FORMAT,
          help: "대분류 아래 분류. 비우면 대분류만 만듭니다.",
          width: 20,
          textFormat: true,
        },
        {
          key: "minor",
          header: "소분류",
          required: false,
          format: CATEGORY_NAME_FORMAT,
          help: "중분류 아래 분류. 중분류가 있어야 적을 수 있습니다.",
          width: 20,
          textFormat: true,
        },
        {
          key: "isActive",
          header: "사용여부",
          required: false,
          format: "사용 또는 사용중지",
          allowed: `${choiceLabels(PRODUCT_STATUS_CHOICES)} (비우면 사용)`,
          help: "새로 만드는 맨 아래 분류에만 적용됩니다. 이미 있는 분류의 사용여부는 바꾸지 않습니다.",
          width: 12,
          textFormat: true,
        },
      ],
      examples: [
        {
          major: "가공식품",
          middle: "통조림",
          minor: "참치캔",
          isActive: "사용",
        },
        {
          major: "가공식품",
          middle: "통조림",
          minor: "햄캔",
          isActive: "사용",
        },
        { major: "농산물", middle: "채소", minor: "", isActive: "사용" },
      ],
    },
  ],
}

/** What the database knows for the check: the whole 상품분류 tree. */
export type ProductCategoryImportLookups = {
  /** Every 상품분류 (사용 and 사용 중지), as getCategoryTree returns it. */
  categories: readonly NamedCategoryNode[]
}

/** The argument of the database function import_product_categories. */
export type ProductCategoryImportPayload = {
  rows: { excel_row: number; path: string[]; is_active: boolean }[]
}

/**
 * Checks every row of a 상품분류 file: the names (분류 name rule), the
 * 사용여부, and the path against the saved tree and the rows above it.
 * Returns the 미리보기 and the 정상 rows for import_product_categories.
 */
export function checkProductCategoryImport(
  input: ImportInput,
  lookups: ProductCategoryImportLookups
): { preview: ImportPreview; payload: ProductCategoryImportPayload } {
  const planner = new CategoryPlanner(lookups.categories, {
    createMissing: true,
    allowInactive: true,
    settingsName: "상품분류설정",
    entityLabel: "분류",
  })
  const savedActive = new Map<string, boolean>()
  const walk = (nodes: readonly NamedCategoryNode[], above: string[]) => {
    for (const node of nodes) {
      const names = [...above, node.name]
      savedActive.set(names.join("\u001f"), node.isActive)
      walk(node.children, names)
    }
  }
  walk(lookups.categories, [])
  // 사용여부 of the categories the file's rows create (the last level gets
  // the row's 사용여부, the levels above it 사용).
  const plannedActive = new Map<string, boolean>()

  const results: ImportRowResult[] = []
  const payload: ProductCategoryImportPayload = { rows: [] }

  for (const row of input.sheets[MAIN_SHEET] ?? []) {
    const issues = new RowIssues()
    addCellFlags(issues, row)
    const names = readCategoryPath(
      row.values,
      { major: "major", middle: "middle", minor: "minor" },
      categoryNameSchema,
      issues
    )
    if (names === null && !issues.hasErrors) {
      issues.error("major", "대분류를 입력해 주세요.")
    }
    const isActive = matchChoice(row.values.isActive, PRODUCT_STATUS_CHOICES)
    if (isActive === undefined) {
      issues.error(
        "isActive",
        `사용여부는 ${choiceLabels(PRODUCT_STATUS_CHOICES)} 중 하나로 입력해 주세요. (비우면 사용)`
      )
    }

    if (issues.hasErrors || names === null || isActive === undefined) {
      results.push({
        sheet: MAIN_SHEET,
        excelRow: row.excelRow,
        status: "error",
        errors: issues.errors,
        warnings: issues.warnings,
        note: null,
      })
      continue
    }

    const active = isActive ?? true
    const check = planner.check(names)
    if (!check.ok) {
      // (Only when the rules of CategoryPlanner change; kept for safety.)
      issues.error("major", check.message)
      results.push({
        sheet: MAIN_SHEET,
        excelRow: row.excelRow,
        status: "error",
        errors: issues.errors,
        warnings: issues.warnings,
        note: null,
      })
      continue
    }
    if (check.exists) {
      const saved = savedActive.get(names.join("\u001f"))
      const planned = plannedActive.get(names.join("\u001f"))
      if (saved !== undefined && saved !== active) {
        issues.warn(
          "isActive",
          `이미 있는 분류라 사용여부는 바꾸지 않습니다. (지금: ${saved ? "사용" : "사용중지"})`
        )
      } else if (planned !== undefined && planned !== active) {
        issues.warn(
          "isActive",
          `파일 안 ${check.plannedBy}행에서 먼저 만드는 분류라 ‘${planned ? "사용" : "사용중지"}’(으)로 만들어집니다. 이 행의 사용여부는 적용되지 않습니다.`
        )
      }
      results.push({
        sheet: MAIN_SHEET,
        excelRow: row.excelRow,
        status: "skipped",
        errors: [],
        warnings: issues.warnings,
        note:
          check.plannedBy === null
            ? "이미 있음"
            : `파일 안 ${check.plannedBy}행과 같음`,
      })
      continue
    }

    planner.accept(names, row.excelRow)
    names.forEach((_, index) => {
      const key = names.slice(0, index + 1).join("\u001f")
      if (savedActive.has(key) || plannedActive.has(key)) return
      plannedActive.set(key, index === names.length - 1 ? active : true)
    })
    payload.rows.push({
      excel_row: row.excelRow,
      path: names,
      is_active: active,
    })
    results.push({
      sheet: MAIN_SHEET,
      excelRow: row.excelRow,
      status: "ok",
      errors: [],
      warnings: issues.warnings,
      note: `새 분류 ${check.created.length}개`,
    })
  }

  return { preview: buildPreview(results, planner.created), payload }
}
