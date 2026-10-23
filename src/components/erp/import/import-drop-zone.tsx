"use client"

import { FileSpreadsheetIcon, LoaderCircleIcon, UploadIcon } from "lucide-react"
import { useState } from "react"

import { ActionButton } from "@/components/erp/action-bar"
import { formatNumber } from "@/lib/format"
import { IMPORT_MAX_ROWS } from "@/lib/imports/types"
import { cn } from "@/lib/utils"

/** The file shown in the box after it was read. */
export type ImportDropZoneFile = {
  name: string
  size: number
  /** What was read, e.g. "‘직원’ 시트 30행". */
  summary: string
}

/** Whether a drag carries files (not text or a link from the page). */
export function dragHasFiles(dataTransfer: DataTransfer | null): boolean {
  return Array.from(dataTransfer?.types ?? []).includes("Files")
}

/** "24KB", "1.2MB". */
function fileSizeText(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${formatNumber(Math.max(1, Math.round(bytes / 1024)), 0)}KB`
  }
  return `${formatNumber(bytes / (1024 * 1024), 1)}MB`
}

/**
 * The 파일 선택 box: drop an .xlsx / .csv file on it, or press [파일 선택]
 * (or click anywhere in the box) to open the file picker. After a file was
 * read it shows its name and what was read; dropping another file starts
 * over with that one. While `status` is set (reading, checking, saving) a
 * spinner and the text are shown.
 */
export function ImportDropZone({
  file,
  status,
  disabled,
  onPick,
  onFile,
}: {
  file: ImportDropZoneFile | null
  status: string | null
  /** No new file now (e.g. while saving): the box is greyed out. */
  disabled: boolean
  /** Opens the file picker. */
  onPick: () => void
  /** A file was dropped on the box. */
  onFile: (file: File) => void
}) {
  const [dragging, setDragging] = useState(false)

  return (
    <div
      data-slot="import-drop-zone"
      data-dragging={dragging || undefined}
      aria-disabled={disabled || undefined}
      onDragEnter={(event) => {
        if (!dragHasFiles(event.dataTransfer)) return
        event.preventDefault()
        setDragging(true)
      }}
      onDragOver={(event) => {
        if (!dragHasFiles(event.dataTransfer)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = disabled ? "none" : "copy"
      }}
      onDragLeave={(event) => {
        // Leaving for a child element of the box is not leaving the box.
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        setDragging(false)
      }}
      onDrop={(event) => {
        if (!dragHasFiles(event.dataTransfer)) return
        // Handled here: the page-wide drop handler skips it.
        event.preventDefault()
        setDragging(false)
        const dropped = event.dataTransfer.files[0]
        if (dropped) onFile(dropped)
      }}
      onClick={() => {
        if (!disabled) onPick()
      }}
      className={cn(
        "flex cursor-pointer flex-col items-center gap-3 border-2 border-dashed border-input bg-background px-4 py-6 text-center transition-colors hover:border-brand-border hover:bg-row-hover sm:flex-row sm:text-left",
        file && "py-4",
        dragging &&
          "border-brand bg-brand-tint hover:border-brand hover:bg-brand-tint",
        disabled &&
          "cursor-default opacity-60 hover:border-input hover:bg-background"
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand"
      >
        {status ? (
          <LoaderCircleIcon className="size-6 animate-spin" />
        ) : file ? (
          <FileSpreadsheetIcon className="size-6" />
        ) : (
          <UploadIcon className="size-6" />
        )}
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {file ? (
          <>
            <p className="text-sm font-bold break-all">
              {file.name}{" "}
              <span className="font-normal text-muted-foreground">
                ({fileSizeText(file.size)})
              </span>
            </p>
            <p className="text-[13px]">{file.summary}</p>
            <p className="text-xs text-muted-foreground">
              파일을 고쳤다면 다시 끌어다 놓거나 [다른 파일 선택]을 눌러 주세요.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold">
              {dragging
                ? "여기에 놓으세요"
                : "채운 엑셀 파일을 여기에 끌어다 놓거나 [파일 선택]을 누르세요"}
            </p>
            <p className="text-xs text-muted-foreground">
              엑셀(.xlsx) 또는 CSV(.csv) 파일 · 한 번에{" "}
              {formatNumber(IMPORT_MAX_ROWS, 0)}행까지 · [양식 다운로드]로 받은
              양식을 쓰면 가장 정확합니다.
            </p>
          </>
        )}
        {/* Always in the page (empty when idle), so screen readers read
            the text when it appears. */}
        <p
          role="status"
          className="text-[13px] font-bold text-brand empty:sr-only"
        >
          {status}
        </p>
      </div>

      <ActionButton
        variant={file ? "neutral" : "primary"}
        disabled={disabled}
        onClick={(event) => {
          // The box itself would open the picker a second time.
          event.stopPropagation()
          onPick()
        }}
      >
        <UploadIcon aria-hidden="true" />
        {file ? "다른 파일 선택" : "파일 선택"}
      </ActionButton>
    </div>
  )
}
