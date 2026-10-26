"use client"

import { unstable_rethrow } from "next/navigation"
import { useEffect, useState, useTransition } from "react"

import { loadInventorySettings } from "@/lib/inventory/actions"
import type { InventorySettings } from "@/lib/inventory/queries"

/**
 * The 재고 설정 (기한 임박 기준일, 전표 일자 허용 범위), read once when the
 * component mounts (for dialogs that are opened from several screens,
 * e.g. 전표 취소). Null while loading or when it could not be read (then
 * the database still checks every rule on saving).
 */
export function useInventorySettings(): InventorySettings | null {
  const [settings, setSettings] = useState<InventorySettings | null>(null)
  const [, startLoad] = useTransition()
  useEffect(() => {
    let ignore = false
    startLoad(async () => {
      try {
        const loaded = await loadInventorySettings()
        if (!ignore) setSettings(loaded)
      } catch (error) {
        unstable_rethrow(error)
        console.error("Could not read the 재고 설정:", error)
      }
    })
    return () => {
      ignore = true
    }
  }, [])
  return settings
}
