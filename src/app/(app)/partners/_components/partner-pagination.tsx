import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react"
import Link from "next/link"

import {
  buildPartnerListHref,
  type PartnerListParams,
} from "@/lib/partners/schema"
import { cn } from "@/lib/utils"

const pageButtonClass =
  "flex h-7 min-w-7 items-center justify-center rounded-sm border border-input bg-background px-1.5 text-[13px] tabular-nums outline-none hover:bg-row-hover focus-visible:ring-2 focus-visible:ring-ring"

/**
 * Page links under the partner list. Each link keeps the current search,
 * filters, sort and page size. Shows the first and last page, and up to two
 * pages on each side of the current one: 1 … 4 5 [6] 7 8 … 20
 */
export function PartnerPagination({
  params,
  page,
  pageCount,
  basePath,
}: {
  params: PartnerListParams
  page: number
  pageCount: number
  /** The screen showing the list (default "/partners"). */
  basePath?: string
}) {
  if (pageCount <= 1) return null

  const hrefFor = (target: number) =>
    buildPartnerListHref({ ...params, page: target }, basePath)

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

        {getPageItems(page, pageCount).map((item, index) =>
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

/** First/previous/next/last link; greyed out when there is no such page. */
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

/** Page numbers to show, with "gap" where pages are skipped. */
function getPageItems(page: number, pageCount: number): (number | "gap")[] {
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
