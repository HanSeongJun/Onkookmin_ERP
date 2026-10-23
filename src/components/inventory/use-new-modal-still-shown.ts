"use client"

import { useCallback, useEffect, useRef } from "react"

/**
 * For a 전표 등록 modal (?modal=new): a function telling whether this modal
 * is still the one the user is looking at. After the browser's back button
 * during a save it is not; the save's answer must then only show a toast
 * (never close or change the modal shown by then). The address is checked
 * too, because Next.js carries out a back navigation only after a running
 * Server Action has answered (the old modal is still mounted then).
 *
 * @example
 * const isStillShown = useNewModalStillShown()
 * …
 * if (isStillShown()) onSaved(result)
 * else toast.success(result.message)
 */
export function useNewModalStillShown(): () => boolean {
  const mountedRef = useRef(true)
  useEffect(() => {
    // Set again on mount: React may run effects twice in development.
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  return useCallback(
    () =>
      mountedRef.current &&
      new URLSearchParams(window.location.search).get("modal") === "new",
    []
  )
}
