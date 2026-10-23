import { useCallback, useMemo, useSyncExternalStore } from "react"

/**
 * The order of a grid's columns as the user arranged it, remembered in this
 * browser (localStorage), e.g. for the 상품관리 grid.
 *
 * - `storageKey`: where it is kept. Add a version suffix ("….v1") and raise
 *   it if the meaning of the saved value ever changes.
 * - `defaultOrder`: every column id in the default order. Must be a constant
 *   (declared outside the component).
 *
 * A saved order is checked before it is used: unknown ids are dropped and
 * missing ones (e.g. a column added later) are added at the end in their
 * default order, so a broken or old value never breaks the grid. When the
 * browser blocks localStorage (private mode, blocked site data), the order
 * still works until the page is reloaded. The server and the first render
 * in the browser use the default order; the saved one follows right after.
 *
 * @example
 * const columns = useColumnOrder("products.grid.columns.v1", PRODUCT_COLUMN_IDS)
 * columns.order // ["code", "name", …]
 * columns.setOrder(moveColumn(columns.order, "name", "code"))
 * columns.reset()
 */
export function useColumnOrder<Id extends string>(
  storageKey: string,
  defaultOrder: readonly Id[]
): {
  order: Id[]
  setOrder: (order: readonly Id[]) => void
  /** Back to the default order (forgets the saved one). */
  reset: () => void
  /** Whether the order is the default one. */
  isDefault: boolean
} {
  const saved = useSyncExternalStore(
    subscribe,
    () => readSaved(storageKey),
    () => null
  )
  const order = useMemo(
    () => normalizeColumnOrder(saved, defaultOrder),
    [saved, defaultOrder]
  )
  const setOrder = useCallback(
    (next: readonly Id[]) => {
      const isDefault = next.join("\n") === defaultOrder.join("\n")
      writeSaved(storageKey, isDefault ? null : JSON.stringify(next))
    },
    [storageKey, defaultOrder]
  )
  const reset = useCallback(() => writeSaved(storageKey, null), [storageKey])

  return {
    order,
    setOrder,
    reset,
    isDefault: order.join("\n") === defaultOrder.join("\n"),
  }
}

/**
 * `order` with column `id` moved in front of column `beforeId` (null = to
 * the end). The other columns keep their order.
 * @example moveColumn(["a", "b", "c"], "c", "a") // ["c", "a", "b"]
 */
export function moveColumn<Id extends string>(
  order: readonly Id[],
  id: Id,
  beforeId: Id | null
): Id[] {
  if (id === beforeId) return [...order]
  const rest = order.filter((column) => column !== id)
  const at = beforeId === null ? rest.length : rest.indexOf(beforeId)
  if (at < 0) return [...order]
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

/**
 * A saved order (JSON text, or null for none) as a valid list of column ids:
 * known ids only, each once, then the missing ones in the default order.
 */
export function normalizeColumnOrder<Id extends string>(
  saved: string | null,
  defaultOrder: readonly Id[]
): Id[] {
  let parsed: unknown = null
  if (saved !== null) {
    try {
      parsed = JSON.parse(saved)
    } catch {
      parsed = null
    }
  }
  const known = new Set<string>(defaultOrder)
  const order: Id[] = []
  if (Array.isArray(parsed)) {
    for (const value of parsed) {
      if (typeof value !== "string" || !known.has(value)) continue
      if (order.includes(value as Id)) continue
      order.push(value as Id)
    }
  }
  for (const id of defaultOrder) {
    if (!order.includes(id)) order.push(id)
  }
  return order
}

// ---- The saved values (shared by every grid on the page) ------------------

const listeners = new Set<() => void>()
/**
 * Orders changed in this tab. Used instead of localStorage, so a change
 * still shows when the browser does not let the page save it.
 */
const changedHere = new Map<string, string | null>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function readSaved(storageKey: string): string | null {
  if (changedHere.has(storageKey)) return changedHere.get(storageKey) ?? null
  try {
    return window.localStorage.getItem(storageKey)
  } catch {
    return null
  }
}

function writeSaved(storageKey: string, value: string | null) {
  changedHere.set(storageKey, value)
  try {
    if (value === null) {
      window.localStorage.removeItem(storageKey)
    } else {
      window.localStorage.setItem(storageKey, value)
    }
  } catch {
    // Not saved (e.g. private mode): the order lasts until a reload.
  }
  for (const listener of listeners) listener()
}
