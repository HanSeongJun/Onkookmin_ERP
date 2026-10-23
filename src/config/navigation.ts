/** Name of the app, shown in the top header bar and the browser tab. */
export const APP_NAME = "식자재 ERP"

/** A page in the sidebar menu. */
export type NavPage = {
  /** Label shown to users (Korean). */
  title: string
  /**
   * Route path. Pages below it (e.g. "/inventory/123") highlight it too,
   * unless another menu page matches the URL more closely.
   */
  href: string
}

/** A top-level menu entry that opens one page directly (e.g. 대시보드). */
export type NavLinkItem = NavPage

/**
 * A top-level menu group that opens and closes ("+ 상품" / "− 상품")
 * and lists its pages. The group itself is not a page.
 */
export type NavGroupItem = {
  title: string
  items: NavPage[]
  /** Not built yet: shown greyed out with a "준비 중" label. */
  comingSoon?: boolean
}

/** One entry in the sidebar menu: a page link or a group of pages. */
export type NavItem = NavLinkItem | NavGroupItem

/**
 * Sidebar menu (전체메뉴), in display order.
 * To open a new module: create its pages under src/app/(app)/, then list
 * them in a group's `items` (and remove `comingSoon` from that group).
 */
export const mainNavItems: NavItem[] = [
  { title: "대시보드", href: "/" },
  {
    title: "기초정보",
    items: [{ title: "직원관리", href: "/employees" }],
  },
  {
    title: "상품",
    items: [
      { title: "상품관리", href: "/products" },
      { title: "상품분류설정", href: "/products/categories" },
    ],
  },
  {
    title: "거래처",
    items: [
      { title: "거래처관리", href: "/partners" },
      { title: "거래처분류설정", href: "/partners/categories" },
    ],
  },
  {
    // 자료일괄등록: register many records at once from an Excel / CSV file.
    // The pages share src/components/erp/import (one spec per kind in
    // src/lib/imports).
    title: "자료일괄등록",
    items: [
      { title: "상품분류 일괄등록", href: "/imports/product-categories" },
      { title: "상품 일괄등록", href: "/imports/products" },
      { title: "거래처 일괄등록", href: "/imports/partners" },
      { title: "직원 일괄등록", href: "/imports/employees" },
    ],
  },
  {
    title: "재고관리",
    items: [{ title: "재고 관리", href: "/inventory" }],
  },
  { title: "구매·입고", items: [], comingSoon: true },
  { title: "판매·출고", items: [], comingSoon: true },
  { title: "정산", items: [], comingSoon: true },
]

/** Whether a menu entry is a group (has its own list of pages). */
export function isNavGroup(item: NavItem): item is NavGroupItem {
  return "items" in item
}

/**
 * The `href` of the menu page to highlight for the current URL, or null.
 * "/" only matches exactly. Other pages also match the URLs below them, and
 * the closest match wins: "/products/categories" highlights 상품분류설정,
 * while "/products" and "/products/123" highlight 상품관리 (the same for
 * "/partners/categories" → 거래처분류설정 and "/partners" → 거래처관리).
 */
export function getActiveNavHref(pathname: string): string | null {
  let activeHref: string | null = null

  for (const item of mainNavItems) {
    const pages = isNavGroup(item) ? item.items : [item]
    for (const page of pages) {
      const matches =
        page.href === "/"
          ? pathname === "/"
          : pathname === page.href || pathname.startsWith(`${page.href}/`)
      if (matches && (!activeHref || page.href.length > activeHref.length)) {
        activeHref = page.href
      }
    }
  }

  return activeHref
}
