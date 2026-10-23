import type { Metadata } from "next"
import { WarehouseIcon } from "lucide-react"

import { ComingSoon } from "@/components/coming-soon"
import { PageTitle } from "@/components/erp/page-title"

export const metadata: Metadata = {
  title: "재고 관리",
}

export default function InventoryPage() {
  return (
    <>
      <PageTitle
        title="재고 관리"
        description="상품별·로트별 재고 수량과 유통기한·소비기한을 확인하고 관리합니다."
      />
      <ComingSoon
        icon={WarehouseIcon}
        description="재고 관리 화면은 곧 제공될 예정입니다."
        plannedFeatures={[
          "상품별·로트(입고 단위)별 재고 현황",
          "유통기한·소비기한 임박 재고 확인",
          "유통기한·소비기한이 빠른 재고부터 출고(FEFO) 안내",
          "보관온도(상온·냉장·냉동)별 재고 조회",
          "재고 조정 이력",
        ]}
      />
    </>
  )
}
