"use client"

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { ActionButton } from "@/components/erp/action-bar"
import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridCount,
  DataGridEmpty,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { ErpTabBar, ErpTabPanel } from "@/components/erp/erp-tabs"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { formatNumber } from "@/lib/format"
import {
  findImportColumn,
  type ImportColumn,
  type ImportFileSheet,
  type ImportSheetSpec,
  type ImportSpec,
} from "@/lib/imports/columns"
import {
  IMPORT_ROW_STATUS_LABELS,
  type ImportCell,
  type ImportIssue,
  type ImportPreview,
  type ImportRowResult,
  type ImportRowStatus,
} from "@/lib/imports/types"
import { cellText } from "@/lib/imports/values"
import { cn } from "@/lib/utils"

/** Rows per page of the 미리보기 (a 3,000-row file has 30 pages). */
const PAGE_SIZE = 100

/** Which rows the grid shows: 전체, 정상, 오류, 건너뜀. */
type RowFilter = "all" | ImportRowStatus

type RowCounts = Record<RowFilter, number>

function countRows(rows: readonly ImportRowResult[]): RowCounts {
  const counts: RowCounts = { all: rows.length, ok: 0, error: 0, skipped: 0 }
  for (const row of rows) counts[row.status]++
  return counts
}

/** "‘직원명’ 직원명을 입력해 주세요." (or the message alone for the whole row). */
export function importIssueText(
  sheet: ImportSheetSpec,
  issue: ImportIssue
): string {
  const column = issue.column ? findImportColumn(sheet, issue.column) : null
  return column ? `‘${column.header}’ ${issue.message}` : issue.message
}

/** A row of the file to show first and mark (e.g. the one the DB refused). */
export type ImportFocusRow = { sheet: string; excelRow: number }

/**
 * The 미리보기 grid of a checked file: for multi-sheet imports (상품) a tab
 * per sheet, then a 전체 / 정상 / 오류 (/ 건너뜀) filter, and the rows with
 * 행 (Excel row number), 상태, 오류 내용 and the file's own columns. A cell
 * with an error is red (its message on hover and in 오류 내용); a cell with
 * a note (참고) is yellow. 100 rows per page.
 *
 * The view (sheet, filter, page) starts fresh when the component gets a new
 * `key`: give it one per 미리보기 (and per `focusRow`).
 */
export function ImportPreviewGrid({
  spec,
  sheets,
  preview,
  registered,
  focusRow,
}: {
  spec: ImportSpec
  /** The rows as read from the file (for the cell values). */
  sheets: Record<string, ImportFileSheet>
  preview: ImportPreview
  /** The 정상 rows were registered: their 상태 reads "등록 완료". */
  registered: boolean
  /** Shown first (its sheet and page) and marked "등록 실패". */
  focusRow: ImportFocusRow | null
}) {
  const rowsBySheet = useMemo(() => {
    const map = new Map<string, ImportRowResult[]>(
      spec.sheets.map((sheet) => [sheet.key, []])
    )
    for (const row of preview.rows) map.get(row.sheet)?.push(row)
    return map
  }, [spec, preview])

  const [sheetKey, setSheetKey] = useState(
    () =>
      focusRow?.sheet ??
      spec.sheets.find((sheet) => (rowsBySheet.get(sheet.key)?.length ?? 0) > 0)
        ?.key ??
      spec.sheets[0].key
  )
  const [filter, setFilter] = useState<RowFilter>("all")
  const [page, setPage] = useState(() => {
    if (!focusRow) return 0
    const index = (rowsBySheet.get(focusRow.sheet) ?? []).findIndex(
      (row) => row.excelRow === focusRow.excelRow
    )
    return index < 0 ? 0 : Math.floor(index / PAGE_SIZE)
  })
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Bring the marked row into view once (the grid scrolls inside its box).
  useEffect(() => {
    if (!focusRow) return
    wrapperRef.current
      ?.querySelector('[data-focus-row="true"]')
      ?.scrollIntoView({ block: "center" })
  }, [focusRow])

  const multi = spec.sheets.length > 1
  const sheetSpec =
    spec.sheets.find((sheet) => sheet.key === sheetKey) ?? spec.sheets[0]
  const sheetRows = rowsBySheet.get(sheetSpec.key) ?? []
  const counts = countRows(sheetRows)
  const shownRows =
    filter === "all"
      ? sheetRows
      : sheetRows.filter((row) => row.status === filter)
  const pageCount = Math.max(1, Math.ceil(shownRows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageRows = shownRows.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE
  )

  function changePage(next: number) {
    setPage(next)
    // Start the new page at its top.
    wrapperRef.current
      ?.querySelector('[data-slot="data-grid"]')
      ?.scrollTo({ top: 0 })
  }

  const content = (
    <SheetPreview
      sheetSpec={sheetSpec}
      fileSheet={sheets[sheetSpec.key]}
      rows={pageRows}
      shownCount={shownRows.length}
      counts={counts}
      showSkipped={preview.skipped > 0}
      filter={filter}
      onFilterChange={(next) => {
        setFilter(next)
        changePage(0)
      }}
      registered={registered}
      focusRow={focusRow}
      pager={
        <Pager
          page={currentPage}
          pageCount={pageCount}
          total={shownRows.length}
          onChange={changePage}
        />
      }
    />
  )

  return (
    <div ref={wrapperRef} className="flex min-w-0 flex-col gap-2">
      {multi ? (
        <>
          <ErpTabBar
            idPrefix="import-sheet"
            aria-label="시트"
            value={sheetSpec.key}
            onValueChange={(next) => {
              setSheetKey(next)
              changePage(0)
            }}
            className="border-b border-grid-line"
            items={spec.sheets.map((sheet) => {
              const sheetCounts = countRows(rowsBySheet.get(sheet.key) ?? [])
              return {
                value: sheet.key,
                label: (
                  <>
                    {sheet.sheetName}
                    <span className="ml-1 text-[13px] font-normal">
                      {formatNumber(sheetCounts.all, 0)}행
                      {sheetCounts.error > 0 && (
                        <span className="font-bold text-destructive">
                          {" "}
                          · 오류 {formatNumber(sheetCounts.error, 0)}
                        </span>
                      )}
                    </span>
                  </>
                ),
              }
            })}
          />
          {spec.sheets.map((sheet) => (
            <ErpTabPanel
              key={sheet.key}
              idPrefix="import-sheet"
              value={sheet.key}
              selectedValue={sheetSpec.key}
            >
              {sheet.key === sheetSpec.key && content}
            </ErpTabPanel>
          ))}
        </>
      ) : (
        content
      )}
    </div>
  )
}

/** The filter, the grid and the page links of one sheet. */
function SheetPreview({
  sheetSpec,
  fileSheet,
  rows,
  shownCount,
  counts,
  showSkipped,
  filter,
  onFilterChange,
  registered,
  focusRow,
  pager,
}: {
  sheetSpec: ImportSheetSpec
  fileSheet: ImportFileSheet | undefined
  /** The rows of this page. */
  rows: ImportRowResult[]
  /** Rows that match the filter (all pages). */
  shownCount: number
  counts: RowCounts
  showSkipped: boolean
  filter: RowFilter
  onFilterChange: (filter: RowFilter) => void
  registered: boolean
  focusRow: ImportFocusRow | null
  pager: React.ReactNode
}) {
  const valuesByRow = useMemo(
    () => new Map((fileSheet?.rows ?? []).map((row) => [row.excelRow, row])),
    [fileSheet]
  )
  // The file's columns, in the template's order.
  const columns = sheetSpec.columns.filter((column) =>
    fileSheet?.columns.includes(column.key)
  )
  const colSpan = 3 + columns.length

  const filters: { value: RowFilter; label: string; count: number }[] = [
    { value: "all", label: "전체", count: counts.all },
    { value: "ok", label: "정상", count: counts.ok },
    { value: "error", label: "오류", count: counts.error },
    ...(showSkipped
      ? [{ value: "skipped" as const, label: "건너뜀", count: counts.skipped }]
      : []),
  ]

  return (
    <div className="flex min-w-0 flex-col gap-2 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <RadioGroup
          aria-label="보기"
          value={filter}
          onValueChange={(next) => onFilterChange(next as RowFilter)}
          className="flex w-auto flex-wrap gap-x-4 gap-y-1"
        >
          {filters.map((option) => {
            const id = `import-filter-${sheetSpec.key}-${option.value}`
            return (
              <label
                key={option.value}
                htmlFor={id}
                className="flex min-h-7 cursor-pointer items-center gap-1.5 text-[13px]"
              >
                <RadioGroupItem id={id} value={option.value} />
                {option.label}
                <span
                  className={cn(
                    "font-bold",
                    option.value === "error" &&
                      option.count > 0 &&
                      "text-destructive"
                  )}
                >
                  {formatNumber(option.count, 0)}
                </span>
              </label>
            )
          })}
        </RadioGroup>
        <DataGridCount shown={shownCount} total={counts.all} />
      </div>

      <DataGrid
        aria-label={`${sheetSpec.sheetName} 미리보기`}
        containerClassName="max-h-[min(70svh,46rem)]"
      >
        <DataGridHeader>
          <tr>
            <DataGridHead className="left-0 z-20 w-14 min-w-14">
              행
            </DataGridHead>
            <DataGridHead className="left-14 z-20">상태</DataGridHead>
            <DataGridHead>오류 내용</DataGridHead>
            {columns.map((column) => (
              <DataGridHead key={column.key}>{column.header}</DataGridHead>
            ))}
          </tr>
        </DataGridHeader>
        <DataGridBody>
          {!fileSheet || fileSheet.columns.length === 0 ? (
            <DataGridEmpty colSpan={colSpan}>
              파일에 ‘{sheetSpec.sheetName}’ 시트가 없거나 비어 있습니다.
            </DataGridEmpty>
          ) : rows.length === 0 ? (
            <DataGridEmpty colSpan={colSpan}>
              {filter === "error"
                ? "오류가 있는 행이 없습니다."
                : filter === "ok"
                  ? "정상 행이 없습니다."
                  : filter === "skipped"
                    ? "건너뛰는 행이 없습니다."
                    : "이 시트에는 등록할 행이 없습니다."}
            </DataGridEmpty>
          ) : (
            rows.map((row) => (
              <PreviewRow
                key={row.excelRow}
                row={row}
                sheetSpec={sheetSpec}
                columns={columns}
                values={valuesByRow.get(row.excelRow)?.values ?? {}}
                registered={registered}
                focused={
                  focusRow !== null &&
                  focusRow.sheet === row.sheet &&
                  focusRow.excelRow === row.excelRow
                }
              />
            ))
          )}
        </DataGridBody>
      </DataGrid>

      {pager}
    </div>
  )
}

/** One row of the 미리보기. */
function PreviewRow({
  row,
  sheetSpec,
  columns,
  values,
  registered,
  focused,
}: {
  row: ImportRowResult
  sheetSpec: ImportSheetSpec
  columns: ImportColumn[]
  values: Record<string, ImportCell>
  registered: boolean
  focused: boolean
}) {
  const errorOf = new Map<string, string>()
  for (const issue of row.errors) {
    if (issue.column && !errorOf.has(issue.column)) {
      errorOf.set(issue.column, issue.message)
    }
  }
  const warningOf = new Map<string, string>()
  for (const issue of row.warnings) {
    if (issue.column && !warningOf.has(issue.column)) {
      warningOf.set(issue.column, issue.message)
    }
  }
  const hasMessages = row.errors.length > 0 || row.warnings.length > 0

  return (
    <DataGridRow
      selected={focused}
      data-focus-row={focused || undefined}
      className={cn(row.status === "skipped" && "text-muted-foreground")}
    >
      {/* bg-inherit: the sticky cells take the row's (opaque) color, so the
          cells scrolled under them stay hidden. */}
      <DataGridCell
        numeric
        className="sticky left-0 z-[1] w-14 min-w-14 bg-inherit"
      >
        {row.excelRow}
      </DataGridCell>
      <DataGridCell className="sticky left-14 z-[1] bg-inherit">
        <span className="flex items-center gap-1.5">
          <StatusBadge status={row.status} registered={registered} />
          {focused && (
            <span className="text-xs font-bold text-destructive">
              등록 실패
            </span>
          )}
          {row.note && (
            <span className="text-xs text-muted-foreground">{row.note}</span>
          )}
        </span>
      </DataGridCell>
      <DataGridCell className="py-1 align-top">
        {hasMessages ? (
          <ul className="flex w-72 flex-col gap-0.5 text-xs leading-snug whitespace-normal md:w-96">
            {row.errors.map((issue, index) => (
              <li key={`error-${index}`} className="font-bold text-destructive">
                {importIssueText(sheetSpec, issue)}
              </li>
            ))}
            {row.warnings.map((issue, index) => (
              <li key={`warning-${index}`} className="text-muted-foreground">
                참고: {importIssueText(sheetSpec, issue)}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </DataGridCell>
      {columns.map((column) => (
        <ValueCell
          key={column.key}
          value={values[column.key]}
          error={errorOf.get(column.key) ?? null}
          warning={warningOf.get(column.key) ?? null}
        />
      ))}
    </DataGridRow>
  )
}

/** 정상 / 오류 / 건너뜀 (or 등록 완료 after registering). */
function StatusBadge({
  status,
  registered,
}: {
  status: ImportRowStatus
  registered: boolean
}) {
  const done = status === "ok" && registered
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm px-1.5 text-xs font-bold whitespace-nowrap",
        status === "ok" &&
          (done
            ? "bg-brand text-brand-foreground"
            : "bg-brand-tint text-brand-active"),
        status === "error" && "bg-destructive/10 text-destructive",
        status === "skipped" && "bg-muted text-muted-foreground"
      )}
    >
      {done ? "등록 완료" : IMPORT_ROW_STATUS_LABELS[status]}
    </span>
  )
}

/** A cell of the file: red with its message when wrong, yellow with a note. */
function ValueCell({
  value,
  error,
  warning,
}: {
  value: ImportCell | undefined
  error: string | null
  warning: string | null
}) {
  const text = cellText(value)
  // The message on hover; otherwise a long value in full.
  const title = error ?? warning ?? (text.length > 20 ? text : undefined)
  return (
    <DataGridCell
      title={title}
      aria-invalid={error ? true : undefined}
      className={cn(
        error && "bg-destructive/10 font-bold text-destructive",
        !error && warning && "bg-chart-4/20"
      )}
    >
      <span className="block max-w-60 truncate">
        {text === "" && error ? (
          <span className="font-normal text-destructive italic">
            (비어 있음)
          </span>
        ) : (
          text
        )}
      </span>
      {error && <span className="sr-only"> (오류: {error})</span>}
    </DataGridCell>
  )
}

/** « ‹ 2 / 30쪽 › » under the grid (hidden when there is one page). */
function Pager({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number
  pageCount: number
  total: number
  onChange: (page: number) => void
}) {
  if (pageCount <= 1) return null
  const from = page * PAGE_SIZE + 1
  const to = Math.min(total, (page + 1) * PAGE_SIZE)
  return (
    <nav
      aria-label="미리보기 페이지"
      className="flex flex-wrap items-center justify-center gap-1.5"
    >
      <ActionButton
        variant="neutral"
        size="sm"
        aria-label="첫 페이지"
        disabled={page === 0}
        onClick={() => onChange(0)}
      >
        <ChevronsLeftIcon aria-hidden="true" />
      </ActionButton>
      <ActionButton
        variant="neutral"
        size="sm"
        aria-label="이전 페이지"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeftIcon aria-hidden="true" />
      </ActionButton>
      <span className="px-2 text-[13px]">
        <span className="font-bold">{formatNumber(page + 1, 0)}</span> /{" "}
        {formatNumber(pageCount, 0)}쪽{" "}
        <span className="text-muted-foreground">
          ({formatNumber(from, 0)}~{formatNumber(to, 0)}번째)
        </span>
      </span>
      <ActionButton
        variant="neutral"
        size="sm"
        aria-label="다음 페이지"
        disabled={page >= pageCount - 1}
        onClick={() => onChange(page + 1)}
      >
        <ChevronRightIcon aria-hidden="true" />
      </ActionButton>
      <ActionButton
        variant="neutral"
        size="sm"
        aria-label="마지막 페이지"
        disabled={page >= pageCount - 1}
        onClick={() => onChange(pageCount - 1)}
      >
        <ChevronsRightIcon aria-hidden="true" />
      </ActionButton>
    </nav>
  )
}
