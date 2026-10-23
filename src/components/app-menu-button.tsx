"use client"

import { MenuIcon } from "lucide-react"

import { useSidebar } from "@/components/ui/sidebar"

/** The ☰ button in the header bar: hides or shows the sidebar menu. */
export function AppMenuButton() {
  const { isMobile, open, openMobile, toggleSidebar } = useSidebar()
  const isMenuOpen = isMobile ? openMobile : open

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={isMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
      aria-expanded={isMenuOpen}
      title="메뉴 열기/닫기 (Ctrl+B)"
      className="flex size-9 shrink-0 items-center justify-center rounded-sm outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white"
    >
      <MenuIcon aria-hidden="true" className="size-6" />
    </button>
  )
}
