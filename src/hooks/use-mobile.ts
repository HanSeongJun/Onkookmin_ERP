import * as React from "react"

const MOBILE_BREAKPOINT = 768
const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

// Re-render whenever the screen crosses the mobile breakpoint.
function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_MEDIA_QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function getSnapshot() {
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches
}

// The server has no screen: assume desktop, like the first browser render.
function getServerSnapshot() {
  return false
}

/** True when the screen is narrower than 768px (phones). */
export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
