"use client"

import { unstable_rethrow } from "next/navigation"
import { useEffect, useEffectEvent, useState, useTransition } from "react"
import { toast } from "sonner"

import { loadLotStockRows } from "@/lib/inventory/actions"
import type { LotStockRow } from "@/lib/inventory/queries"

/**
 * For the 폐기 / 이동 등록 modals opened with checked rows of 재고처별
 * 재고현황 (?modal=new&balances=<id>,<id>): reads those (lot × 위치) rows
 * once with fresh quantities (loadLotStockRows) and hands them to `onRows`.
 * Rows whose stock is gone meanwhile are left out (a toast says how many).
 * Returns whether the rows are still being read.
 */
export function useInitialLotRows(
  balanceIds: readonly string[],
  onRows: (rows: LotStockRow[]) => void
): boolean {
  // The ids of the first render only (the link's rows).
  const [ids] = useState(() => [...balanceIds])
  const [loading, setLoading] = useState(ids.length > 0)
  const [, startLoad] = useTransition()
  // The latest onRows, without reading the rows again when it changes.
  const handleRows = useEffectEvent((rows: LotStockRow[]) => onRows(rows))

  useEffect(() => {
    if (ids.length === 0) return
    let ignore = false
    startLoad(async () => {
      try {
        const rows = await loadLotStockRows(ids)
        if (ignore) return
        setLoading(false)
        if (rows.length < ids.length) {
          toast.info(
            `고른 재고 ${ids.length}줄 중 ${ids.length - rows.length}줄은 그사이 재고가 없어져 빠졌습니다.`
          )
        }
        handleRows(rows)
      } catch (error) {
        unstable_rethrow(error)
        if (ignore) return
        console.error(error)
        setLoading(false)
        toast.error(
          "고른 재고를 불러오지 못했습니다. [재고 추가]로 다시 골라 주세요."
        )
      }
    })
    return () => {
      ignore = true
    }
  }, [ids])

  return loading
}
