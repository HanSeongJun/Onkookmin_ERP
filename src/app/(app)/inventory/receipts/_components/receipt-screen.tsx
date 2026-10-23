"use client"

import type { StockDocumentListData } from "@/components/inventory/stock-document-data"
import { StockDocumentListScreen } from "@/components/inventory/stock-document-list-screen"

import { ReceiptDialog } from "./receipt-dialog"

/** 입고 등록: the shared 전표 list with the 입고 등록 modal. */
export function ReceiptScreen({
  data,
}: {
  data: Extract<StockDocumentListData, { ok: true }>
}) {
  return (
    <StockDocumentListScreen
      data={data}
      renderNewDialog={(props) => <ReceiptDialog {...props} />}
      notes={
        <p>
          구분 ‘기초재고’는 자료일괄등록의 기초재고 일괄등록으로 넣은
          전표입니다. 금액은 입고 단가(부가세 포함) × 수량이며, 단가를 비워 둔
          로트는 금액에서 빠집니다(*).
        </p>
      }
    />
  )
}
