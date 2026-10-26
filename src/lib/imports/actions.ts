"use server"

import type { PostgrestError } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireUser } from "@/lib/auth/user"
import {
  findImportColumn,
  findImportSheet,
  type ImportSpec,
} from "@/lib/imports/columns"
import {
  checkEmployeeImport,
  EMPLOYEE_IMPORT,
  employeeImportLookupKeys,
} from "@/lib/imports/employees"
import {
  checkOpeningStockImport,
  OPENING_STOCK_IMPORT,
  openingStockLookupKeys,
} from "@/lib/imports/opening-stock"
import {
  checkPartnerImport,
  PARTNER_IMPORT,
  partnerImportLookupKeys,
} from "@/lib/imports/partners"
import {
  checkProductCategoryImport,
  PRODUCT_CATEGORY_IMPORT,
} from "@/lib/imports/product-categories"
import {
  checkProductImport,
  PRODUCT_IMPORT,
  productImportLookupKeys,
} from "@/lib/imports/products"
import {
  findEmployeesForImport,
  findOpeningStockRefs,
  findPartnersForImport,
  findProductsForImport,
  FUNCTION_NOT_FOUND_CODE,
  getHighestNumericEmployeeCode,
  getPartnerCategoryTreeForImport,
  getProductCategoryTreeForImport,
  ImportFunctionsMissingError,
} from "@/lib/imports/queries"
import {
  IMPORT_CELL_MAX_CHARS,
  IMPORT_DB_RULES,
  IMPORT_MAX_ROWS,
  importRowKey,
  type ImportCommitResult,
  type ImportInput,
  type ImportPreview,
  type ImportValidateResult,
} from "@/lib/imports/types"
import { isScheduledDate } from "@/lib/inventory/constants"
import { todayInKorea } from "@/lib/inventory/schema"
import { createClient } from "@/lib/supabase/server"
import type { Json } from "@/types/database"

// Server Actions of the 자료일괄등록 screens (/imports/…). For each kind:
// - validate<Entity>Import(input): the 미리보기 — checks every row (the
//   등록 form's rules, rows against each other, the database) and returns
//   ImportValidateResult. Nothing is saved.
// - commit<Entity>Import(input, okRowKeys): checks again (never trust the
//   browser) and, when the 정상 rows are still the ones the 미리보기 showed
//   (okRowKeys = importRowKey of each 정상 row), registers them with ONE
//   database function: everything or nothing. Returns ImportCommitResult.
// `input` is what readImportFile gave the screen (ImportInput).

const READ_FAILED_MESSAGE =
  "파일 내용을 읽을 수 없습니다. 파일을 다시 선택해 주세요."
const CHECK_FAILED_MESSAGE =
  "등록할 내용을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요."
const CHANGED_MESSAGE =
  "미리보기를 만든 뒤에 바뀐 내용이 있어 다시 확인했습니다. 새 미리보기를 확인한 뒤 다시 등록해 주세요. (아직 아무것도 등록하지 않았습니다.)"
const NOTHING_TO_SAVE_MESSAGE =
  "등록할 정상 행이 없습니다. 오류를 고친 파일을 다시 올려 주세요."
// The database has no 자료일괄등록 functions yet (migration
// *_bulk_import.sql not applied, e.g. the hosted DB before `npm run db:push`).
const SETUP_MISSING_MESSAGE =
  "자료일괄등록에 필요한 데이터베이스 기능이 아직 반영되지 않았습니다. 관리자가 DB 변경(npm run db:push)을 반영한 뒤 다시 시도해 주세요. (아무것도 등록하지 않았습니다.)"

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

const importCellSchema = z.union([
  z.string().max(IMPORT_CELL_MAX_CHARS),
  z.number(),
  z.boolean(),
  z.null(),
])

const importInputSchema = z.object({
  sheets: z.record(
    z.string().max(20),
    z
      .array(
        z.object({
          excelRow: z.number().int().min(1).max(1_048_576),
          values: z.record(z.string().max(40), importCellSchema),
          flags: z.record(z.string().max(40), z.string().max(20)).optional(),
        })
      )
      // (parseInput counts the rows of all sheets: more than
      // IMPORT_MAX_ROWS gets its own message. The body size limit of the
      // Server Actions keeps this list small anyway.)
      .max(IMPORT_MAX_ROWS * 2)
  ),
  createMissingCategories: z.boolean().optional(),
  requestId: z.uuid().optional(),
})

/**
 * The request as the browser sent it, checked: only the spec's sheets,
 * at most IMPORT_MAX_ROWS rows, each Excel row once per sheet.
 */
function parseInput(
  spec: ImportSpec,
  input: unknown
): { ok: true; input: ImportInput } | { ok: false; message: string } {
  const parsed = importInputSchema.safeParse(input)
  if (!parsed.success) return { ok: false, message: READ_FAILED_MESSAGE }

  const sheets: ImportInput["sheets"] = {}
  let total = 0
  for (const sheet of spec.sheets) {
    const rows = parsed.data.sheets[sheet.key] ?? []
    if (new Set(rows.map((row) => row.excelRow)).size !== rows.length) {
      return { ok: false, message: READ_FAILED_MESSAGE }
    }
    sheets[sheet.key] = rows
    total += rows.length
  }
  if (total === 0) {
    return { ok: false, message: "등록할 행이 없습니다." }
  }
  if (total > IMPORT_MAX_ROWS) {
    return {
      ok: false,
      message: `한 번에 ${IMPORT_MAX_ROWS.toLocaleString("ko-KR")}행까지 올릴 수 있습니다. 파일을 나눠서 올려 주세요.`,
    }
  }
  return {
    ok: true,
    input: {
      sheets,
      createMissingCategories: parsed.data.createMissingCategories ?? true,
      requestId: parsed.data.requestId,
    },
  }
}

/** okRowKeys from the browser: up to IMPORT_MAX_ROWS short texts. */
const okRowKeysSchema = z.array(z.string().max(40)).max(IMPORT_MAX_ROWS)

/** Whether the 정상 rows are exactly the ones the browser expects. */
function sameOkRows(preview: ImportPreview, okRowKeys: unknown): boolean {
  const parsed = okRowKeysSchema.safeParse(okRowKeys)
  if (!parsed.success) return false
  const expected = new Set(parsed.data)
  const actual = preview.rows
    .filter((row) => row.status === "ok")
    .map(importRowKey)
  return (
    expected.size === actual.length && actual.every((key) => expected.has(key))
  )
}

// ---------------------------------------------------------------------------
// The checks of each kind (database reads + the shared check functions)
// ---------------------------------------------------------------------------

async function prepareProductCategories(input: ImportInput) {
  const categories = await getProductCategoryTreeForImport()
  return checkProductCategoryImport(input, { categories })
}

async function prepareProducts(input: ImportInput) {
  const keys = productImportLookupKeys(input)
  const [products, categories] = await Promise.all([
    findProductsForImport(keys.codes, keys.barcodes),
    getProductCategoryTreeForImport(),
  ])
  return checkProductImport(input, { products, categories })
}

async function preparePartners(input: ImportInput) {
  const keys = partnerImportLookupKeys(input)
  const [partners, employees, categories] = await Promise.all([
    findPartnersForImport(keys.codes, keys.businessNumbers),
    findEmployeesForImport(keys.employeeCodes),
    getPartnerCategoryTreeForImport(),
  ])
  return checkPartnerImport(input, { partners, employees, categories })
}

async function prepareEmployees(input: ImportInput) {
  const keys = employeeImportLookupKeys(input)
  const [employees, highestNumericCode] = await Promise.all([
    findEmployeesForImport(keys.codes),
    getHighestNumericEmployeeCode(),
  ])
  return checkEmployeeImport(input, { employees, highestNumericCode })
}

async function prepareOpeningStock(input: ImportInput) {
  const refs = await findOpeningStockRefs(openingStockLookupKeys(input))
  return checkOpeningStockImport(input, refs)
}

/** Runs a check; a database read that fails becomes a Korean message. */
async function runCheck<Result>(
  check: () => Promise<Result>
): Promise<{ ok: true; result: Result } | { ok: false; message: string }> {
  try {
    return { ok: true, result: await check() }
  } catch (error) {
    console.error("Could not check the import file:", error)
    if (error instanceof ImportFunctionsMissingError) {
      return { ok: false, message: SETUP_MISSING_MESSAGE }
    }
    return { ok: false, message: CHECK_FAILED_MESSAGE }
  }
}

/** validate<Entity>Import: parse, check, return the 미리보기. */
async function validate<Payload>(
  spec: ImportSpec,
  input: unknown,
  prepare: (
    input: ImportInput
  ) => Promise<{ preview: ImportPreview; payload: Payload }>
): Promise<ImportValidateResult> {
  await requireUser()
  const parsed = parseInput(spec, input)
  if (!parsed.ok) return parsed
  const checked = await runCheck(() => prepare(parsed.input))
  if (!checked.ok) return checked
  return { ok: true, preview: checked.result.preview }
}

/**
 * commit<Entity>Import: parse, check again, compare with the 미리보기, then
 * call the database function (`save`) with the 정상 rows.
 */
async function commit<Payload>(
  spec: ImportSpec,
  input: unknown,
  okRowKeys: unknown,
  prepare: (
    input: ImportInput
  ) => Promise<{ preview: ImportPreview; payload: Payload }>,
  save: (
    payload: Payload
  ) => Promise<{ data: Json | null; error: PostgrestError | null }>,
  done: (data: SavedCounts, preview: ImportPreview) => ImportCommitResult
): Promise<ImportCommitResult> {
  await requireUser()
  const parsed = parseInput(spec, input)
  if (!parsed.ok) return parsed
  const checked = await runCheck(() => prepare(parsed.input))
  if (!checked.ok) return checked
  const { preview, payload } = checked.result

  if (!sameOkRows(preview, okRowKeys)) {
    return { ok: false, message: CHANGED_MESSAGE, preview }
  }
  if (preview.ok === 0) {
    return { ok: false, message: NOTHING_TO_SAVE_MESSAGE, preview }
  }

  const { data, error } = await save(payload)
  if (error) return saveFailed(spec, error)
  return done(readSavedCounts(data), preview)
}

/** What the import functions return (see the migration). */
type SavedCounts = {
  /** 기초재고: the 전표번호 made. */
  docNo: string
  /** 기초재고: the 전표 date ("" when not returned). */
  docDate: string
  /** 기초재고: the same request had been saved before (nothing new). */
  alreadySaved: boolean
  inserted: number
  baseInserted: number
  bundleInserted: number
  createdCategories: number
  skipped: number
  codes: string[]
}

function readSavedCounts(data: Json | null): SavedCounts {
  const object =
    data && typeof data === "object" && !Array.isArray(data) ? data : {}
  const count = (key: string) => {
    const value = object[key]
    return typeof value === "number" ? value : 0
  }
  const codes = Array.isArray(object.codes)
    ? object.codes.filter((code): code is string => typeof code === "string")
    : []
  return {
    docNo: typeof object.doc_no === "string" ? object.doc_no : "",
    docDate: typeof object.doc_date === "string" ? object.doc_date : "",
    alreadySaved: object.already_saved === true,
    inserted: count("inserted"),
    baseInserted: count("base_inserted"),
    bundleInserted: count("bundle_inserted"),
    createdCategories: count("created_categories"),
    skipped: count("skipped"),
    codes,
  }
}

const number = (value: number) => value.toLocaleString("ko-KR")

// ---------------------------------------------------------------------------
// 상품분류 일괄등록
// ---------------------------------------------------------------------------

/** 미리보기 of a 상품분류 file. */
export async function validateProductCategoryImport(
  input: unknown
): Promise<ImportValidateResult> {
  return validate(PRODUCT_CATEGORY_IMPORT, input, prepareProductCategories)
}

/** Registers the 정상 rows of a 상품분류 file (database: import_product_categories). */
export async function commitProductCategoryImport(
  input: unknown,
  okRowKeys: unknown
): Promise<ImportCommitResult> {
  return commit(
    PRODUCT_CATEGORY_IMPORT,
    input,
    okRowKeys,
    prepareProductCategories,
    async (payload) => {
      const supabase = await createClient()
      return supabase.rpc("import_product_categories", { rows: payload.rows })
    },
    (saved, preview) => {
      revalidatePath("/products/categories")
      revalidatePath("/products")
      const skipped = preview.skipped
      return {
        ok: true,
        inserted: saved.inserted,
        createdCategories: saved.createdCategories,
        skipped,
        codes: [],
        message: `상품분류 ${number(saved.inserted)}개를 새로 만들었습니다.${skipped > 0 ? ` (이미 있는 ${number(skipped)}줄은 건너뛰었습니다.)` : ""}`,
      }
    }
  )
}

// ---------------------------------------------------------------------------
// 상품 일괄등록
// ---------------------------------------------------------------------------

/** 미리보기 of a 상품 file (기준상품 and 묶음상품 sheets). */
export async function validateProductImport(
  input: unknown
): Promise<ImportValidateResult> {
  return validate(PRODUCT_IMPORT, input, prepareProducts)
}

/** Registers the 정상 rows of a 상품 file (database: import_products). */
export async function commitProductImport(
  input: unknown,
  okRowKeys: unknown
): Promise<ImportCommitResult> {
  return commit(
    PRODUCT_IMPORT,
    input,
    okRowKeys,
    prepareProducts,
    async (payload) => {
      const supabase = await createClient()
      return supabase.rpc("import_products", {
        base_rows: payload.base_rows,
        bundle_rows: payload.bundle_rows,
        create_missing_categories: payload.create_missing_categories,
      })
    },
    (saved) => {
      revalidatePath("/products")
      revalidatePath("/products/categories")
      return {
        ok: true,
        inserted: saved.inserted,
        createdCategories: saved.createdCategories,
        skipped: 0,
        codes: saved.codes,
        message: `상품 ${number(saved.inserted)}건(기준상품 ${number(saved.baseInserted)}건, 묶음상품 ${number(saved.bundleInserted)}건)을 등록했습니다.${saved.createdCategories > 0 ? ` 새 상품분류 ${number(saved.createdCategories)}개도 만들었습니다.` : ""}`,
      }
    }
  )
}

// ---------------------------------------------------------------------------
// 거래처 일괄등록
// ---------------------------------------------------------------------------

/** 미리보기 of a 거래처 file. */
export async function validatePartnerImport(
  input: unknown
): Promise<ImportValidateResult> {
  return validate(PARTNER_IMPORT, input, preparePartners)
}

/** Registers the 정상 rows of a 거래처 file (database: import_partners). */
export async function commitPartnerImport(
  input: unknown,
  okRowKeys: unknown
): Promise<ImportCommitResult> {
  return commit(
    PARTNER_IMPORT,
    input,
    okRowKeys,
    preparePartners,
    async (payload) => {
      const supabase = await createClient()
      return supabase.rpc("import_partners", {
        rows: payload.rows,
        create_missing_categories: payload.create_missing_categories,
      })
    },
    (saved) => {
      revalidatePath("/(app)/partners", "layout")
      revalidatePath("/employees")
      return {
        ok: true,
        inserted: saved.inserted,
        createdCategories: saved.createdCategories,
        skipped: 0,
        codes: saved.codes,
        message: `거래처 ${number(saved.inserted)}건을 등록했습니다.${saved.createdCategories > 0 ? ` 새 거래처분류 ${number(saved.createdCategories)}개도 만들었습니다.` : ""}`,
      }
    }
  )
}

// ---------------------------------------------------------------------------
// 직원 일괄등록
// ---------------------------------------------------------------------------

/** 미리보기 of a 직원 file. */
export async function validateEmployeeImport(
  input: unknown
): Promise<ImportValidateResult> {
  return validate(EMPLOYEE_IMPORT, input, prepareEmployees)
}

/** Registers the 정상 rows of a 직원 file (database: import_employees). */
export async function commitEmployeeImport(
  input: unknown,
  okRowKeys: unknown
): Promise<ImportCommitResult> {
  return commit(
    EMPLOYEE_IMPORT,
    input,
    okRowKeys,
    prepareEmployees,
    async (payload) => {
      const supabase = await createClient()
      return supabase.rpc("import_employees", { rows: payload.rows })
    },
    (saved) => {
      revalidatePath("/employees")
      revalidatePath("/(app)/partners", "layout")
      return {
        ok: true,
        inserted: saved.inserted,
        createdCategories: 0,
        skipped: 0,
        codes: saved.codes,
        message: `직원 ${number(saved.inserted)}명을 등록했습니다.`,
      }
    }
  )
}

// ---------------------------------------------------------------------------
// 기초재고 일괄등록
// ---------------------------------------------------------------------------

/** 미리보기 of a 기초재고 file. */
export async function validateOpeningStockImport(
  input: unknown
): Promise<ImportValidateResult> {
  return validate(OPENING_STOCK_IMPORT, input, prepareOpeningStock)
}

/**
 * Registers the 정상 rows of a 기초재고 file as ONE 기초재고 전표 dated
 * today (database: import_opening_stock; all rows or none). `codes` are
 * the lots' 로트번호 in file order. A file is registered once per
 * `input.requestId` (one per uploaded file): sent again, the result is the
 * earlier 전표 (`alreadySaved`), and nothing is registered twice.
 */
export async function commitOpeningStockImport(
  input: unknown,
  okRowKeys: unknown
): Promise<ImportCommitResult> {
  await requireUser()
  // The same file sent again (a retry after the answer was lost): its 전표,
  // without checking the rows again (they would now find their own lots).
  const requestId = readRequestId(input)
  if (requestId) {
    const earlier = await findSavedOpeningStock(requestId)
    if (earlier) return earlier
  }
  return commit(
    OPENING_STOCK_IMPORT,
    input,
    okRowKeys,
    prepareOpeningStock,
    async (payload) => {
      const supabase = await createClient()
      return supabase.rpc("import_opening_stock", {
        rows: payload.rows,
        request_id: requestId ?? undefined,
      })
    },
    (saved) => {
      revalidatePath("/(app)/inventory", "layout")
      revalidatePath("/")
      return {
        ok: true,
        inserted: saved.inserted,
        createdCategories: 0,
        skipped: 0,
        codes: saved.codes,
        alreadySaved: saved.alreadySaved,
        message: saved.alreadySaved
          ? alreadySavedMessage(saved.docNo, saved.inserted)
          : `기초재고 ${number(saved.inserted)}건을 등록했습니다.${saved.docNo ? ` (전표번호 ${saved.docNo})` : ""}${
              isScheduledDate(saved.docDate, todayInKorea())
                ? ` 입고일이 오늘 이후라 ${saved.docDate} 날짜의 예정 기초재고로 등록했습니다. 이 재고는 그 날짜부터 출고할 수 있습니다.`
                : ""
            }`,
      }
    }
  )
}

/** The requestId of an import input, when it is a UUID. */
function readRequestId(input: unknown): string | null {
  if (!input || typeof input !== "object") return null
  const value = (input as { requestId?: unknown }).requestId
  const parsed = z.uuid().safeParse(value)
  return parsed.success ? parsed.data.toLowerCase() : null
}

function alreadySavedMessage(docNo: string, inserted: number): string {
  return `이 파일은 이미 등록되었습니다 (전표번호 ${docNo}, ${number(inserted)}건). 다시 등록하지 않았습니다.`
}

/**
 * The 기초재고 전표 an earlier commit of the same file (requestId) made,
 * as a commit result; null when there is none (or it cannot be read: then
 * the database function's own check still saves the file once).
 */
async function findSavedOpeningStock(
  requestId: string
): Promise<ImportCommitResult | null> {
  const supabase = await createClient()
  const { data: document, error } = await supabase
    .from("stock_documents")
    .select("id, doc_no")
    .eq("request_id", requestId)
    .eq("doc_type", "opening")
    .maybeSingle()
  if (error || !document) return null
  const { data: lines } = await supabase
    .from("stock_movement_items")
    .select("lot_no")
    .eq("document_id", document.id)
    .order("seq")
    .limit(IMPORT_MAX_ROWS)
  const codes = (lines ?? []).flatMap((line) =>
    line.lot_no ? [line.lot_no] : []
  )
  return {
    ok: true,
    inserted: codes.length,
    createdCategories: 0,
    skipped: 0,
    codes,
    alreadySaved: true,
    message: alreadySavedMessage(document.doc_no, codes.length),
  }
}

// ---------------------------------------------------------------------------
// Database errors
// ---------------------------------------------------------------------------

/** The detail JSON of a row the database refused (hint import_row_invalid). */
const rowErrorDetailSchema = z.object({
  sheet: z.string().nullable().optional(),
  excel_row: z.number().nullable().optional(),
  field: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
})

const NOTHING_SAVED = "아무것도 등록하지 않았습니다."

/** Turns a database error of an import function into Korean text. */
function saveFailed(
  spec: ImportSpec,
  error: PostgrestError
): ImportCommitResult {
  if (error.hint === IMPORT_DB_RULES.rowInvalid) {
    let detail: z.infer<typeof rowErrorDetailSchema> | null = null
    try {
      const parsed = rowErrorDetailSchema.safeParse(
        JSON.parse(error.details ?? "")
      )
      detail = parsed.success ? parsed.data : null
    } catch {
      detail = null
    }
    if (detail?.excel_row) {
      const sheetKey = detail.sheet ?? spec.sheets[0].key
      const sheet = findImportSheet(spec, sheetKey) ?? spec.sheets[0]
      const columnKey =
        detail.field === "category" ? "categoryMajor" : (detail.field ?? null)
      const column = columnKey ? findImportColumn(sheet, columnKey) : undefined
      const where = `${spec.sheets.length > 1 ? `${sheet.sheetName} 시트 ` : "엑셀 "}${detail.excel_row}행${
        detail.field === "category"
          ? " ‘분류’"
          : column
            ? ` ‘${column.header}’`
            : ""
      }`
      return {
        ok: false,
        message: `${where}: ${detail.reason ?? error.message} ${NOTHING_SAVED} 파일을 고친 뒤 다시 올려 주세요.`,
        failedRow: {
          sheet: sheet.key,
          excelRow: detail.excel_row,
          column: column ? column.key : null,
        },
      }
    }
    return { ok: false, message: `${error.message} ${NOTHING_SAVED}` }
  }

  switch (error.hint) {
    case IMPORT_DB_RULES.rowsInvalid:
    case IMPORT_DB_RULES.rowsEmpty:
    case IMPORT_DB_RULES.tooManyRows:
      return { ok: false, message: error.message }
  }

  if (error.code === FUNCTION_NOT_FOUND_CODE) {
    console.error("Could not import:", error)
    return { ok: false, message: SETUP_MISSING_MESSAGE }
  }
  // Two saves touching the same rows at the same moment, or a lock that
  // did not come free in time: nothing was saved, trying again works.
  if (["40001", "40P01", "55P03"].includes(error.code)) {
    return {
      ok: false,
      message: `다른 직원이 같은 자료를 동시에 저장하고 있어 등록하지 못했습니다. ${NOTHING_SAVED} 잠시 후 다시 등록해 주세요.`,
    }
  }
  // 57014 = the database stopped a request that took too long.
  if (error.code === "57014") {
    return {
      ok: false,
      message: `등록하는 데 시간이 너무 오래 걸려 멈췄습니다. ${NOTHING_SAVED} 파일을 나눠서(예: 1,000행씩) 올려 주세요.`,
    }
  }
  if (error.code === "42501") {
    return {
      ok: false,
      message: `등록할 권한이 없습니다. 다시 로그인해 주세요. ${NOTHING_SAVED}`,
    }
  }
  // Rules checked when the transaction ends (e.g. 기본 배송지) carry their
  // own Korean message and a hint.
  if (error.hint) {
    return { ok: false, message: `${error.message} ${NOTHING_SAVED}` }
  }

  console.error("Could not import:", error)
  return {
    ok: false,
    message: `등록하지 못했습니다. ${NOTHING_SAVED} 잠시 후 다시 시도해 주세요.`,
  }
}
