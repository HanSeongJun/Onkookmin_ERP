import Link from "next/link"
import { Suspense } from "react"

import { actionButtonClassName } from "@/components/erp/action-bar"
import { PageTitle } from "@/components/erp/page-title"
import { requireUser } from "@/lib/auth/user"
import type { ImportSpec } from "@/lib/imports/columns"

import {
  ImportScreen,
  type ImportCommitAction,
  type ImportValidateAction,
} from "./import-screen"
import { ImportScreenSkeleton } from "./import-screen-skeleton"

/**
 * A whole 자료일괄등록 page (Server Component): the title with a link to the
 * list screen, then the shared ImportScreen for `spec`, rendered after the
 * login check inside <Suspense>.
 *
 * Each page passes its spec and its two Server Actions from
 * `@/lib/imports/actions`:
 * @example
 * export default function EmployeeImportPage() {
 *   return (
 *     <ImportPage
 *       spec={EMPLOYEE_IMPORT}
 *       description="엑셀 파일로 직원 여러 명을 한 번에 등록합니다."
 *       validate={validateEmployeeImport}
 *       commit={commitEmployeeImport}
 *     />
 *   )
 * }
 */
export function ImportPage({
  spec,
  description,
  validate,
  commit,
  categoryOptionLabel,
  notes,
}: {
  spec: ImportSpec
  /** Grey note next to the title. */
  description: string
  validate: ImportValidateAction
  commit: ImportCommitAction
  /**
   * Label of the "없는 분류는 자동으로 만들기" checkbox, shown when
   * spec.hasCategoryOption (e.g. "없는 거래처분류는 자동으로 만들기").
   */
  categoryOptionLabel?: string
  /** The page's own tips, shown in a box under the file box. */
  notes?: React.ReactNode
}) {
  return (
    <>
      <PageTitle
        title={spec.title}
        description={description}
        actions={
          <Link
            href={spec.listHref}
            className={actionButtonClassName({ variant: "neutral" })}
          >
            {spec.listLabel} 열기
          </Link>
        }
      />

      {/* The screen needs the login session, so it streams in here. */}
      <Suspense fallback={<ImportScreenSkeleton />}>
        <SignedInImportScreen
          spec={spec}
          validate={validate}
          commit={commit}
          categoryOptionLabel={categoryOptionLabel}
          notes={notes}
        />
      </Suspense>
    </>
  )
}

async function SignedInImportScreen(
  props: React.ComponentProps<typeof ImportScreen>
) {
  await requireUser()
  return <ImportScreen {...props} />
}
