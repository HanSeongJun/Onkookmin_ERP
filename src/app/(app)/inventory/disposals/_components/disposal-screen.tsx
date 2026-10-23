"use client"

import type { StockDocumentListData } from "@/components/inventory/stock-document-data"
import { StockDocumentListScreen } from "@/components/inventory/stock-document-list-screen"

import { DisposalDialog } from "./disposal-dialog"

/** 폐기 등록: the shared 전표 list with the 폐기 등록 modal. */
export function DisposalScreen({
  data,
}: {
  data: Extract<StockDocumentListData, { ok: true }>
}) {
  return (
    <StockDocumentListScreen
      data={data}
      renderNewDialog={(props) => <DisposalDialog {...props} />}
      notes={
        <p>
          금액은 폐기한 수량 × 로트의 입고 단가(부가세 포함)입니다. 단가를
          모르는 로트는 금액에서 빠집니다(*).
        </p>
      }
    />
  )
}
