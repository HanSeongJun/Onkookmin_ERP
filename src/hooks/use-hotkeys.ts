import { useEffect, useEffectEvent } from "react"

/** Called when its key is pressed. The browser's own action is already cancelled. */
export type HotkeyHandler = (event: KeyboardEvent) => void

/**
 * Keys and what they do. Write a key as "F4", "Escape", "Enter", "S", "1",
 * with modifiers in front joined by "+": "Ctrl+F9", "Shift+F5", "Alt+N".
 * "Ctrl" also matches the ⌘ (Command) key on a Mac.
 */
export type HotkeyMap = Partial<Record<string, HotkeyHandler>>

export type UseHotkeysOptions = {
  /**
   * Turn the hotkeys off, e.g. on the list page while a dialog is open
   * (so F5 in the dialog doesn't open another one). Default true.
   */
  enabled?: boolean
  /** Fire again while the key is held down. Default false. */
  allowRepeat?: boolean
}

/**
 * Keyboard shortcuts for a screen, like a classic ERP (F4 조회, F5 신규,
 * F8 저장, Ctrl+F9 엑셀).
 *
 * - Works while typing in an input too (that's the point of F-keys).
 * - A handled key's browser action is cancelled (F5 does not reload the page).
 * - While Korean (IME) text is still being composed the handler is skipped,
 *   but the key's browser action is still cancelled.
 * - Ignored when another handler already cancelled the key.
 * - Use F-keys or Ctrl combos. Don't register Escape for an <ErpDialog>:
 *   the dialog handles Esc itself (see its onOpenChange).
 *
 * @example
 * useHotkeys(
 *   { F4: () => searchFormRef.current?.requestSubmit(), F5: openNew, "Ctrl+F9": downloadExcel },
 *   { enabled: !isDialogOpen }
 * )
 */
export function useHotkeys(
  hotkeys: HotkeyMap,
  { enabled = true, allowRepeat = false }: UseHotkeysOptions = {}
): void {
  // Always sees the latest `hotkeys` without re-adding the listener.
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Browser autofill and some password managers send "keydown" events
    // without a key: ignore them.
    if (typeof event.key !== "string" || typeof event.code !== "string") return
    // 229 = a key the IME uses for the Korean text being composed: leave it
    // to the IME.
    if (event.keyCode === 229) return
    if (event.defaultPrevented) return

    const pressed = eventToHotkey(event)
    const entry = Object.entries(hotkeys).find(
      ([hotkey]) => normalizeHotkey(hotkey) === pressed
    )
    const handler = entry?.[1]
    if (!handler) return

    // Cancel the browser's action (e.g. F5 reload) even while Korean text is
    // still being composed; only the handler is skipped then.
    event.preventDefault()
    if (event.isComposing) return
    if (event.repeat && !allowRepeat) return
    handler(event)
  })

  useEffect(() => {
    if (!enabled) return
    const listener = (event: KeyboardEvent) => handleKeyDown(event)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [enabled])
}

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift"] as const

/** A pressed key as "Ctrl+Alt+Shift+Key" (only the modifiers that are held). */
function eventToHotkey(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push("Ctrl")
  if (event.altKey) parts.push("Alt")
  if (event.shiftKey) parts.push("Shift")
  parts.push(keyName(event))
  return parts.join("+")
}

/** The key's name, independent of the keyboard layout for letters and digits. */
function keyName(event: KeyboardEvent): string {
  // With Alt or Shift held, event.key can be a different character,
  // so letters and digits are read from the physical key instead.
  if (event.code.startsWith("Key")) return event.code.slice(3)
  if (event.code.startsWith("Digit")) return event.code.slice(5)
  return normalizeKeyName(event.key)
}

function normalizeKeyName(key: string): string {
  if (key === "Esc") return "Escape"
  if (key.length === 1) return key.toUpperCase()
  // "f4" → "F4", "escape" → "Escape"
  return key.charAt(0).toUpperCase() + key.slice(1)
}

/** "ctrl+f9" or "Shift+Ctrl+F9" → "Ctrl+Shift+F9" (same form as eventToHotkey). */
function normalizeHotkey(hotkey: string): string {
  const parts = hotkey.split("+").map((part) => part.trim())
  const key = normalizeKeyName(parts.pop() ?? "")
  const modifiers = MODIFIER_ORDER.filter((modifier) =>
    parts.some((part) => {
      const lower = part.toLowerCase()
      if (modifier === "Ctrl")
        return ["ctrl", "control", "cmd", "meta", "mod"].includes(lower)
      return lower === modifier.toLowerCase()
    })
  )
  return [...modifiers, key].join("+")
}
