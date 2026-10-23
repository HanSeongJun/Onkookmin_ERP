import { ChevronRightIcon } from "lucide-react"
import { Suspense } from "react"

import { getEmployeeOptions } from "@/lib/employees/queries"
import {
  employeeDutyLabel,
  selectableEmployees,
  type EmployeeDuty,
  type EmployeeOption,
} from "@/lib/employees/schema"
import { getPartnerCategoryTree } from "@/lib/partner-categories/queries"
import {
  findCategoryPath,
  flattenCategoryTree,
  formatCategoryPath,
  isCategorySelectable,
} from "@/lib/partner-categories/tree"

/**
 * Reference for filling in a 거래처 file, under the tips of 거래처
 * 일괄등록: the 직원코드 that may be written as 영업담당 / 배송담당 (재직
 * employees with that 담당업무, the same ones the 거래처 form offers) and
 * every 거래처분류 a partner can be put in (사용 together with every
 * category above it), as "대분류 > 중분류 > 소분류". Both lists start
 * closed.
 *
 * Reads the database with the signed-in user's cookies, so it renders
 * inside its own <Suspense> (never inside "use cache").
 */
export function PartnerImportReference() {
  return (
    <Suspense
      fallback={
        <p className="text-muted-foreground">
          직원코드와 거래처분류를 불러오는 중…
        </p>
      }
    >
      <ReferenceLists />
    </Suspense>
  )
}

async function ReferenceLists() {
  const [employees, tree] = await Promise.all([
    getEmployeeOptions(),
    getPartnerCategoryTree(),
  ])
  const salesReps = repsByCode(employees, "sales")
  const deliveryReps = repsByCode(employees, "delivery")
  const categoryPaths = flattenCategoryTree(tree)
    .filter((category) => isCategorySelectable(tree, category.id))
    .map((category) => ({
      id: category.id,
      text: formatCategoryPath(findCategoryPath(tree, category.id)),
    }))

  return (
    <div className="flex flex-col gap-1">
      <ReferenceDetails
        title="영업담당·배송담당으로 적을 수 있는 직원코드 보기"
        summary={`영업담당 ${salesReps.length}명 · 배송담당 ${deliveryReps.length}명`}
      >
        <dl className="grid gap-x-3 gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="font-bold">영업담당</dt>
          <dd>
            <EmployeeCodeList employees={salesReps} duty="sales" />
          </dd>
          <dt className="font-bold">배송담당</dt>
          <dd>
            <EmployeeCodeList employees={deliveryReps} duty="delivery" />
          </dd>
        </dl>
      </ReferenceDetails>

      <ReferenceDetails
        title="지금 쓸 수 있는 거래처분류 보기"
        summary={`${categoryPaths.length}개`}
      >
        {categoryPaths.length === 0 ? (
          <p className="text-muted-foreground">
            지금 쓸 수 있는 거래처분류가 없습니다. 파일에 적은 분류는 ‘없는
            거래처분류는 자동으로 만들기’가 켜져 있으면 새로 만들어집니다.
          </p>
        ) : (
          <ul className="max-h-60 overflow-y-auto border border-grid-line px-2 py-1">
            {categoryPaths.map((path) => (
              <li key={path.id} className="break-all">
                {path.text}
              </li>
            ))}
          </ul>
        )}
      </ReferenceDetails>
    </div>
  )
}

/** 재직 employees with this 담당업무, in 직원코드 order (0002, 0003, …). */
function repsByCode(
  employees: readonly EmployeeOption[],
  duty: EmployeeDuty
): EmployeeOption[] {
  // selectableEmployees returns a new array, so sorting it in place is fine.
  return selectableEmployees(employees, duty, null).sort((a, b) =>
    a.code.localeCompare(b.code, "ko-KR", { numeric: true })
  )
}

/** A closed-at-first section: "› title (summary)", then the content. */
function ReferenceDetails({
  title,
  summary,
  children,
}: {
  title: string
  summary: string
  children: React.ReactNode
}) {
  return (
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm py-0.5 font-bold text-brand outline-none select-none hover:underline focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform group-open:rotate-90"
        />
        {title}
        <span className="font-normal text-muted-foreground">({summary})</span>
      </summary>
      <div className="pt-1.5 pb-1 pl-5">{children}</div>
    </details>
  )
}

/** "0002 김영길" boxes, or a note when nobody has the 담당업무. */
function EmployeeCodeList({
  employees,
  duty,
}: {
  employees: readonly EmployeeOption[]
  duty: EmployeeDuty
}) {
  if (employees.length === 0) {
    const dutyLabel = employeeDutyLabel(duty)
    return (
      <p className="text-muted-foreground">
        없음 (직원관리에서 담당업무 ‘{dutyLabel}’을 체크한 재직 직원이 없습니다)
      </p>
    )
  }
  return (
    <ul className="flex flex-wrap gap-1">
      {employees.map((employee) => (
        <li
          key={employee.id}
          className="border border-grid-line bg-label px-1.5 py-px"
        >
          <span className="font-bold tabular-nums">{employee.code}</span>{" "}
          {employee.name}
          {duty === "delivery" && employee.vehicleNumber && (
            <span className="text-muted-foreground">
              {" "}
              ({employee.vehicleNumber})
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
