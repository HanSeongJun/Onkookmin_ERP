import type { Metadata } from "next"

import { ImportPage } from "@/components/erp/import/import-page"
import {
  commitProductCategoryImport,
  validateProductCategoryImport,
} from "@/lib/imports/actions"
import { PRODUCT_CATEGORY_IMPORT } from "@/lib/imports/product-categories"

export const metadata: Metadata = {
  title: PRODUCT_CATEGORY_IMPORT.title,
}

/**
 * "/imports/product-categories": 상품분류 일괄등록 (sidebar: 자료일괄등록 →
 * 상품분류 일괄등록). One row = one 대분류 > 중분류 > 소분류 path; missing
 * levels are created, existing ones are reused (a row whose whole path
 * exists is 건너뜀). Categories are changed in 상품분류설정.
 */
export default function ProductCategoryImportPage() {
  return (
    <ImportPage
      spec={PRODUCT_CATEGORY_IMPORT}
      description="엑셀 파일로 상품분류(대분류 > 중분류 > 소분류)를 한 번에 만듭니다. 이미 있는 분류는 그대로 둡니다."
      validate={validateProductCategoryImport}
      commit={commitProductCategoryImport}
    />
  )
}
