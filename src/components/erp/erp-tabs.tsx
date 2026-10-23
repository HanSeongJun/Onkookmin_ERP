"use client"

import { useRef } from "react"

import { cn } from "@/lib/utils"

/** One tab of an <ErpTabBar>. */
export type ErpTabItem = {
  value: string
  label: React.ReactNode
  disabled?: boolean
}

/** Ids that connect a tab button and its panel. */
export function erpTabIds(idPrefix: string, value: string) {
  return {
    tabId: `${idPrefix}-tab-${value}`,
    panelId: `${idPrefix}-panel-${value}`,
  }
}

/**
 * Row of tabs with the selected one underlined in the brand color
 * (e.g. 공통정보 / 단가정보). Controlled: you keep `value` in state.
 * Arrow keys, Home and End move between tabs. Show the content with
 * <ErpTabPanel> using the same `idPrefix`.
 *
 * @example
 * const [tab, setTab] = useState("common")
 * <ErpTabBar idPrefix="product" aria-label="상품 정보" value={tab} onValueChange={setTab}
 *   items={[{ value: "common", label: "공통정보" }, { value: "price", label: "단가정보" }]} />
 * <ErpTabPanel idPrefix="product" value="common" selectedValue={tab}>…</ErpTabPanel>
 */
export function ErpTabBar({
  items,
  value,
  onValueChange,
  idPrefix,
  className,
  "aria-label": ariaLabel,
}: {
  items: ErpTabItem[]
  value: string
  onValueChange: (value: string) => void
  idPrefix: string
  className?: string
  "aria-label": string
}) {
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([])

  function handleKeyDown(event: React.KeyboardEvent, index: number) {
    const enabled = items
      .map((item, itemIndex) => (item.disabled ? -1 : itemIndex))
      .filter((itemIndex) => itemIndex >= 0)
    const position = enabled.indexOf(index)
    let next: number | undefined
    if (event.key === "ArrowRight")
      next = enabled[(position + 1) % enabled.length]
    if (event.key === "ArrowLeft")
      next = enabled[(position - 1 + enabled.length) % enabled.length]
    if (event.key === "Home") next = enabled[0]
    if (event.key === "End") next = enabled[enabled.length - 1]
    if (next === undefined) return

    event.preventDefault()
    buttonRefs.current[next]?.focus()
    onValueChange(items[next].value)
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex gap-5 overflow-x-auto sm:gap-7", className)}
    >
      {items.map((item, index) => {
        const selected = item.value === value
        const { tabId, panelId } = erpTabIds(idPrefix, item.value)
        return (
          <button
            key={item.value}
            ref={(element) => {
              buttonRefs.current[index] = element
            }}
            type="button"
            role="tab"
            id={tabId}
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "-mb-px flex h-11 shrink-0 items-center border-b-[3px] border-transparent px-1 text-[15px] font-bold whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:opacity-50",
              selected && "border-brand text-brand hover:text-brand"
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Content of one tab. Hidden panels stay in the page (only hidden), so
 * form fields keep their values while the user switches tabs.
 */
export function ErpTabPanel({
  idPrefix,
  value,
  selectedValue,
  className,
  children,
}: {
  idPrefix: string
  value: string
  selectedValue: string
  className?: string
  children: React.ReactNode
}) {
  const { tabId, panelId } = erpTabIds(idPrefix, value)
  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      hidden={value !== selectedValue}
      className={className}
    >
      {children}
    </div>
  )
}
