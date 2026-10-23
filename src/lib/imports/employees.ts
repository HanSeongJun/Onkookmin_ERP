/**
 * 직원 일괄등록 (/imports/employees): one row = one 직원. A row without
 * 직원코드 gets the next number automatically (0015, 0016, … in file
 * order, given by the database when registering).
 *
 * The spec (columns, template examples) and the check of a file, reusing
 * the 직원 등록 form's zod rules (`@/lib/employees/schema`). No server
 * imports: Client Components use this file too.
 */

import {
  DRIVER_OPERATION_TYPES,
  EMPLOYEE_LIMITS,
  EMPLOYMENT_TYPES,
  employeeFormSchema,
  VEHICLE_TYPES,
  type DriverOperationType,
  type EmploymentType,
  type VehicleType,
} from "@/lib/employees/schema"
import {
  addCellFlags,
  addZodIssues,
  buildPreview,
  codeKey,
  findDuplicates,
  placesText,
  RowIssues,
} from "@/lib/imports/check"
import { MAIN_SHEET, type ImportSpec } from "@/lib/imports/columns"
import type {
  ImportInput,
  ImportPreview,
  ImportRawRow,
  ImportRowResult,
} from "@/lib/imports/types"
import {
  cellText,
  choiceLabels,
  dateText,
  matchChoice,
  NO_WORDS,
  phoneText,
  postalCodeText,
  YES_NO_CHOICES,
  YES_WORDS,
  type ImportChoice,
} from "@/lib/imports/values"

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

/** 재직여부: 재직 / 퇴사 (also Y/N …). */
export const EMPLOYEE_STATUS_CHOICES: readonly ImportChoice<boolean>[] = [
  {
    value: true,
    label: "재직",
    aliases: [...YES_WORDS, "재직중", "근무", "근무중"],
  },
  { value: false, label: "퇴사", aliases: [...NO_WORDS, "퇴직", "퇴사자"] },
]

/** 고용형태 (optional). */
export const EMPLOYMENT_CHOICES: readonly ImportChoice<EmploymentType>[] =
  EMPLOYMENT_TYPES.map((type) => ({
    value: type.value,
    label: type.label,
    aliases:
      type.value === "regular"
        ? ["정규"]
        : type.value === "contract"
          ? ["계약"]
          : type.value === "daily"
            ? ["일용"]
            : type.value === "freelancer"
              ? ["프리"]
              : [],
  }))

/** 운영형태 of a 배송기사 (optional). */
export const DRIVER_OPERATION_CHOICES: readonly ImportChoice<DriverOperationType>[] =
  DRIVER_OPERATION_TYPES.map((type) => ({
    value: type.value,
    label: type.label,
  }))

const VEHICLE_ALIASES: Partial<Record<VehicleType, readonly string[]>> = {
  refrigerated_truck: ["냉장차"],
  frozen_truck: ["냉동차"],
  box_truck: ["탑차"],
  cargo_truck: ["카고트럭", "화물차"],
  small_van: ["소형", "다마스", "라보"],
}

/** 차량종류 of a 배송기사 (optional). */
export const VEHICLE_CHOICES: readonly ImportChoice<VehicleType>[] =
  VEHICLE_TYPES.map((type) => ({
    value: type.value,
    label: type.label,
    aliases: VEHICLE_ALIASES[type.value] ?? [],
  }))

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

const PHONE_FORMAT = "전화번호 (하이픈 있어도 없어도 됨, 예: 010-1234-5678)"
const DATE_FORMAT = "날짜 (예: 2026-03-02, 2026.03.02, 2026/03/02, 20260302)"
const YES_NO = `${choiceLabels(YES_NO_CHOICES)} (예/아니오, O/X도 됨)`
const text = (max: number) => `글자 ${max.toLocaleString("ko-KR")}자 이내`

export const EMPLOYEE_IMPORT: ImportSpec = {
  kind: "employees",
  title: "직원 일괄등록",
  entityLabel: "직원",
  templateFileName: "직원_일괄등록_양식.xlsx",
  listHref: "/employees",
  listLabel: "직원관리",
  hasCategoryOption: false,
  instructions: [
    "‘직원’ 시트의 2행부터 한 줄에 직원 한 명씩 적어 주세요. 첫 줄(열 이름)은 지우거나 바꾸지 마세요. 열 이름 뒤의 *는 꼭 채워야 하는 칸입니다.",
    "직원코드를 비우면 등록할 때 다음 번호(예: 0015, 0016 …)를 파일 순서대로 자동으로 붙입니다. 직접 적은 직원코드가 이미 등록되어 있으면 오류입니다.",
    "판매 플랫폼(쿠팡, 스마트스토어 등)도 직원으로 등록하고 ‘영업담당’을 Y로 적습니다. 배송 기사는 ‘배송담당’을 Y로 적고 운영형태·차량번호·차량종류를 적습니다.",
    "퇴사일은 재직여부가 ‘퇴사’일 때만, 운영형태·차량번호·차량종류는 배송담당이 Y일 때만 적어 주세요.",
    "등록만 합니다: 이미 있는 직원은 직원관리에서 수정해 주세요.",
    "‘예시’ 시트는 작성 예입니다. 등록되지 않습니다.",
    "엑셀(.xlsx) 또는 CSV 파일을 올릴 수 있고, 한 번에 3,000행까지 올릴 수 있습니다.",
  ],
  sheets: [
    {
      key: MAIN_SHEET,
      sheetName: "직원",
      columns: [
        {
          key: "code",
          header: "직원코드",
          required: false,
          format: `영문, 숫자, 하이픈(-), 밑줄(_), 마침표(.) ${EMPLOYEE_LIMITS.codeMaxLength}자 이내`,
          help: "비우면 숫자로 된 직원코드 중 가장 큰 번호 다음부터 자동으로 붙입니다(예: 0015).",
          width: 10,
          textFormat: true,
        },
        {
          key: "name",
          header: "직원명",
          required: true,
          format: text(EMPLOYEE_LIMITS.nameMaxLength),
          help: "직원 이름(판매 플랫폼이면 플랫폼 이름). 같은 이름도 등록할 수 있습니다.",
          width: 14,
          textFormat: true,
        },
        {
          key: "hireDate",
          header: "입사일",
          required: true,
          dateColumn: true,
          format: DATE_FORMAT,
          help: "입사한 날.",
          width: 12,
          textFormat: false,
        },
        {
          key: "isActive",
          header: "재직여부",
          required: false,
          format: "재직 또는 퇴사",
          allowed: `${choiceLabels(EMPLOYEE_STATUS_CHOICES)} (비우면 재직)`,
          help: "퇴사한 직원은 거래처의 영업담당·배송담당으로 새로 지정할 수 없습니다.",
          width: 10,
          textFormat: true,
        },
        {
          key: "isSalesRep",
          header: "영업담당",
          required: false,
          format: "Y 또는 N",
          allowed: `${YES_NO} (비우면 N)`,
          help: "담당업무: 영업담당(판매 채널·플랫폼 또는 영업 직원).",
          width: 9,
          textFormat: true,
        },
        {
          key: "isDeliveryDriver",
          header: "배송담당",
          required: false,
          format: "Y 또는 N",
          allowed: `${YES_NO} (비우면 N)`,
          help: "담당업무: 배송담당(직배송 기사).",
          width: 9,
          textFormat: true,
        },
        {
          key: "mobile",
          header: "휴대폰번호1",
          aliases: ["휴대폰번호", "휴대폰"],
          required: true,
          format: PHONE_FORMAT,
          help: "주로 쓰는 휴대폰 번호.",
          width: 15,
          textFormat: true,
        },
        {
          key: "mobile2",
          header: "휴대폰번호2",
          required: false,
          format: PHONE_FORMAT,
          help: "두 번째 휴대폰 번호.",
          width: 15,
          textFormat: true,
        },
        {
          key: "email",
          header: "이메일",
          required: false,
          format: "이메일 주소 (예: name@example.com)",
          help: "",
          width: 22,
          textFormat: true,
        },
        {
          key: "phone",
          header: "전화번호",
          required: false,
          format: PHONE_FORMAT,
          help: "집·사무실 전화번호.",
          width: 15,
          textFormat: true,
        },
        {
          key: "postalCode",
          header: "우편번호",
          required: false,
          format: "숫자 5자리",
          help: "주소가 있어야 적을 수 있습니다.",
          width: 10,
          textFormat: true,
        },
        {
          key: "address",
          header: "주소",
          required: false,
          format: text(EMPLOYEE_LIMITS.addressMaxLength),
          help: "도로명 주소.",
          width: 30,
          textFormat: true,
        },
        {
          key: "addressDetail",
          header: "상세주소",
          required: false,
          format: text(EMPLOYEE_LIMITS.addressDetailMaxLength),
          help: "동·호수. 주소가 있어야 적을 수 있습니다.",
          width: 18,
          textFormat: true,
        },
        {
          key: "department",
          header: "부서명",
          aliases: ["부서"],
          required: false,
          format: text(EMPLOYEE_LIMITS.departmentMaxLength),
          help: "예: 영업팀, 배송팀",
          width: 12,
          textFormat: true,
        },
        {
          key: "jobTitle",
          header: "직급/직책",
          aliases: ["직급", "직책"],
          required: false,
          format: text(EMPLOYEE_LIMITS.jobTitleMaxLength),
          help: "예: 차장, 팀장",
          width: 12,
          textFormat: true,
        },
        {
          key: "employmentType",
          header: "고용형태",
          required: false,
          format: "목록에 있는 값 하나",
          allowed: `${choiceLabels(EMPLOYMENT_CHOICES)} (비우면 미지정)`,
          help: "",
          width: 10,
          textFormat: true,
        },
        {
          key: "isSalaryPaid",
          header: "급여지급여부",
          aliases: ["급여지급"],
          required: false,
          format: "Y 또는 N",
          allowed: `${YES_NO} (비우면 Y)`,
          help: "급여를 주는 직원인지(판매 플랫폼이면 보통 N).",
          width: 12,
          textFormat: true,
        },
        {
          key: "resignationDate",
          header: "퇴사일",
          required: false,
          dateColumn: true,
          format: DATE_FORMAT,
          help: "재직여부가 ‘퇴사’일 때만 적습니다. 입사일보다 앞설 수 없습니다.",
          width: 12,
          textFormat: false,
        },
        {
          key: "driverOperationType",
          header: "운영형태",
          required: false,
          format: "목록에 있는 값 하나",
          allowed: `${choiceLabels(DRIVER_OPERATION_CHOICES)} (배송담당이 Y일 때만)`,
          help: "직영 = 회사 차량, 지입 = 기사 본인 차량을 회사에 지입, 용차 = 필요할 때 빌리는 차량.",
          width: 10,
          textFormat: true,
        },
        {
          key: "vehicleNumber",
          header: "차량번호",
          required: false,
          format: text(EMPLOYEE_LIMITS.vehicleNumberMaxLength),
          help: "예: 12가3456 (배송담당이 Y일 때만)",
          width: 12,
          textFormat: true,
        },
        {
          key: "vehicleType",
          header: "차량종류",
          aliases: ["차량 종류"],
          required: false,
          format: "목록에 있는 값 하나",
          allowed: `${choiceLabels(VEHICLE_CHOICES)} (배송담당이 Y일 때만)`,
          help: "",
          width: 16,
          textFormat: true,
        },
        {
          key: "note",
          header: "비고",
          required: false,
          format: text(EMPLOYEE_LIMITS.noteMaxLength),
          help: "메모.",
          width: 24,
          textFormat: true,
        },
      ],
      examples: [
        {
          code: "",
          name: "홍길동",
          hireDate: "2026-03-02",
          isActive: "재직",
          isSalesRep: "N",
          isDeliveryDriver: "Y",
          mobile: "010-1234-5678",
          mobile2: "",
          email: "",
          phone: "",
          postalCode: "",
          address: "",
          addressDetail: "",
          department: "배송팀",
          jobTitle: "기사",
          employmentType: "정규직",
          isSalaryPaid: "Y",
          resignationDate: "",
          driverOperationType: "직영",
          vehicleNumber: "12가3456",
          vehicleType: "냉동탑차",
          note: "",
        },
        {
          code: "",
          name: "온라인몰A",
          hireDate: "2026-01-01",
          isActive: "재직",
          isSalesRep: "Y",
          isDeliveryDriver: "N",
          mobile: "010-0000-0000",
          mobile2: "",
          email: "",
          phone: "",
          postalCode: "",
          address: "",
          addressDetail: "",
          department: "온라인 판매",
          jobTitle: "",
          employmentType: "기타",
          isSalaryPaid: "N",
          resignationDate: "",
          driverOperationType: "",
          vehicleNumber: "",
          vehicleType: "",
          note: "판매 플랫폼",
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

/** What the database knows for the check. */
export type EmployeeImportLookups = {
  /**
   * Employees with a 직원코드 (ignoring case) or a 직원명 the file uses
   * (with their 휴대폰번호1 digits, for the "already registered?" note).
   */
  employees: readonly { code: string; name: string; mobile?: string | null }[]
  /**
   * The highest 직원코드 made only of digits in the database (0 when there
   * is none), as text: suggest_employee_code() − 1.
   */
  highestNumericCode: string
}

/** One 직원 row for import_employees (database column names). */
export type EmployeeImportRow = {
  excel_row: number
  /** null = 자동 (the database gives the next number). */
  code: string | null
  name: string
  hire_date: string
  is_active: boolean
  is_sales_rep: boolean
  is_delivery_driver: boolean
  mobile: string
  mobile2: string | null
  email: string | null
  phone: string | null
  postal_code: string | null
  address: string | null
  address_detail: string | null
  department: string | null
  job_title: string | null
  employment_type: EmploymentType | null
  is_salary_paid: boolean
  resignation_date: string | null
  driver_operation_type: DriverOperationType | null
  vehicle_number: string | null
  vehicle_type: VehicleType | null
  note: string | null
}

/** The argument of the database function import_employees. */
export type EmployeeImportPayload = { rows: EmployeeImportRow[] }

/** Form field → column key (the same names), for the zod messages. */
const EMPLOYEE_FIELDS: Record<string, string> = Object.fromEntries(
  EMPLOYEE_IMPORT.sheets[0].columns.map((column) => [column.key, column.key])
)

/** A valid 직원코드 the form rule accepts while the real one is 자동. */
const AUTO_CODE_PLACEHOLDER = "0"

const DRIVER_COLUMNS = ["driverOperationType", "vehicleNumber", "vehicleType"]

/** The 직원코드 the database gives a number: 4 digits at least (0015). */
export function formatEmployeeNumber(number: bigint): string {
  const digits = number.toString()
  return digits.length >= 4 ? digits : digits.padStart(4, "0")
}

/**
 * The codes and names the check needs from the database (for
 * import_find_employees, which matches both).
 */
export function employeeImportLookupKeys(input: ImportInput): {
  codes: string[]
} {
  const codes = new Set<string>()
  for (const row of input.sheets[MAIN_SHEET] ?? []) {
    const code = cellText(row.values.code)
    if (code !== "") codes.add(code)
    const name = cellText(row.values.name)
    if (name !== "") codes.add(name)
  }
  return { codes: [...codes] }
}

type EmployeeRowState = {
  raw: ImportRawRow
  issues: RowIssues
  /** "" = 자동. */
  code: string
  row: EmployeeImportRow | null
}

/** Checks one 직원 row on its own (form rules, choices). */
function readEmployeeRow(raw: ImportRawRow): EmployeeRowState {
  const issues = new RowIssues()
  addCellFlags(issues, raw)
  const values = raw.values

  const isActive = matchChoice(values.isActive, EMPLOYEE_STATUS_CHOICES)
  if (isActive === undefined) {
    issues.error(
      "isActive",
      `재직여부는 ${choiceLabels(EMPLOYEE_STATUS_CHOICES)} 중 하나로 입력해 주세요. (비우면 재직)`
    )
  }
  const isSalesRep = matchChoice(values.isSalesRep, YES_NO_CHOICES)
  if (isSalesRep === undefined) {
    issues.error(
      "isSalesRep",
      "영업담당은 Y 또는 N으로 입력해 주세요. (비우면 N)"
    )
  }
  const isDeliveryDriver = matchChoice(values.isDeliveryDriver, YES_NO_CHOICES)
  if (isDeliveryDriver === undefined) {
    issues.error(
      "isDeliveryDriver",
      "배송담당은 Y 또는 N으로 입력해 주세요. (비우면 N)"
    )
  }
  const isSalaryPaid = matchChoice(values.isSalaryPaid, YES_NO_CHOICES)
  if (isSalaryPaid === undefined) {
    issues.error(
      "isSalaryPaid",
      "급여지급여부는 Y 또는 N으로 입력해 주세요. (비우면 Y)"
    )
  }
  const employmentType = matchChoice(values.employmentType, EMPLOYMENT_CHOICES)
  if (employmentType === undefined) {
    issues.error(
      "employmentType",
      `고용형태는 ${choiceLabels(EMPLOYMENT_CHOICES)} 중 하나로 입력해 주세요. (비우면 미지정)`
    )
  }
  const driverOperationType = matchChoice(
    values.driverOperationType,
    DRIVER_OPERATION_CHOICES
  )
  if (driverOperationType === undefined) {
    issues.error(
      "driverOperationType",
      `운영형태는 ${choiceLabels(DRIVER_OPERATION_CHOICES)} 중 하나로 입력해 주세요.`
    )
  }
  const vehicleType = matchChoice(values.vehicleType, VEHICLE_CHOICES)
  if (vehicleType === undefined) {
    issues.error(
      "vehicleType",
      `차량종류는 ${choiceLabels(VEHICLE_CHOICES)} 중 하나로 입력해 주세요.`
    )
  }

  // The 등록 form simply drops these; in a file they are most likely a
  // mistake (e.g. 재직여부 left empty), so they are errors here.
  if (cellText(values.resignationDate) !== "" && isActive !== false) {
    issues.error(
      "resignationDate",
      "퇴사일은 재직여부가 ‘퇴사’일 때만 적어 주세요."
    )
  }
  if (isDeliveryDriver !== true) {
    for (const key of DRIVER_COLUMNS) {
      if (cellText(values[key]) !== "") {
        issues.error(
          key,
          "운영형태·차량번호·차량종류는 배송담당이 Y일 때만 적어 주세요."
        )
      }
    }
  }

  // (The form checks these only once every other field is fine; checked
  // here too, so a file shows all its problems at once.)
  if (
    cellText(values.address) === "" &&
    (cellText(values.postalCode) !== "" ||
      cellText(values.addressDetail) !== "")
  ) {
    issues.error(
      "address",
      "주소를 입력해 주세요. (우편번호나 상세주소만 따로 등록할 수 없습니다.)"
    )
  }
  const hireDate = dateText(values.hireDate)
  const resignationDate = dateText(values.resignationDate)
  if (
    isActive === false &&
    /^\d{4}-\d{2}-\d{2}$/.test(hireDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(resignationDate) &&
    resignationDate < hireDate
  ) {
    issues.error(
      "resignationDate",
      `퇴사일은 입사일(${hireDate})과 같거나 그 뒤여야 합니다.`
    )
  }

  const code = cellText(values.code)
  const parsed = employeeFormSchema.safeParse({
    isActive: isActive ?? true,
    isSalesRep: isSalesRep ?? false,
    isDeliveryDriver: isDeliveryDriver ?? false,
    code: code === "" ? AUTO_CODE_PLACEHOLDER : code,
    name: cellText(values.name),
    hireDate,
    mobile: phoneText(values.mobile),
    mobile2: phoneText(values.mobile2),
    email: cellText(values.email),
    phone: phoneText(values.phone),
    postalCode: postalCodeText(values.postalCode),
    address: cellText(values.address),
    addressDetail: cellText(values.addressDetail),
    note: cellText(values.note),
    department: cellText(values.department),
    jobTitle: cellText(values.jobTitle),
    employmentType: employmentType ?? "",
    isSalaryPaid: isSalaryPaid ?? true,
    resignationDate,
    driverOperationType: driverOperationType ?? "",
    vehicleNumber: cellText(values.vehicleNumber),
    vehicleType: vehicleType ?? "",
  })
  if (!parsed.success) addZodIssues(issues, parsed.error, EMPLOYEE_FIELDS)

  const row: EmployeeImportRow | null = parsed.success
    ? {
        excel_row: raw.excelRow,
        code: code === "" ? null : parsed.data.code,
        name: parsed.data.name,
        hire_date: parsed.data.hireDate,
        is_active: parsed.data.isActive,
        is_sales_rep: parsed.data.isSalesRep,
        is_delivery_driver: parsed.data.isDeliveryDriver,
        mobile: parsed.data.mobile,
        mobile2: parsed.data.mobile2,
        email: parsed.data.email,
        phone: parsed.data.phone,
        postal_code: parsed.data.postalCode,
        address: parsed.data.address,
        address_detail: parsed.data.addressDetail,
        department: parsed.data.department,
        job_title: parsed.data.jobTitle,
        employment_type: parsed.data.employmentType,
        is_salary_paid: parsed.data.isSalaryPaid,
        resignation_date: parsed.data.resignationDate,
        driver_operation_type: parsed.data.driverOperationType,
        vehicle_number: parsed.data.vehicleNumber,
        vehicle_type: parsed.data.vehicleType,
        note: parsed.data.note,
      }
    : null

  return { raw, issues, code, row }
}

/**
 * Checks every row of a 직원 file and returns the 미리보기 and the 정상
 * rows for import_employees:
 * 1. each row on its own: the 직원 등록 form's rules (직원명, 입사일,
 *    휴대폰번호1, phones, 이메일, 퇴사일 ≥ 입사일 …), the lists (재직여부,
 *    Y/N, 고용형태, 운영형태, 차량종류), 퇴사일 only for 퇴사, 배송기사
 *    정보 only for 배송담당;
 * 2. 직원코드 used twice in the file (ignoring case);
 * 3. 직원코드 already registered.
 * The 정상 rows without 직원코드 show the code they will most likely get
 * ("자동 0015"); the database gives the final one when registering.
 */
export function checkEmployeeImport(
  input: ImportInput,
  lookups: EmployeeImportLookups
): { preview: ImportPreview; payload: EmployeeImportPayload } {
  const rows = (input.sheets[MAIN_SHEET] ?? []).map(readEmployeeRow)

  for (const [state, others] of findDuplicates(
    rows,
    (state) => state.code,
    (state) => ({ sheetLabel: null, excelRow: state.raw.excelRow }),
    codeKey
  )) {
    state.issues.error(
      "code",
      `파일 안에서 같은 직원코드가 또 있습니다 (${placesText(others)}). 직원코드는 대소문자를 구분하지 않습니다.`
    )
  }
  const savedByCode = new Map(
    lookups.employees.map((employee) => [codeKey(employee.code), employee])
  )
  for (const state of rows) {
    const saved =
      state.code === "" ? undefined : savedByCode.get(codeKey(state.code))
    if (saved) {
      state.issues.error(
        "code",
        `이미 등록된 직원코드입니다 (${saved.code} ${saved.name}). 비우면 다음 번호를 자동으로 붙입니다.`
      )
    }
  }

  // The same person twice (same 직원명 and 휴대폰번호1): only a note, two
  // people may share both (e.g. 판매 플랫폼 with 010-0000-0000), but it
  // usually means the file was registered already (직원코드 자동 rows
  // would get new codes and be registered a second time).
  const personKey = (state: EmployeeRowState) =>
    state.row ? `${state.row.name}\u001f${state.row.mobile}` : null
  for (const [state, others] of findDuplicates(rows, personKey, (state) => ({
    sheetLabel: null,
    excelRow: state.raw.excelRow,
  }))) {
    state.issues.warn(
      "name",
      `파일 안 ${placesText(others)}과(와) 직원명·휴대폰번호1이 같습니다. 같은 사람을 두 번 적은 것이 아닌지 확인해 주세요.`
    )
  }
  for (const state of rows) {
    if (!state.row) continue
    const { name, mobile } = state.row
    const same = lookups.employees.filter(
      (employee) => employee.name === name && employee.mobile === mobile
    )
    if (same.length > 0) {
      state.issues.warn(
        "name",
        `직원명·휴대폰번호1이 같은 직원이 이미 있습니다: ${same
          .slice(0, 3)
          .map((employee) => `${employee.code} ${employee.name}`)
          .join(
            ", "
          )}. 이미 등록한 파일을 다시 올린 것이 아닌지 확인해 주세요. (그래도 등록됩니다)`
      )
    }
  }

  // The numbers the database will give (the same rule as import_employees):
  // after the highest all-digit code in the database and among the 정상
  // rows of the file, in file order.
  const okRows = rows.filter((state) => !state.issues.hasErrors)
  let lastNumber = BigInt(
    /^\d+$/.test(lookups.highestNumericCode) ? lookups.highestNumericCode : "0"
  )
  for (const state of okRows) {
    if (/^\d{1,30}$/.test(state.code) && BigInt(state.code) > lastNumber) {
      lastNumber = BigInt(state.code)
    }
  }
  const autoCodes = new Map<EmployeeRowState, string>()
  for (const state of okRows) {
    if (state.code === "") {
      lastNumber += BigInt(1)
      autoCodes.set(state, formatEmployeeNumber(lastNumber))
    }
  }

  const results: ImportRowResult[] = rows.map((state) => ({
    sheet: MAIN_SHEET,
    excelRow: state.raw.excelRow,
    status: state.issues.hasErrors ? "error" : "ok",
    errors: state.issues.errors,
    warnings: state.issues.warnings,
    note: autoCodes.has(state) ? `자동 ${autoCodes.get(state)}` : null,
  }))
  const payload: EmployeeImportPayload = {
    rows: okRows.flatMap((state) => (state.row ? [state.row] : [])),
  }
  return { preview: buildPreview(results), payload }
}
