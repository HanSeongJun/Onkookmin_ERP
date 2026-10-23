"use client"

import {
  CircleCheckIcon,
  DownloadIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react"
import Link from "next/link"
import { unstable_rethrow } from "next/navigation"
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react"
import { toast } from "sonner"

import {
  ActionBar,
  ActionButton,
  actionButtonClassName,
} from "@/components/erp/action-bar"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { useHotkeys } from "@/hooks/use-hotkeys"
import { formatNumber } from "@/lib/format"
import {
  importSheetsInput,
  type ImportFileSheet,
  type ImportSpec,
} from "@/lib/imports/columns"
import {
  downloadImportErrors,
  downloadImportTemplate,
} from "@/lib/imports/download"
import { IMPORT_FILE_ACCEPT, readImportFile } from "@/lib/imports/read-file"
import {
  importRowKey,
  type ImportCommitResult,
  type ImportInput,
  type ImportPreview,
  type ImportValidateResult,
} from "@/lib/imports/types"
import { cn } from "@/lib/utils"

import { dragHasFiles, ImportDropZone } from "./import-drop-zone"
import { ImportGuide } from "./import-guide"
import { ImportPreviewGrid, type ImportFocusRow } from "./import-preview-grid"
import { ImportSteps, type ImportStep } from "./import-steps"

/** validate<Kind>Import from `@/lib/imports/actions`. */
export type ImportValidateAction = (
  input: ImportInput
) => Promise<ImportValidateResult>

/** commit<Kind>Import from `@/lib/imports/actions`. */
export type ImportCommitAction = (
  input: ImportInput,
  okRowKeys: string[]
) => Promise<ImportCommitResult>

/** The file the user chose, as read in the browser. */
type LoadedFile = {
  name: string
  size: number
  sheets: Record<string, ImportFileSheet>
  rowCount: number
  /** Notes about the file that do not stop it (e.g. unknown columns). */
  warnings: string[]
}

/** A 미리보기 and the request it answered (a new one resets the grid). */
type Checked = { preview: ImportPreview; id: number }

type Saved = Extract<ImportCommitResult, { ok: true }>

/** Codes listed in the result box; the rest are counted ("외 N개"). */
const RESULT_CODES_SHOWN = 30

/**
 * One 자료일괄등록 screen (the same for 상품분류, 상품, 거래처, 직원):
 *
 * 1. [양식 다운로드]: the .xlsx template of `spec` (built in the browser).
 * 2. 파일 선택: drop an .xlsx / .csv file on the box (or anywhere on the
 *    page) or press [파일 선택]. The file is read in the browser
 *    (`readImportFile`), then `validate` checks every row on the server.
 * 3. 미리보기: 총 N행 · 정상 M · 오류 K, the grid with each wrong cell in red
 *    and its message, a 전체 / 정상 / 오류 filter, [오류 목록 엑셀로 받기].
 *    [다시 확인 | F4] checks the same rows again.
 * 4. [정상 M건 등록 | F8]: after a confirm, `commit` registers the 정상 rows
 *    in one go (all or nothing). The result box links to the list screen.
 *
 * Options: when `spec.hasCategoryOption`, a "없는 분류는 자동으로 만들기"
 * checkbox (on by default; changing it checks the file again). `notes`:
 * a page's own tips, shown in a box under the file box.
 *
 * Keys: F4 = 다시 확인, F8 = 정상 M건 등록 (in the confirm: 등록),
 * Ctrl+F9 = 오류 목록 엑셀로 받기.
 *
 * Render it inside <Suspense> after requireUser() (see ImportPage).
 */
export function ImportScreen({
  spec,
  validate,
  commit,
  categoryOptionLabel = "없는 분류는 자동으로 만들기",
  notes,
}: {
  spec: ImportSpec
  validate: ImportValidateAction
  commit: ImportCommitAction
  /** Label of the category option (only when spec.hasCategoryOption). */
  categoryOptionLabel?: string
  /** The page's own tips (e.g. a <ul> of short Korean lines), or nothing. */
  notes?: React.ReactNode
}) {
  const [loaded, setLoaded] = useState<LoadedFile | null>(null)
  const [checked, setChecked] = useState<Checked | null>(null)
  const [saved, setSaved] = useState<Saved | null>(null)
  /** A red message: the file can't be used, checking or saving failed. */
  const [problem, setProblem] = useState<string | null>(null)
  /** The row the database refused (shown first in the grid). */
  const [failedRow, setFailedRow] = useState<ImportFocusRow | null>(null)
  const [createMissingCategories, setCreateMissingCategories] = useState(true)
  const [isReading, setIsReading] = useState(false)
  const [isChecking, startChecking] = useTransition()
  const [isSaving, startSaving] = useTransition()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [downloading, setDownloading] = useState<"template" | "errors" | null>(
    null
  )
  const [templateDownloaded, setTemplateDownloaded] = useState(false)

  // Each file and each 다시 확인 gets a new number; an answer that arrives
  // after a newer request started is ignored.
  const requestRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Next.js keeps this page (hidden) when the user goes to another page:
  // close the confirm dialog then.
  useLayoutEffect(() => {
    return () => setConfirmOpen(false)
  }, [])

  const preview = checked?.preview ?? null
  const busy = isReading || isChecking || isSaving
  const canRegister =
    preview !== null && preview.ok > 0 && !busy && saved === null

  function toInput(file: LoadedFile, createMissing: boolean): ImportInput {
    return {
      sheets: importSheetsInput(file.sheets),
      createMissingCategories: createMissing,
    }
  }

  // ---- 2. 파일 선택 → 3. 미리보기 --------------------------------------------

  function openFilePicker() {
    if (isSaving) return
    fileInputRef.current?.click()
  }

  async function handleFile(file: File) {
    if (isSaving) {
      toast.info("등록하는 중입니다. 끝난 뒤 다시 선택해 주세요.")
      return
    }
    const requestId = ++requestRef.current
    setLoaded(null)
    setChecked(null)
    setSaved(null)
    setProblem(null)
    setFailedRow(null)
    setIsReading(true)

    let read: Awaited<ReturnType<typeof readImportFile>>
    try {
      read = await readImportFile(file, spec)
    } catch (error) {
      console.error("Could not read the import file:", error)
      read = {
        ok: false,
        message:
          "파일을 읽지 못했습니다. 엑셀에서 파일을 열어 다시 저장한 뒤 올려 주세요.",
      }
    }
    if (requestId !== requestRef.current) return
    setIsReading(false)
    if (!read.ok) {
      setProblem(read.message)
      return
    }

    const next: LoadedFile = {
      name: file.name,
      size: file.size,
      sheets: read.sheets,
      rowCount: read.rowCount,
      warnings: read.warnings,
    }
    setLoaded(next)
    runCheck(next, createMissingCategories, requestId)
  }

  /** Sends the rows to `validate` (in a transition, see the other screens). */
  function runCheck(file: LoadedFile, createMissing: boolean, id: number) {
    const input = toInput(file, createMissing)
    startChecking(async () => {
      let result: ImportValidateResult
      try {
        result = await validate(input)
      } catch (error) {
        // A redirect from the server (e.g. to the login page when the
        // session has expired) is carried out by Next.js.
        unstable_rethrow(error)
        console.error(error)
        result = {
          ok: false,
          message:
            "파일 내용을 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 [다시 확인]을 눌러 주세요.",
        }
      }
      if (id !== requestRef.current) return
      if (result.ok) {
        setChecked({ preview: result.preview, id })
        setProblem(null)
      } else {
        setChecked(null)
        setProblem(result.message)
      }
    })
  }

  /** [다시 확인 | F4]: the same rows against the database again. */
  function recheck() {
    if (!loaded || isSaving || saved) return
    const id = ++requestRef.current
    setProblem(null)
    setFailedRow(null)
    runCheck(loaded, createMissingCategories, id)
  }

  function changeCreateMissing(value: boolean) {
    setCreateMissingCategories(value)
    if (!loaded || saved) return
    const id = ++requestRef.current
    setProblem(null)
    setFailedRow(null)
    runCheck(loaded, value, id)
  }

  /** [다른 파일 올리기] after registering: an empty screen, then the picker. */
  function startOver() {
    requestRef.current++
    setLoaded(null)
    setChecked(null)
    setSaved(null)
    setProblem(null)
    setFailedRow(null)
    openFilePicker()
  }

  // A file dropped anywhere on the page (not only on the box) is read too,
  // instead of the browser opening it and leaving the screen.
  const handleWindowDrop = useEffectEvent((event: DragEvent) => {
    if (event.defaultPrevented || !dragHasFiles(event.dataTransfer)) return
    event.preventDefault()
    if (confirmOpen) return
    const file = event.dataTransfer?.files[0]
    if (file) void handleFile(file)
  })
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      if (dragHasFiles(event.dataTransfer)) event.preventDefault()
    }
    const onDrop = (event: DragEvent) => handleWindowDrop(event)
    window.addEventListener("dragover", onDragOver)
    window.addEventListener("drop", onDrop)
    return () => {
      window.removeEventListener("dragover", onDragOver)
      window.removeEventListener("drop", onDrop)
    }
  }, [])

  // ---- 4. 등록 ---------------------------------------------------------------

  function requestRegister() {
    if (canRegister) {
      setConfirmOpen(true)
      return
    }
    if (isSaving) return
    if (isReading || isChecking) {
      toast.info("파일을 확인하는 중입니다. 끝난 뒤 다시 눌러 주세요.")
    } else if (saved) {
      toast.info("이미 등록했습니다. 새로 등록하려면 다른 파일을 올려 주세요.")
    } else if (!loaded) {
      toast.info("먼저 [파일 선택]으로 등록할 파일을 올려 주세요.")
    } else if (preview && preview.ok === 0) {
      toast.info(
        "등록할 정상 행이 없습니다. 오류를 고친 파일을 다시 올려 주세요."
      )
    }
  }

  function register() {
    if (!loaded || !preview || !canRegister) return
    const input = toInput(loaded, createMissingCategories)
    const okRowKeys = preview.rows
      .filter((row) => row.status === "ok")
      .map(importRowKey)

    startSaving(async () => {
      let result: ImportCommitResult
      try {
        result = await commit(input, okRowKeys)
      } catch (error) {
        unstable_rethrow(error)
        console.error(error)
        setConfirmOpen(false)
        const message = `등록 결과를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤, 먼저 ‘${spec.listLabel}’에서 등록되었는지 확인해 주세요. 등록되지 않았다면 다시 등록하면 됩니다.`
        setProblem(message)
        toast.error(message)
        return
      }
      setConfirmOpen(false)
      if (result.ok) {
        setSaved(result)
        setProblem(null)
        setFailedRow(null)
        toast.success(result.message)
        return
      }
      setProblem(result.message)
      toast.error("등록하지 못했습니다.", { description: result.message })
      if (result.preview) {
        setChecked({ preview: result.preview, id: ++requestRef.current })
      }
      setFailedRow(
        result.failedRow
          ? {
              sheet: result.failedRow.sheet,
              excelRow: result.failedRow.excelRow,
            }
          : null
      )
    })
  }

  // Leaving the page while the rows are being saved: ask first.
  useEffect(() => {
    if (!isSaving) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [isSaving])

  // ---- Excel files -----------------------------------------------------------

  async function downloadTemplate() {
    if (downloading) return
    setDownloading("template")
    try {
      await downloadImportTemplate(spec)
      setTemplateDownloaded(true)
      toast.success(`양식 파일(${spec.templateFileName})을 내려받았습니다.`, {
        description:
          "‘작성방법’ 시트를 참고해 채운 뒤 [파일 선택]으로 올려 주세요.",
      })
    } catch (error) {
      console.error(error)
      toast.error("양식 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.")
    } finally {
      setDownloading(null)
    }
  }

  async function downloadErrors() {
    if (downloading) return
    if (!loaded || !preview || preview.error === 0) {
      toast.info("오류가 있는 행이 없습니다.")
      return
    }
    setDownloading("errors")
    try {
      const rows = await downloadImportErrors(spec, loaded.sheets, preview)
      toast.success(
        `오류 목록 ${formatNumber(rows, 0)}행을 엑셀 파일로 내려받았습니다.`,
        {
          description:
            "‘오류 내용’ 칸을 보고 고친 뒤, 그 파일을 그대로 다시 올리면 됩니다.",
        }
      )
    } catch (error) {
      console.error(error)
      toast.error(
        "오류 목록 파일을 만들지 못했습니다. 잠시 후 다시 시도해 주세요."
      )
    } finally {
      setDownloading(null)
    }
  }

  // ---- Keyboard --------------------------------------------------------------

  useHotkeys({
    F4: () => {
      if (!confirmOpen) recheck()
    },
    F8: () => {
      if (confirmOpen) register()
      else requestRegister()
    },
    "Ctrl+F9": () => {
      if (!confirmOpen) void downloadErrors()
    },
  })

  // ---- Screen ----------------------------------------------------------------

  const step: ImportStep = saved
    ? 5
    : confirmOpen || isSaving
      ? 4
      : preview
        ? 3
        : loaded || templateDownloaded
          ? 2
          : 1

  const status = isReading
    ? "파일을 읽는 중입니다…"
    : isSaving
      ? "등록하는 중입니다…"
      : isChecking
        ? `${formatNumber(loaded?.rowCount ?? 0, 0)}행을 확인하는 중입니다…`
        : null

  const okLabel = preview
    ? `정상 ${formatNumber(preview.ok, 0)}건 등록`
    : "등록"

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ActionBar
        end={
          <ActionButton
            keyHint="Ctrl+F9"
            disabled={!preview || preview.error === 0 || downloading !== null}
            onClick={() => void downloadErrors()}
          >
            {downloading === "errors" ? (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            ) : (
              <DownloadIcon aria-hidden="true" />
            )}
            오류 목록 엑셀로 받기
          </ActionButton>
        }
      >
        <ActionButton
          disabled={downloading !== null}
          onClick={() => void downloadTemplate()}
        >
          {downloading === "template" ? (
            <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
          ) : (
            <DownloadIcon aria-hidden="true" />
          )}
          양식 다운로드
        </ActionButton>
        <ActionButton disabled={isSaving} onClick={openFilePicker}>
          <UploadIcon aria-hidden="true" />
          파일 선택
        </ActionButton>
        <ActionButton
          variant="neutral"
          keyHint="F4"
          disabled={!loaded || busy || saved !== null}
          onClick={recheck}
        >
          <RefreshCwIcon aria-hidden="true" />
          다시 확인
        </ActionButton>
        <ActionButton
          keyHint="F8"
          disabled={!canRegister}
          onClick={requestRegister}
        >
          {okLabel}
        </ActionButton>
      </ActionBar>

      <ImportSteps current={step} />

      {/* The real file input, opened by [파일 선택] and the box. */}
      <input
        ref={fileInputRef}
        type="file"
        accept={IMPORT_FILE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // Cleared, so choosing the same (fixed) file again reads it again.
          event.target.value = ""
          if (file) void handleFile(file)
        }}
      />

      <ImportDropZone
        file={
          loaded
            ? {
                name: loaded.name,
                size: loaded.size,
                summary: fileSummary(spec, loaded),
              }
            : null
        }
        status={status}
        disabled={isSaving}
        onPick={openFilePicker}
        onFile={(file) => void handleFile(file)}
      />

      {spec.hasCategoryOption && (
        <div className="flex flex-col gap-0.5 border border-input bg-label px-3 py-2">
          <label className="flex min-h-7 w-fit cursor-pointer items-center gap-2 text-[13px] font-bold">
            <Checkbox
              checked={createMissingCategories}
              disabled={isSaving || saved !== null}
              onCheckedChange={(value) => changeCreateMissing(value)}
            />
            {categoryOptionLabel}
          </label>
          <p className="pl-6 text-xs text-muted-foreground">
            {createMissingCategories
              ? "파일에 적은 대·중·소분류가 없으면 등록할 때 새로 만듭니다. 사용 중지된 분류는 쓸 수 없습니다."
              : "등록되어 있지 않은 분류를 적은 행은 오류가 됩니다. 분류 이름을 잘못 적어 새 분류가 생기는 것을 막고 싶을 때 끄세요."}
          </p>
        </div>
      )}

      {notes && (
        <div className="border border-input bg-background px-3 py-2 text-[13px]">
          {notes}
        </div>
      )}

      {loaded && loaded.warnings.length > 0 && (
        <ul className="flex flex-col gap-0.5 border border-input bg-background px-3 py-2 text-[13px] text-muted-foreground">
          {loaded.warnings.map((warning) => (
            <li key={warning}>참고: {warning}</li>
          ))}
        </ul>
      )}

      {problem && (
        <div
          role="alert"
          className="flex items-start gap-2 border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-[13px] font-bold text-destructive"
        >
          <TriangleAlertIcon
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0"
          />
          <p className="whitespace-pre-line">{problem}</p>
        </div>
      )}

      {saved && preview && (
        <SavedPanel
          spec={spec}
          saved={saved}
          errorRows={preview.error}
          onStartOver={startOver}
        />
      )}

      {preview && loaded && checked && (
        <section
          aria-labelledby="import-preview-title"
          aria-busy={isChecking}
          className={cn(
            "flex min-w-0 flex-col gap-2 transition-opacity",
            isChecking && "opacity-60"
          )}
        >
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-grid-line pb-1.5">
            <h2 id="import-preview-title" className="text-base font-bold">
              미리보기
            </h2>
            <PreviewTotals preview={preview} />
          </div>

          {preview.newCategories.length > 0 && (
            <NewCategories paths={preview.newCategories} saved={!!saved} />
          )}

          <ImportPreviewGrid
            key={`${checked.id}:${failedRow ? importRowKey(failedRow) : ""}`}
            spec={spec}
            sheets={loaded.sheets}
            preview={preview}
            registered={saved !== null}
            focusRow={failedRow}
          />

          {!saved && (
            <div className="flex flex-col items-center gap-2 border-t border-grid-line pt-3 text-center">
              <p className="text-[13px]">
                {preview.ok === 0 ? (
                  <span className="font-bold text-destructive">
                    등록할 수 있는 정상 행이 없습니다. 오류를 고친 파일을 다시
                    올려 주세요.
                  </span>
                ) : preview.error > 0 ? (
                  <>
                    <span className="font-bold text-destructive">
                      오류 {formatNumber(preview.error, 0)}행은 등록하지
                      않습니다.
                    </span>{" "}
                    오류를 고친 뒤 다시 올리거나, 정상 행만 먼저 등록하고 오류
                    행은 [오류 목록 엑셀로 받기]로 받아 고쳐서 따로 올리세요.
                  </>
                ) : (
                  "모든 행이 정상입니다."
                )}
              </p>
              <ActionButton
                size="lg"
                keyHint="F8"
                disabled={!canRegister}
                onClick={requestRegister}
              >
                {okLabel}
              </ActionButton>
            </div>
          )}
        </section>
      )}

      <ImportGuide spec={spec} />

      <ErpDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !isSaving) setConfirmOpen(false)
        }}
        title={okLabel}
        size="md"
        footer={
          <>
            <ActionButton
              variant="secondary"
              size="lg"
              disabled={isSaving}
              onClick={() => setConfirmOpen(false)}
            >
              취소
            </ActionButton>
            <ActionButton
              size="lg"
              keyHint="F8"
              disabled={isSaving}
              onClick={register}
            >
              {isSaving && (
                <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
              )}
              등록
            </ActionButton>
          </>
        }
      >
        {preview && (
          <div className="flex flex-col gap-2 py-1 text-sm">
            <p>
              정상{" "}
              <strong className="font-bold text-brand">
                {formatNumber(preview.ok, 0)}건
              </strong>
              을 등록할까요?
            </p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px]">
              {preview.error > 0 && (
                <li className="font-bold text-destructive">
                  오류 {formatNumber(preview.error, 0)}행은 등록하지 않고
                  건너뜁니다.
                </li>
              )}
              {preview.skipped > 0 && (
                <li>
                  이미 있는 {formatNumber(preview.skipped, 0)}행은 건너뜁니다.
                </li>
              )}
              {preview.newCategories.length > 0 && (
                <li>
                  새 분류 {formatNumber(preview.newCategories.length, 0)}개도
                  함께 만듭니다.
                </li>
              )}
              <li>
                한꺼번에 등록합니다. 중간에 문제가 생기면 아무것도 등록하지
                않습니다.
              </li>
              <li className="text-muted-foreground">
                등록한 뒤에는 이 화면에서 되돌릴 수 없습니다. 고칠 내용은 ‘
                {spec.listLabel}’에서 수정해 주세요.
              </li>
            </ul>
          </div>
        )}
      </ErpDialog>
    </div>
  )
}

/** "‘직원’ 시트 30행을 읽었습니다." / "‘기준상품’ 시트 12행, ‘묶음상품’ 시트 3행 …". */
function fileSummary(spec: ImportSpec, file: LoadedFile): string {
  const parts = spec.sheets
    .map((sheet) => file.sheets[sheet.key])
    .filter((sheet) => sheet && sheet.rows.length > 0)
    .map((sheet) =>
      sheet.sheetName === "CSV"
        ? `${formatNumber(sheet.rows.length, 0)}행`
        : `‘${sheet.sheetName}’ 시트 ${formatNumber(sheet.rows.length, 0)}행`
    )
  const total =
    parts.length > 1 ? ` (모두 ${formatNumber(file.rowCount, 0)}행)` : ""
  return `${parts.join(", ")}${total}을 읽었습니다.`
}

/** 총 N행 · 정상 M · 오류 K (· 건너뜀 S). */
function PreviewTotals({ preview }: { preview: ImportPreview }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[13px]">
      <span>
        총{" "}
        <strong className="font-bold">{formatNumber(preview.total, 0)}</strong>
        행
      </span>
      <span aria-hidden="true" className="text-muted-foreground">
        ·
      </span>
      <span>
        정상{" "}
        <strong className="font-bold text-brand">
          {formatNumber(preview.ok, 0)}
        </strong>
      </span>
      <span aria-hidden="true" className="text-muted-foreground">
        ·
      </span>
      <span>
        오류{" "}
        <strong
          className={cn("font-bold", preview.error > 0 && "text-destructive")}
        >
          {formatNumber(preview.error, 0)}
        </strong>
      </span>
      {preview.skipped > 0 && (
        <>
          <span aria-hidden="true" className="text-muted-foreground">
            ·
          </span>
          <span>
            건너뜀{" "}
            <strong className="font-bold">
              {formatNumber(preview.skipped, 0)}
            </strong>
          </span>
        </>
      )}
    </p>
  )
}

/** Categories the import creates ("새로 만들 분류 3개: 가공식품 > 통조림, …"). */
function NewCategories({ paths, saved }: { paths: string[]; saved: boolean }) {
  const shown = paths.slice(0, 10)
  return (
    <div className="border border-brand-border bg-brand-tint px-3 py-2 text-[13px]">
      <p className="font-bold text-brand-active">
        {saved ? "새로 만든 분류" : "등록할 때 새로 만들 분류"}{" "}
        {formatNumber(paths.length, 0)}개
      </p>
      <p className="text-foreground">
        {shown.join(", ")}
        {paths.length > shown.length && (
          <> 외 {formatNumber(paths.length - shown.length, 0)}개</>
        )}
      </p>
      {paths.length > shown.length && (
        <details className="mt-1">
          <summary className="w-fit cursor-pointer text-xs font-bold text-brand-active">
            모두 보기
          </summary>
          <ul className="mt-1 columns-1 gap-6 text-xs sm:columns-2 lg:columns-3">
            {paths.map((path) => (
              <li key={path}>{path}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

/** The result after registering, with a link to the list screen. */
function SavedPanel({
  spec,
  saved,
  errorRows,
  onStartOver,
}: {
  spec: ImportSpec
  saved: Saved
  errorRows: number
  onStartOver: () => void
}) {
  const codes = saved.codes.slice(0, RESULT_CODES_SHOWN)
  return (
    <section
      aria-labelledby="import-saved-title"
      className="flex flex-col gap-2 border border-brand-border bg-brand-tint px-4 py-3"
    >
      <h2
        id="import-saved-title"
        className="flex items-center gap-1.5 text-base font-bold text-brand-active"
      >
        <CircleCheckIcon aria-hidden="true" className="size-5" />
        등록을 마쳤습니다
      </h2>
      <p className="text-sm font-bold">{saved.message}</p>
      {codes.length > 0 && (
        <p className="text-[13px] break-all">
          <span className="font-bold">등록한 코드:</span> {codes.join(", ")}
          {saved.codes.length > codes.length && (
            <> 외 {formatNumber(saved.codes.length - codes.length, 0)}개</>
          )}
        </p>
      )}
      {errorRows > 0 && (
        <p className="text-[13px] font-bold text-destructive">
          오류 {formatNumber(errorRows, 0)}행은 등록하지 않았습니다. [오류 목록
          엑셀로 받기]로 내려받아 고친 뒤 다시 올려 주세요.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5 pt-1">
        <Link href={spec.listHref} className={actionButtonClassName()}>
          {spec.listLabel}에서 확인
        </Link>
        <ActionButton variant="neutral" onClick={onStartOver}>
          <UploadIcon aria-hidden="true" />
          다른 파일 올리기
        </ActionButton>
      </div>
    </section>
  )
}
