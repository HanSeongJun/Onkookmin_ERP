import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react"
import Link from "next/link"

import { cn } from "@/lib/utils"

const pageButtonClass =
  "flex h-7 min-w-7 items-center justify-center rounded-sm border border-input bg-background px-1.5 text-[13px] tabular-nums outline-none hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring"

/**
 * Page links under a 재고 list: first / previous, the first and last page
 * and two pages on each side of the current one (1 … 4 5 [6] 7 8 … 20),
 * next / last. `hrefFor(page)` builds each link (keep the list's
 * conditions, e.g. buildStockDocumentListHref(screen, { ...params, page })).
 * Nothing is shown for a single page.
 */
export function StockPagination({
  page,
  pageCount,
  hrefFor,
}: {
  page: number
  pageCount: number
  hrefFor: (page: number) => string
}) {
  if (pageCount <= 1) return null

  return (
    <nav aria-label="페이지 이동">
      <ul className="flex flex-wrap items-center justify-center gap-1">
        <li>
          <PageLink href={page > 1 ? hrefFor(1) : null} label="첫 페이지">
            <ChevronsLeftIcon aria-hidden="true" className="size-4" />
          </PageLink>
        </li>
        <li>
          <PageLink
            href={page > 1 ? hrefFor(page - 1) : null}
            label="이전 페이지"
          >
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
          </PageLink>
        </li>
        {pageItems(page, pageCount).map((item, index) =>
          item === "gap" ? (
            <li
              key={`gap-${index}`}
              aria-hidden="true"
              className="px-1 text-muted-foreground"
            >
              …
            </li>
          ) : (
            <li key={item}>
              <Link
                href={hrefFor(item)}
                aria-label={`${item}페이지`}
                aria-current={item === page ? "page" : undefined}
                className={cn(
                  pageButtonClass,
                  item === page &&
                    "border-brand bg-brand font-bold text-brand-foreground hover:bg-brand-hover"
                )}
              >
                {item}
              </Link>
            </li>
          )
        )}
        <li>
          <PageLink
            href={page < pageCount ? hrefFor(page + 1) : null}
            label="다음 페이지"
          >
            <ChevronRightIcon aria-hidden="true" className="size-4" />
          </PageLink>
        </li>
        <li>
          <PageLink
            href={page < pageCount ? hrefFor(pageCount) : null}
            label="마지막 페이지"
          >
            <ChevronsRightIcon aria-hidden="true" className="size-4" />
          </PageLink>
        </li>
      </ul>
    </nav>
  )
}

function PageLink({
  href,
  label,
  children,
}: {
  href: string | null
  label: string
  children: React.ReactNode
}) {
  if (!href) {
    return (
      <span
        aria-disabled="true"
        aria-label={label}
        className={cn(pageButtonClass, "pointer-events-none opacity-40")}
      >
        {children}
      </span>
    )
  }
  return (
    <Link href={href} aria-label={label} className={pageButtonClass}>
      {children}
    </Link>
  )
}

function pageItems(page: number, pageCount: number): (number | "gap")[] {
  const pages = new Set([1, pageCount])
  for (let p = page - 2; p <= page + 2; p++) {
    if (p >= 1 && p <= pageCount) pages.add(p)
  }
  const sorted = [...pages].sort((a, b) => a - b)
  const items: (number | "gap")[] = []
  sorted.forEach((p, index) => {
    const previous = sorted[index - 1]
    if (previous !== undefined && p - previous > 1) items.push("gap")
    items.push(p)
  })
  return items
}
