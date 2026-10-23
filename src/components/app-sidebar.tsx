import { Suspense } from "react"

import { NavMain, NavMenu } from "@/components/nav-main"
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"

/**
 * Left sidebar with the 전체메뉴 (menu groups such as "+ 상품").
 * It sits below the top header bar. The header's menu button (or Ctrl/Cmd + B)
 * hides and shows it; on phones it slides in over the page.
 */
export function AppSidebar() {
  return (
    <Sidebar
      collapsible="offcanvas"
      // Start below the header bar instead of at the top of the window.
      className="top-(--header-height) h-[calc(100svh-var(--header-height))]!"
    >
      <SidebarHeader className="p-0">
        <p className="mx-3 mt-2 border-b-2 border-brand pt-1 pb-2 text-center text-[15px] font-bold text-brand-active">
          전체메뉴
        </p>
      </SidebarHeader>

      <SidebarContent>
        {/* Until the current URL is known, show the menu without a highlight. */}
        <Suspense fallback={<NavMenu pathname={null} />}>
          <NavMain />
        </Suspense>
      </SidebarContent>

      <SidebarRail aria-label="메뉴 접기/펼치기" title="메뉴 접기/펼치기" />
    </Sidebar>
  )
}
