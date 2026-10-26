import type { Metadata } from "next"
import Link from "next/link"

import { ImportPage } from "@/components/erp/import/import-page"
import {
  commitOpeningStockImport,
  validateOpeningStockImport,
} from "@/lib/imports/actions"
import { OPENING_STOCK_IMPORT } from "@/lib/imports/opening-stock"

import { OpeningStockImportReference } from "./_components/opening-stock-import-reference"

export const metadata: Metadata = {
  title: OPENING_STOCK_IMPORT.title,
}

const linkClassName =
  "rounded-sm font-bold text-brand underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * "/imports/opening-stock": 기초재고 일괄등록 (sidebar: 자료일괄등록 →
 * 기초재고 일괄등록). The stock on hand when the company starts using
 * 재고관리: one row = one lot of a 기준상품 at one 창고 > 구역 > 선반.
 * Registering makes ONE 기초재고 전표 dated today (or the latest future
 * 입고일, a 예정 기초재고) for the 정상 rows (오류
 * rows are left out); that save is all or nothing (database:
 * import_opening_stock), and the same file is registered once even when
 * 등록 is sent again (request id per file). A wrong 기초재고 is undone
 * on 입고 등록 (기초재고 전표 are listed there) with its 취소.
 *
 * Under the tips, the 창고·구역·선반 codes that can be used are listed for
 * reference (read at request time inside <Suspense>, see
 * OpeningStockImportReference).
 */
export default function OpeningStockImportPage() {
  return (
    <ImportPage
      spec={OPENING_STOCK_IMPORT}
      description="재고관리를 처음 시작할 때, 지금 창고에 있는 재고를 엑셀 파일로 한 번에 넣습니다. 오늘 날짜의 기초재고 전표 하나로 등록됩니다(입고일이 오늘 이후인 행이 있으면 가장 늦은 입고일 날짜의 예정 전표)."
      validate={validateOpeningStockImport}
      commit={commitOpeningStockImport}
      notes={
        <div className="flex flex-col gap-2">
          <ul className="flex list-disc flex-col gap-0.5 pl-5">
            <li>
              먼저{" "}
              <Link href="/inventory/settings" className={linkClassName}>
                창고·로케이션 설정
              </Link>
              에서 창고·구역(상온/냉장/냉동)·선반을 만들어 두세요. 파일에는 그
              코드를 적습니다. 선반코드를 비우면 구역의 ‘기본’ 위치에
              들어갑니다.
            </li>
            <li>
              한 줄 = 같은 기한으로 들어온 묶음(로트) 하나입니다. 같은
              상품이라도 기한이 다르거나 선반이 다르면 줄을 나눠 적어 주세요.
              출고할 때 기한이 빠른 로트부터 나갑니다.
            </li>
            <li>
              <b className="font-bold">기준상품(낱개)만</b> 적을 수 있습니다.
              박스(묶음상품)는 낱개 수량으로 바꿔 적습니다. 예: 24개입 박스 2개
              → 수량 48.
            </li>
            <li>
              입고단가는 <b className="font-bold">부가세 포함</b> 1단위
              가격입니다. 비우면 재고금액은 상품의 기본 매입가로 추정합니다.
            </li>
            <li>
              오류 행은 등록되지 않고 정상 행만 등록됩니다. 오류 행은 [오류 목록
              엑셀로 받기]로 받아 고친 뒤 <b className="font-bold">그 파일만</b>{" "}
              다시 올려 주세요.
            </li>
            <li>
              같은 파일을 두 번 등록하면 재고가 두 배가 됩니다. 이미 같은
              기초재고가 있으면 미리보기에 노란 알림이 나오니 꼭 확인하세요.
              잘못 등록했다면{" "}
              <Link href="/inventory/receipts" className={linkClassName}>
                입고 등록
              </Link>
              에서 그 기초재고 전표(기초-날짜-번호)를 열어 취소합니다. 취소하면
              그 전표의 재고가 모두 빠집니다. (그 재고가 아직 출고·이동되지 않고
              그대로 있을 때만 됩니다.)
            </li>
          </ul>
          <OpeningStockImportReference />
        </div>
      }
    />
  )
}
