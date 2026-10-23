import type {
  PartnerAddressInput,
  PartnerContactInput,
  PartnerFieldName,
} from "@/lib/partners/schema"

/**
 * Every top-level field of the 거래처 form in screen order (tab by tab, top
 * to bottom), to find the first field with an error.
 */
export const FIELD_ORDER: readonly PartnerFieldName[] = [
  // 기본정보 (left column, then 추가정보, then 사용 여부 above the form)
  "partnerType",
  "code",
  "name",
  "phone",
  "industry",
  "salesRepId",
  "deliveryRepId",
  "categoryId",
  "paymentTerm",
  "paymentDay",
  "creditLimitType",
  "creditLimit",
  "invoiceType",
  "slipPrint",
  "isActive",
  // 사업자정보
  "businessNumber",
  "companyName",
  "representative",
  "businessCategory",
  "businessItem",
  "postalCode",
  "address",
  "addressDetail",
  "taxEmail",
  // 담당자정보, 배송지, 특이사항
  "contacts",
  "addresses",
  "note",
]

/** The 담당자 table's fields in screen order (left to right). */
export const CONTACT_FIELD_ORDER: readonly (keyof PartnerContactInput)[] = [
  "isPrimary",
  "name",
  "jobTitle",
  "mobile",
  "phone",
  "email",
  "memo",
  "id",
]

/** The 배송지 table's fields in screen order (left to right). */
export const ADDRESS_FIELD_ORDER: readonly (keyof PartnerAddressInput)[] = [
  "isDefault",
  "label",
  "postalCode",
  "address",
  "addressDetail",
  "recipient",
  "phone",
  "memo",
  "id",
]

type ErrorLike = { message?: unknown; root?: { message?: unknown } }

/**
 * The message about a whole list (담당자 / 배송지), e.g. "대표 담당자는
 * 1명만 정할 수 있습니다.". react-hook-form keeps it in `root` while rows
 * are shown, or right on the list (a message from the server).
 */
export function listErrorMessage(listError: unknown): string | undefined {
  if (!listError || typeof listError !== "object") return undefined
  const error = listError as ErrorLike
  if (typeof error.root?.message === "string") return error.root.message
  if (typeof error.message === "string") return error.message
  return undefined
}

/** The message of one field of one row of a list, if any. */
export function rowErrorMessage(
  listError: unknown,
  index: number,
  field: string
): string | undefined {
  if (!listError || typeof listError !== "object") return undefined
  const row = (listError as Record<string, unknown>)[index]
  if (!row || typeof row !== "object") return undefined
  const message = (row as Record<string, ErrorLike | undefined>)[field]?.message
  return typeof message === "string" ? message : undefined
}

/** The row numbers (0-based) a list error object has messages for. */
function rowIndexes(listError: object): number[] {
  return Object.keys(listError)
    .filter((key) => /^\d+$/.test(key))
    .map(Number)
    .sort((a, b) => a - b)
}

/**
 * The fields with an error, in screen order, named like react-hook-form
 * names them: "code", "contacts" (the whole list), "contacts.0.name".
 */
export function errorPaths(errors: Record<string, unknown>): string[] {
  const paths: string[] = []
  for (const field of FIELD_ORDER) {
    const error = errors[field]
    if (!error || typeof error !== "object") continue
    if (field !== "contacts" && field !== "addresses") {
      paths.push(field)
      continue
    }
    if (listErrorMessage(error)) paths.push(field)
    const rowFields =
      field === "contacts" ? CONTACT_FIELD_ORDER : ADDRESS_FIELD_ORDER
    for (const index of rowIndexes(error)) {
      for (const rowField of rowFields) {
        if (rowErrorMessage(error, index, rowField)) {
          paths.push(`${field}.${index}.${rowField}`)
        }
      }
    }
  }
  return paths
}

/**
 * `paths` (e.g. from the server) in screen order; unknown ones last.
 * @example sortErrorPaths(["note", "contacts.1.name", "code"])
 *   // ["code", "contacts.1.name", "note"]
 */
export function sortErrorPaths(paths: readonly string[]): string[] {
  function rank(path: string): number[] {
    const [field, row, rowField] = path.split(".")
    const fieldRank = FIELD_ORDER.indexOf(field as PartnerFieldName)
    const rowFields: readonly string[] =
      field === "contacts" ? CONTACT_FIELD_ORDER : ADDRESS_FIELD_ORDER
    return [
      fieldRank === -1 ? FIELD_ORDER.length : fieldRank,
      row === undefined ? -1 : Number(row),
      rowField === undefined ? -1 : rowFields.indexOf(rowField),
    ]
  }
  return [...paths].sort((a, b) => {
    const left = rank(a)
    const right = rank(b)
    for (let index = 0; index < left.length; index++) {
      if (left[index] !== right[index]) return left[index] - right[index]
    }
    return 0
  })
}
