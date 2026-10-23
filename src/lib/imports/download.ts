/**
 * 자료일괄등록: saving the Excel files in the browser — the template
 * ([양식 다운로드]) and the 오류 목록 ([오류 목록 엑셀로 받기]). The sheets
 * come from `@/lib/imports/workbook`; write-excel-file builds the .xlsx
 * file and the browser saves it.
 *
 * Browser only: call these from Client Components (event handlers).
 */

import type { ImportFileSheet, ImportSpec } from "@/lib/imports/columns"
import type { ImportPreview } from "@/lib/imports/types"
import {
  buildErrorSheets,
  buildTemplateSheets,
  type WorkbookSheet,
} from "@/lib/imports/workbook"
import { formatDate } from "@/lib/format"

/** Font of the files (the usual Korean font of Excel on Windows). */
const FONT = { fontFamily: "맑은 고딕", fontSize: 10 }

async function saveWorkbook(sheets: WorkbookSheet[], fileName: string) {
  // Loaded only when a file is saved, so the screens load faster.
  const { default: writeExcelFile } = await import("write-excel-file/browser")
  await writeExcelFile(sheets, FONT).toFile(fileName)
}

/** Saves the [양식 다운로드] template, e.g. "상품_일괄등록_양식.xlsx". */
export async function downloadImportTemplate(spec: ImportSpec): Promise<void> {
  await saveWorkbook(buildTemplateSheets(spec), spec.templateFileName)
}

/**
 * Saves the 오류 rows of a 미리보기 as "<상품>_오류목록_YYYYMMDD.xlsx"
 * (date in Korea time). Returns how many rows it holds (0 = nothing saved).
 */
export async function downloadImportErrors(
  spec: ImportSpec,
  sheets: Record<string, ImportFileSheet>,
  preview: ImportPreview
): Promise<number> {
  const errorSheets = buildErrorSheets(spec, sheets, preview)
  const rows = errorSheets.reduce(
    (sum, sheet) => sum + sheet.data.length - 1,
    0
  )
  if (rows === 0) return 0
  const date = formatDate(new Date()).replace(/-/g, "")
  await saveWorkbook(errorSheets, `${spec.entityLabel}_오류목록_${date}.xlsx`)
  return rows
}
