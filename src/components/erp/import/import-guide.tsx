import { ChevronRightIcon } from "lucide-react"

import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import type { ImportSheetSpec, ImportSpec } from "@/lib/imports/columns"

/**
 * "작성방법과 열 목록 보기" (closed at first): the same help as the
 * template's 작성방법 sheet — the import's instructions, then every column
 * of every sheet with 필수, 형식, 입력할 수 있는 값 and 설명.
 */
export function ImportGuide({ spec }: { spec: ImportSpec }) {
  const multi = spec.sheets.length > 1
  return (
    <details className="group border border-input">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 bg-label px-3 py-2 text-[13px] font-bold outline-none select-none hover:bg-brand-tint-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-open:rotate-90"
        />
        작성방법과 열 목록 보기
        <span className="font-normal text-muted-foreground">
          (양식 파일의 ‘작성방법’ 시트와 같은 내용)
        </span>
      </summary>
      <div className="flex flex-col gap-4 p-3">
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px]">
          {spec.instructions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        {spec.sheets.map((sheet) => (
          <GuideSheet key={sheet.key} sheet={sheet} showName={multi} />
        ))}
      </div>
    </details>
  )
}

/** The columns of one sheet as a table. */
function GuideSheet({
  sheet,
  showName,
}: {
  sheet: ImportSheetSpec
  showName: boolean
}) {
  return (
    <section className="flex flex-col gap-1.5">
      {showName && (
        <h3 className="text-[13px] font-bold">‘{sheet.sheetName}’ 시트</h3>
      )}
      <DataGrid
        aria-label={`${sheet.sheetName} 시트의 열`}
        containerClassName="max-h-[32rem]"
      >
        <DataGridHeader>
          <tr>
            <DataGridHead>열 이름</DataGridHead>
            <DataGridHead>필수</DataGridHead>
            <DataGridHead>형식</DataGridHead>
            <DataGridHead>입력할 수 있는 값</DataGridHead>
            <DataGridHead>설명</DataGridHead>
          </tr>
        </DataGridHeader>
        <DataGridBody>
          {sheet.columns.map((column) => (
            <DataGridRow key={column.key}>
              <DataGridCell className="font-bold">{column.header}</DataGridCell>
              <DataGridCell
                align="center"
                className={
                  column.required ? "font-bold text-destructive" : undefined
                }
              >
                {column.required ? "필수" : "선택"}
              </DataGridCell>
              <DataGridCell className="min-w-56 py-1 whitespace-normal">
                {column.format}
              </DataGridCell>
              <DataGridCell className="min-w-56 py-1 whitespace-normal">
                {column.allowed ?? ""}
              </DataGridCell>
              <DataGridCell className="min-w-72 py-1 whitespace-normal">
                {column.help}
              </DataGridCell>
            </DataGridRow>
          ))}
        </DataGridBody>
      </DataGrid>
    </section>
  )
}
