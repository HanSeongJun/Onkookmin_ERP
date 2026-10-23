/**
 * 자료일괄등록: every import's spec by kind (the page address
 * /imports/<kind>), in the sidebar's order. No server imports: Client
 * Components use this file too.
 */

import type { ImportSpec } from "@/lib/imports/columns"
import { EMPLOYEE_IMPORT } from "@/lib/imports/employees"
import { PARTNER_IMPORT } from "@/lib/imports/partners"
import { PRODUCT_CATEGORY_IMPORT } from "@/lib/imports/product-categories"
import { PRODUCT_IMPORT } from "@/lib/imports/products"
import type { ImportKind } from "@/lib/imports/types"

export const IMPORT_SPECS: Record<ImportKind, ImportSpec> = {
  "product-categories": PRODUCT_CATEGORY_IMPORT,
  products: PRODUCT_IMPORT,
  partners: PARTNER_IMPORT,
  employees: EMPLOYEE_IMPORT,
}

/** The kinds in the sidebar's order (자료일괄등록 group). */
export const IMPORT_KINDS: readonly ImportKind[] = [
  "product-categories",
  "products",
  "partners",
  "employees",
]

/** The page address of an import, e.g. "/imports/products". */
export function importHref(kind: ImportKind): string {
  return `/imports/${kind}`
}
