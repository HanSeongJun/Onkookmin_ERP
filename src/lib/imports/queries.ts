import "server-only"

import type { PostgrestError } from "@supabase/supabase-js"
import { z } from "zod"

import { buildCategoryTree, type CategoryNode } from "@/lib/categories/tree"
import type { ExistingEmployee, ExistingPartner } from "@/lib/imports/partners"
import type { ExistingProduct } from "@/lib/imports/products"
import {
  buildPartnerCategoryTree,
  type PartnerCategoryNode,
} from "@/lib/partner-categories/tree"
import { createClient } from "@/lib/supabase/server"
import { Constants } from "@/types/database"

// The database reads of the 자료일괄등록 미리보기: one request per kind,
// with the file's codes in the request body (database functions
// import_find_*, supabase/migrations/*_bulk_import.sql). Each returns ONE
// JSON array, read with the zod schemas below (a set of rows would be cut
// off at 1,000 by the API). Every function reads request cookies (Supabase
// login): call them from Server Actions, never inside "use cache". They
// throw when the database cannot be read.

/**
 * Thrown when the database has no 자료일괄등록 functions yet (the migration
 * *_bulk_import.sql is not applied to it): the API answers PGRST202 for an
 * unknown function.
 */
export class ImportFunctionsMissingError extends Error {}

/** PostgREST's error code for a database function that does not exist. */
export const FUNCTION_NOT_FOUND_CODE = "PGRST202"

function rpcFailed(what: string, error: PostgrestError): Error {
  const message = `${what}: ${error.message}`
  return error.code === FUNCTION_NOT_FOUND_CODE
    ? new ImportFunctionsMissingError(message)
    : new Error(message)
}

const foundProductsSchema = z.array(
  z.object({
    code: z.string(),
    name: z.string(),
    product_type: z.enum(Constants.public.Enums.product_type),
    is_active: z.boolean(),
    barcode: z.string().nullable(),
  })
)

const foundPartnersSchema = z.array(
  z.object({
    code: z.string(),
    name: z.string(),
    business_number: z.string().nullable(),
  })
)

const foundEmployeesSchema = z.array(
  z.object({
    code: z.string(),
    name: z.string(),
    is_active: z.boolean(),
    is_sales_rep: z.boolean(),
    is_delivery_driver: z.boolean(),
    mobile: z.string().nullable().optional(),
  })
)

/** Products whose 상품코드 (ignoring case) or 바코드 is in the lists. */
export async function findProductsForImport(
  codes: string[],
  barcodes: string[]
): Promise<ExistingProduct[]> {
  if (codes.length === 0 && barcodes.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("import_find_products", {
    codes,
    barcodes,
  })
  if (error) throw rpcFailed("상품을 확인하지 못했습니다", error)
  return foundProductsSchema.parse(data).map((row) => ({
    code: row.code,
    name: row.name,
    productType: row.product_type,
    isActive: row.is_active,
    barcode: row.barcode,
  }))
}

/** Partners whose 거래처코드 (ignoring case) or 사업자번호 is in the lists. */
export async function findPartnersForImport(
  codes: string[],
  businessNumbers: string[]
): Promise<ExistingPartner[]> {
  if (codes.length === 0 && businessNumbers.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("import_find_partners", {
    codes,
    business_numbers: businessNumbers,
  })
  if (error) throw rpcFailed("거래처를 확인하지 못했습니다", error)
  return foundPartnersSchema.parse(data).map((row) => ({
    code: row.code,
    name: row.name,
    businessNumber: row.business_number,
  }))
}

/** Employees whose 직원코드 (ignoring case) or 직원명 is in the list. */
export async function findEmployeesForImport(
  codes: string[]
): Promise<ExistingEmployee[]> {
  if (codes.length === 0) return []
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("import_find_employees", { codes })
  if (error) throw rpcFailed("직원을 확인하지 못했습니다", error)
  return foundEmployeesSchema.parse(data).map((row) => ({
    code: row.code,
    name: row.name,
    isActive: row.is_active,
    isSalesRep: row.is_sales_rep,
    isDeliveryDriver: row.is_delivery_driver,
    mobile: row.mobile ?? null,
  }))
}

/**
 * The highest 직원코드 made only of digits, as text ("0" when there is
 * none): suggest_employee_code() − 1 (the same numbering import_employees
 * uses for rows without 직원코드).
 */
export async function getHighestNumericEmployeeCode(): Promise<string> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("suggest_employee_code")
  if (error) throw new Error(`직원코드를 확인하지 못했습니다: ${error.message}`)
  return /^\d+$/.test(data) ? (BigInt(data) - BigInt(1)).toString() : "0"
}

/** Rows per request when reading a whole table (the API's limit). */
const PAGE_SIZE = 1000

/**
 * Every row of a query, read page by page (the API returns at most 1,000
 * rows per request). `read(from, to)` reads rows from…to (0-based), in a
 * stable order.
 */
async function readAllRows<Row>(
  read: (
    from: number,
    to: number
  ) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
): Promise<Row[]> {
  const rows: Row[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await read(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if ((data ?? []).length < PAGE_SIZE) return rows
  }
}

/**
 * Every 상품분류 (사용 and 사용 중지) as a tree, for the import checks.
 * Unlike getCategoryTree it reads more than 1,000 categories (an import may
 * create many) and leaves the product counts at 0.
 */
export async function getProductCategoryTreeForImport(): Promise<
  CategoryNode[]
> {
  const supabase = await createClient()
  try {
    const rows = await readAllRows((from, to) =>
      supabase
        .from("product_categories")
        .select("id, name, parent_id, sort_order, is_active")
        .order("sort_order")
        .order("name")
        .order("id")
        .range(from, to)
    )
    return buildCategoryTree(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parent_id,
        sortOrder: row.sort_order,
        isActive: row.is_active,
        productCount: 0,
      })),
      { includeInactive: true }
    )
  } catch (error) {
    throw new Error(`상품분류를 불러오지 못했습니다: ${String(error)}`)
  }
}

/**
 * Every 거래처분류 (사용 and 사용 중지) as a tree, for the import checks
 * (more than 1,000 categories too; partner counts left at 0).
 */
export async function getPartnerCategoryTreeForImport(): Promise<
  PartnerCategoryNode[]
> {
  const supabase = await createClient()
  try {
    const rows = await readAllRows((from, to) =>
      supabase
        .from("partner_categories")
        .select("id, name, parent_id, sort_order, is_active")
        .order("sort_order")
        .order("name")
        .order("id")
        .range(from, to)
    )
    return buildPartnerCategoryTree(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parent_id,
        sortOrder: row.sort_order,
        isActive: row.is_active,
        partnerCount: 0,
      }))
    )
  } catch (error) {
    throw new Error(`거래처분류를 불러오지 못했습니다: ${String(error)}`)
  }
}
