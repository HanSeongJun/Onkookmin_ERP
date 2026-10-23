import type { Metadata } from "next"
import Link from "next/link"

import { ImportPage } from "@/components/erp/import/import-page"
import {
  commitPartnerImport,
  validatePartnerImport,
} from "@/lib/imports/actions"
import { PARTNER_IMPORT } from "@/lib/imports/partners"

import { PartnerImportReference } from "./_components/partner-import-reference"

export const metadata: Metadata = {
  title: PARTNER_IMPORT.title,
}

const linkClassName =
  "rounded-sm font-bold text-brand underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * "/imports/partners": 거래처 일괄등록 (sidebar: 자료일괄등록 → 거래처
 * 일괄등록). One row = one 거래처 with at most one 기본 배송지 and one 대표
 * 담당자. 영업담당 / 배송담당 are written as 직원코드 (재직 + the matching
 * 담당업무), 거래처분류 as names (missing ones are created when the option
 * is on). A 사업자번호 used by another 거래처 is only a warning.
 * Registration only: existing 거래처 are changed in 거래처관리.
 *
 * Under the tips, the 직원코드 of every possible 영업담당 / 배송담당 and the
 * 거래처분류 that can be used are listed for reference (read at request
 * time inside <Suspense>, see PartnerImportReference).
 */
export default function PartnerImportPage() {
  return (
    <ImportPage
      spec={PARTNER_IMPORT}
      description="엑셀 파일로 거래처를 한 번에 등록합니다. 거래처마다 기본 배송지 1곳과 대표 담당자 1명을 함께 넣을 수 있습니다."
      validate={validatePartnerImport}
      commit={commitPartnerImport}
      categoryOptionLabel="없는 거래처분류는 자동으로 만들기"
      notes={
        <div className="flex flex-col gap-2">
          <ul className="flex list-disc flex-col gap-0.5 pl-5">
            <li>
              영업담당·배송담당 칸에는 직원명이 아니라{" "}
              <b className="font-bold">직원코드</b>를 적습니다 (예: 0005). 재직
              중이고 담당업무(영업담당/배송담당)가 체크된 직원만 됩니다. 직원이
              아직 없으면{" "}
              <Link href="/imports/employees" className={linkClassName}>
                직원 일괄등록
              </Link>
              이나{" "}
              <Link href="/employees" className={linkClassName}>
                직원관리
              </Link>
              에서 먼저 등록하세요.
            </li>
            <li>
              배송지와 담당자는 한 행에 1곳·1명씩 함께 등록됩니다. 배송지가 여러
              곳이거나 담당자가 여러 명이면, 등록한 뒤 거래처관리에서
              추가하세요.
            </li>
            <li>
              결제일은 미지정 · 건별 즉시 · 매월 N일(1~28) · 매월 말일 중에서,
              외상한도는 무제한 · 외상 불가 · 금액(예: 3,000,000) 중에서
              적습니다.
            </li>
            <li>
              사업자번호가 다른 거래처와 같으면(본점·지점 등) 미리보기에 노란
              알림만 보이고 그대로 등록됩니다.
            </li>
            <li>
              분류 이름이 잘못 적혀 엉뚱한 분류가 생기는 것을 막으려면{" "}
              <Link href="/partners/categories" className={linkClassName}>
                거래처분류설정
              </Link>
              에서 분류를 먼저 만든 뒤, 위의 ‘없는 거래처분류는 자동으로
              만들기’를 끄고 올리세요.
            </li>
          </ul>
          <PartnerImportReference />
        </div>
      }
    />
  )
}
