"use client"

import { unstable_rethrow } from "next/navigation"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"

import { loadStockPlaces } from "@/lib/inventory/actions"
import type { StockWarehouseNode } from "@/lib/inventory/queries"

/** What useStockPlaces gives back. */
export type StockPlacesState = {
  /** Every 창고 > 구역 > 위치 (사용 and 사용중지), or null while loading / after an error. */
  tree: StockWarehouseNode[] | null
  status: "loading" | "ready" | "error"
  /** Reads the tree again (e.g. when a picker opens: 위치 may have been added in another tab). */
  reload: () => void
  /** A reload is running (the old tree is still shown). */
  reloading: boolean
}

/**
 * Reads the 창고 > 구역 > 위치 tree with the Server Action loadStockPlaces
 * when the component mounts (a modal reads fresh data this way, never with
 * router.refresh(); see CLAUDE.md). `reload()` reads it again.
 *
 * @example
 * const places = useStockPlaces()
 * <StockPlaceField tree={places.tree} onReloadTree={places.reload} reloading={places.reloading} … />
 */
export function useStockPlaces(): StockPlacesState {
  const [tree, setTree] = useState<StockWarehouseNode[] | null>(null)
  const [status, setStatus] = useState<StockPlacesState["status"]>("loading")
  const [reloading, startReload] = useTransition()
  // Only the answer to the latest request is used.
  const requestRef = useRef(0)

  const read = useCallback(() => {
    const request = ++requestRef.current
    // In a transition, so a redirect from the server (e.g. to the login
    // page when the session has expired) is carried out by Next.js.
    startReload(async () => {
      try {
        const next = await loadStockPlaces()
        if (request !== requestRef.current) return
        setTree(next)
        setStatus("ready")
      } catch (error) {
        unstable_rethrow(error)
        if (request !== requestRef.current) return
        console.error(error)
        // Keep a tree read before; only say so when there is none.
        setStatus((current) => (current === "ready" ? current : "error"))
      }
    })
  }, [])

  useEffect(() => {
    read()
    const requests = requestRef
    return () => {
      // Unmounted: ignore answers still on their way.
      requests.current++
    }
  }, [read])

  return { tree, status, reload: read, reloading }
}
