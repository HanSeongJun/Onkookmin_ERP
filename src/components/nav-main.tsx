"use client"

import { useId, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { MinusIcon, PlusIcon } from "lucide-react"

import { useSidebar } from "@/components/ui/sidebar"
import {
  getActiveNavHref,
  isNavGroup,
  mainNavItems,
  type NavGroupItem,
  type NavLinkItem,
} from "@/config/navigation"
import { cn } from "@/lib/utils"

/**
 * Sidebar menu (전체메뉴) with the current page highlighted.
 * Render it inside <Suspense fallback={<NavMenu pathname={null} />}>:
 * on pages whose URL is only known at request time (e.g. /products/[id]),
 * usePathname() waits for the request and needs a Suspense boundary.
 */
export function NavMain() {
  const pathname = usePathname()
  return <NavMenu pathname={pathname} />
}

/**
 * The menu itself. `pathname` is null when the current URL isn't known yet;
 * then nothing is highlighted and every group starts closed.
 */
export function NavMenu({ pathname }: { pathname: string | null }) {
  const { isMobile, setOpenMobile } = useSidebar()
  const activeHref = pathname === null ? null : getActiveNavHref(pathname)

  // On phones the menu is a slide-over panel: close it after choosing a page.
  function handleNavigate() {
    if (isMobile) setOpenMobile(false)
  }

  return (
    <nav aria-label="전체메뉴">
      <ul className="flex flex-col py-1">
        {mainNavItems.map((item) =>
          isNavGroup(item) ? (
            <NavGroup
              key={item.title}
              group={item}
              activeHref={activeHref}
              onNavigate={handleNavigate}
            />
          ) : (
            <NavTopLink
              key={item.href}
              item={item}
              isActive={item.href === activeHref}
              onNavigate={handleNavigate}
            />
          )
        )}
      </ul>
    </nav>
  )
}

// Shared look of the top-level rows ("+ 상품", "대시보드").
const topRowClass =
  "flex h-11 w-full items-center gap-2 px-4 text-left text-[15px] font-bold outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset"

/** A top-level entry that opens one page (e.g. 대시보드). */
function NavTopLink({
  item,
  isActive,
  onNavigate,
}: {
  item: NavLinkItem
  isActive: boolean
  onNavigate: () => void
}) {
  return (
    <li>
      <Link
        href={item.href}
        aria-current={isActive ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          topRowClass,
          isActive && "bg-brand-tint text-brand-active"
        )}
      >
        {/* Same indent as the +/− sign of the groups. */}
        <span aria-hidden="true" className="w-3.5 shrink-0" />
        {item.title}
      </Link>
    </li>
  )
}

/**
 * A menu group ("+ 상품") that opens and closes to show its pages.
 * It starts open when one of its pages is shown, and opens again when the
 * user moves to one of its pages (e.g. from a link on the dashboard).
 */
function NavGroup({
  group,
  activeHref,
  onNavigate,
}: {
  group: NavGroupItem
  activeHref: string | null
  onNavigate: () => void
}) {
  const listId = useId()
  const hasActivePage = group.items.some((page) => page.href === activeHref)
  const [open, setOpen] = useState(hasActivePage)

  // Open the group when the user arrives on one of its pages.
  // (React's recommended way to update state when a value changes.)
  const [hadActivePage, setHadActivePage] = useState(hasActivePage)
  if (hasActivePage !== hadActivePage) {
    setHadActivePage(hasActivePage)
    if (hasActivePage) setOpen(true)
  }

  if (group.comingSoon) {
    return (
      <li>
        <div
          className={cn(
            topRowClass,
            "text-muted-foreground hover:bg-transparent"
          )}
        >
          <PlusIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {group.title}
          <span className="ml-auto rounded-sm border border-grid-line bg-background px-1.5 py-0.5 text-[11px] font-normal">
            준비 중
          </span>
        </div>
      </li>
    )
  }

  const SignIcon = open ? MinusIcon : PlusIcon

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className={cn(topRowClass, hasActivePage && "text-brand-active")}
      >
        <SignIcon aria-hidden="true" className="size-3.5 shrink-0" />
        {group.title}
      </button>
      <ul
        id={listId}
        hidden={!open}
        className="border-y border-grid-line bg-background py-1"
      >
        {group.items.map((page) => {
          const isActive = page.href === activeHref
          return (
            <li key={page.href}>
              <Link
                href={page.href}
                aria-current={isActive ? "page" : undefined}
                onClick={onNavigate}
                className={cn(
                  "flex h-9 items-center border-l-[3px] border-transparent pr-4 pl-[35px] text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-inset",
                  isActive &&
                    "border-brand bg-brand-tint font-bold text-brand-active"
                )}
              >
                {page.title}
              </Link>
            </li>
          )
        })}
      </ul>
    </li>
  )
}
