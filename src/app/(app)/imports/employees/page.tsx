import type { Metadata } from "next"

import { ImportPage } from "@/components/erp/import/import-page"
import {
  commitEmployeeImport,
  validateEmployeeImport,
} from "@/lib/imports/actions"
import { EMPLOYEE_IMPORT } from "@/lib/imports/employees"

export const metadata: Metadata = {
  title: EMPLOYEE_IMPORT.title,
}

/**
 * "/imports/employees": 직원 일괄등록 (sidebar: 자료일괄등록 → 직원
 * 일괄등록). Registers many 직원 (판매 플랫폼·배송 기사 too) from an Excel
 * or CSV file; a blank 직원코드 gets the next number. Registration only:
 * existing 직원 are changed in 직원관리.
 */
export default function EmployeeImportPage() {
  return (
    <ImportPage
      spec={EMPLOYEE_IMPORT}
      description="엑셀 파일로 직원(판매 플랫폼·배송 기사 포함) 여러 명을 한 번에 등록합니다."
      validate={validateEmployeeImport}
      commit={commitEmployeeImport}
    />
  )
}
