"use client"

import type { StockDocumentListData } from "@/components/inventory/stock-document-data"
import { StockDocumentListScreen } from "@/components/inventory/stock-document-list-screen"

import { TransferDialog } from "./transfer-dialog"

/** 재고처간 이동등록: the shared 전표 list with the 이동 등록 modal. */
export function TransferScreen({
  data,
}: {
  data: Extract<StockDocumentListData, { ok: true }>
}) {
  return (
    <StockDocumentListScreen
      data={data}
      renderNewDialog={(props) => <TransferDialog {...props} />}
      notes={
        <p>
          이동은 같은 로트를 다른 위치로 옮길 뿐이라 전체 재고와 금액은 바뀌지
          않습니다. 보관온도가 맞지 않는 구역으로 옮기면 저장 전에 한 번 더
          묻습니다.
        </p>
      }
    />
  )
}
