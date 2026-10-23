import type { Metadata } from "next"
import Link from "next/link"

import { ImportPage } from "@/components/erp/import/import-page"
import {
  commitProductImport,
  validateProductImport,
} from "@/lib/imports/actions"
import { PRODUCT_IMPORT } from "@/lib/imports/products"

export const metadata: Metadata = {
  title: PRODUCT_IMPORT.title,
}

const linkClassName =
  "rounded-sm font-bold text-brand underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * "/imports/products": 상품 일괄등록 (sidebar: 자료일괄등록 → 상품
 * 일괄등록). One file with two sheets: "기준상품" (with food information)
 * and "묶음상품" (구성상품 written as "기준상품코드*수량, …"). The
 * 기준상품 are saved first, so a 묶음상품 may use a 기준상품 of the same
 * file. Missing 상품분류 are created when the option is on (the 미리보기
 * lists them). Registration only: existing 상품 are changed in 상품관리.
 */
export default function ProductImportPage() {
  return (
    <ImportPage
      spec={PRODUCT_IMPORT}
      description="엑셀 파일로 기준상품과 묶음상품을 한 번에 등록합니다. 이미 있는 상품은 바꾸지 않습니다."
      validate={validateProductImport}
      commit={commitProductImport}
      notes={
        <ul className="flex list-disc flex-col gap-0.5 pl-5">
          <li>
            ‘기준상품’ 시트가 먼저 등록되므로, 묶음상품의 구성상품에는 이미
            등록된 기준상품뿐 아니라 같은 파일 ‘기준상품’ 시트의 상품코드도 쓸
            수 있습니다.
          </li>
          <li>
            구성상품은 ‘기준상품코드*수량’을 쉼표로 나눠 적습니다 (예:
            PRC-010*6, PRC-005*2). 묶음상품의 보관온도·과세구분·알레르기 같은
            식품 정보는 구성 기준상품에서 자동으로 정해집니다.
          </li>
          <li>
            분류 이름이 잘못 적혀 엉뚱한 분류가 생기는 것을 막으려면{" "}
            <Link href="/imports/product-categories" className={linkClassName}>
              상품분류 일괄등록
            </Link>
            이나{" "}
            <Link href="/products/categories" className={linkClassName}>
              상품분류설정
            </Link>
            에서 분류를 먼저 만든 뒤, 위의 ‘없는 분류는 자동으로 만들기’를 끄고
            올리세요.
          </li>
        </ul>
      }
    />
  )
}
