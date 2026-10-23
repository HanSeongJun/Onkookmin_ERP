/**
 * 상품 일괄등록 (/imports/products): two sheets in one file —
 * "기준상품" (one row = one 기준상품 with its food information) and
 * "묶음상품" (one row = one 묶음상품; 구성상품 as "기준상품코드*수량, …").
 * A 묶음상품 may use 기준상품 already registered or in the same file's
 * 기준상품 sheet (registered first). Its food information stays derived from
 * its 기준상품 (never imported).
 *
 * The spec (columns, template examples) and the check of a file, reusing
 * the 상품 등록 form's zod rules (`@/lib/products/schema`). No server
 * imports: Client Components use this file too.
 */

import { categoryNameSchema } from "@/lib/categories/schema"
import {
  addCellFlags,
  addZodIssues,
  buildPreview,
  CategoryPlanner,
  codeKey,
  findDuplicates,
  placesText,
  readCategoryPath,
  RowIssues,
  type NamedCategoryNode,
  type RowPlace,
} from "@/lib/imports/check"
import type { ImportColumn, ImportSpec } from "@/lib/imports/columns"
import { PRODUCT_STATUS_CHOICES } from "@/lib/imports/product-categories"
import type {
  ImportCell,
  ImportInput,
  ImportPreview,
  ImportRawRow,
  ImportRowResult,
} from "@/lib/imports/types"
import {
  amountText,
  cellText,
  choiceLabels,
  integerText,
  matchChoice,
  matchUnit,
  parseAllergens,
  parseComponents,
  type ImportChoice,
} from "@/lib/imports/values"
import {
  ALLERGENS,
  BUNDLE_ITEM_QUANTITY,
  BUNDLE_ITEMS_MAX,
  PRODUCT_LIMITS,
  STORAGE_TYPES,
  TAX_TYPES,
  UNITS,
  type Allergen,
  type ProductType,
  type StorageType,
  type TaxType,
} from "@/lib/products/constants"
import {
  baseProductFormSchema,
  bundleProductFormSchema,
  formatDigits,
} from "@/lib/products/schema"

/** Sheet keys of the 상품 import. */
export const PRODUCT_IMPORT_SHEETS = { base: "base", bundle: "bundle" } as const

/** 보관온도: 상온 / 냉장 / 냉동. */
export const STORAGE_CHOICES: readonly ImportChoice<StorageType>[] =
  STORAGE_TYPES.map((type) => ({
    value: type.value,
    label: type.label,
    aliases: [type.value],
  }))

const TAX_ALIASES: Record<TaxType, readonly string[]> = {
  taxable: ["taxable", "과세상품"],
  exempt: ["exempt", "면세상품", "비과세"],
}

/** 과세구분: 과세 / 면세. */
export const TAX_CHOICES: readonly ImportChoice<TaxType>[] = TAX_TYPES.map(
  (type) => ({
    value: type.value,
    label: type.label,
    aliases: TAX_ALIASES[type.value],
  })
)

const ALLERGEN_LABELS = ALLERGENS.map((allergen) => allergen.label).join(", ")

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const codeColumn: ImportColumn = {
  key: "code",
  header: "상품코드",
  required: true,
  format: `영문, 숫자, 하이픈(-), 밑줄(_), 마침표(.) ${PRODUCT_LIMITS.codeMaxLength}자 이내 (띄어쓰기 불가)`,
  help: "회사에서 정한 상품코드. 대소문자를 구분하지 않고(a001 = A001) 이미 등록된 코드나 파일 안에서 겹치는 코드는 오류입니다.",
  width: 16,
  textFormat: true,
}

const nameColumn: ImportColumn = {
  key: "name",
  header: "상품명",
  required: true,
  format: `글자 ${PRODUCT_LIMITS.nameMaxLength}자 이내`,
  help: "상품 이름.",
  width: 32,
  textFormat: true,
}

const categoryColumns: ImportColumn[] = [
  {
    key: "categoryMajor",
    header: "대분류",
    required: false,
    format: "분류 이름 (30자 이내)",
    help: "상품분류의 대분류 이름. 대분류·중분류·소분류를 모두 비우면 미분류로 등록됩니다.",
    width: 14,
    textFormat: true,
  },
  {
    key: "categoryMiddle",
    header: "중분류",
    required: false,
    format: "분류 이름 (30자 이내)",
    help: "대분류 아래 중분류 이름. 적으려면 대분류도 적어야 합니다.",
    width: 14,
    textFormat: true,
  },
  {
    key: "categoryMinor",
    header: "소분류",
    required: false,
    format: "분류 이름 (30자 이내)",
    help: "중분류 아래 소분류 이름. 적으려면 중분류도 적어야 합니다. 없는 분류는 화면의 ‘없는 분류는 자동으로 만들기’가 켜져 있으면 새로 만듭니다. 사용 중지된 분류에는 넣을 수 없습니다.",
    width: 14,
    textFormat: true,
  },
]

const specColumn: ImportColumn = {
  key: "spec",
  header: "규격",
  required: false,
  format: `글자 ${PRODUCT_LIMITS.specMaxLength}자 이내`,
  help: "예: 1kg, 500g×20입",
  width: 14,
  textFormat: true,
}

const unitColumn: ImportColumn = {
  key: "unit",
  header: "단위",
  required: true,
  format: "목록에 있는 단위 하나",
  allowed: UNITS.join(", "),
  help: "상품을 세는 단위. 대소문자는 구분하지 않습니다(KG = kg).",
  width: 8,
  textFormat: true,
}

const priceColumns: ImportColumn[] = [
  {
    key: "purchasePrice",
    header: "기본매입가(부가세포함)",
    aliases: ["기본 매입가", "기본매입가", "매입단가(부가세 포함)"],
    // Other programs often mean these without 부가세: never guessed.
    notAccepted: [
      "매입가",
      "매입단가",
      "매입단가(부가세 별도)",
      "매입가(부가세 별도)",
    ],
    required: false,
    format: "원 단위 정수, 0 이상 (예: 12000, 12,000, 12,000원)",
    help: "부가세를 포함한 금액으로 적습니다. 부가세 별도 금액은 자동으로 계산됩니다. 비워도 됩니다.",
    width: 16,
    textFormat: false,
  },
  {
    key: "salePrice",
    header: "기본판매가(부가세포함)",
    aliases: ["기본 판매가", "기본판매가", "판매단가(부가세 포함)"],
    notAccepted: [
      "판매가",
      "판매단가",
      "판매단가(부가세 별도)",
      "판매가(부가세 별도)",
    ],
    required: false,
    format: "원 단위 정수, 0 이상 (예: 15000, 15,000, 15,000원)",
    help: "부가세를 포함한 금액으로 적습니다. 부가세 별도 금액은 자동으로 계산됩니다. 비워도 됩니다.",
    width: 16,
    textFormat: false,
  },
]

const barcodeColumn: ImportColumn = {
  key: "barcode",
  header: "바코드",
  required: false,
  format: "숫자 8~14자리",
  help: "이미 등록된 바코드나 파일 안에서 겹치는 바코드는 오류입니다. 비워도 됩니다.",
  width: 16,
  textFormat: true,
}

const statusColumn: ImportColumn = {
  key: "isActive",
  header: "사용여부",
  required: false,
  format: "사용 또는 사용중지",
  allowed: `${choiceLabels(PRODUCT_STATUS_CHOICES)} (비우면 사용)`,
  help: "사용중지로 등록하면 판매·구매에서 고를 수 없습니다.",
  width: 10,
  textFormat: true,
}

const noteColumn: ImportColumn = {
  key: "note",
  header: "비고",
  aliases: ["참고사항"],
  required: false,
  format: `글자 ${PRODUCT_LIMITS.noteMaxLength.toLocaleString("ko-KR")}자 이내`,
  help: "메모.",
  width: 24,
  textFormat: true,
}

export const PRODUCT_IMPORT: ImportSpec = {
  kind: "products",
  title: "상품 일괄등록",
  entityLabel: "상품",
  templateFileName: "상품_일괄등록_양식.xlsx",
  listHref: "/products",
  listLabel: "상품관리",
  hasCategoryOption: true,
  instructions: [
    "기준상품은 ‘기준상품’ 시트에, 묶음상품은 ‘묶음상품’ 시트에 2행부터 한 줄에 상품 하나씩 적어 주세요. 첫 줄(열 이름)은 지우거나 바꾸지 마세요. 열 이름 뒤의 *는 꼭 채워야 하는 칸입니다.",
    "기준상품: 낱개(개입) 1개 단위의 상품입니다. 보관온도·과세구분·원산지·알레르기 같은 식품 정보는 기준상품에만 적습니다.",
    "묶음상품: 기준상품 여러 개를 묶은 상품입니다. ‘구성상품’ 칸에 ‘기준상품코드*수량’을 쉼표로 나눠 적습니다(예: PRC-010*6, PRC-005*2). 이미 등록된 기준상품이나 같은 파일의 ‘기준상품’ 시트에 있는 기준상품을 쓸 수 있습니다. 묶음상품의 식품 정보는 구성 기준상품에서 자동으로 계산됩니다.",
    "가격은 부가세를 포함한 금액으로 적습니다. 부가세 별도 금액은 자동으로 계산됩니다.",
    "등록만 합니다: 이미 등록된 상품코드는 오류로 표시되고 등록되지 않습니다. 이미 있는 상품은 상품관리에서 수정해 주세요.",
    "분류는 이름으로 적습니다(대분류 > 중분류 > 소분류). 화면의 ‘없는 분류는 자동으로 만들기’가 켜져 있으면 없는 분류를 새로 만듭니다.",
    "‘기준상품 예시’, ‘묶음상품 예시’ 시트는 작성 예입니다. 등록되지 않습니다.",
    "엑셀(.xlsx) 또는 CSV 파일을 올릴 수 있고, 두 시트를 합쳐 한 번에 3,000행까지 올릴 수 있습니다. CSV는 시트가 하나라서 기준상품과 묶음상품을 따로 올려 주세요(‘구성상품’ 열이 있으면 묶음상품으로 읽습니다).",
  ],
  sheets: [
    {
      key: PRODUCT_IMPORT_SHEETS.base,
      sheetName: "기준상품",
      columns: [
        codeColumn,
        nameColumn,
        ...categoryColumns,
        specColumn,
        unitColumn,
        {
          key: "storageType",
          header: "보관온도",
          required: true,
          format: "목록에 있는 값 하나",
          allowed: choiceLabels(STORAGE_CHOICES),
          help: "상온, 냉장(0~10°C), 냉동(-18°C 이하).",
          width: 10,
          textFormat: true,
        },
        {
          key: "taxType",
          header: "과세구분",
          required: true,
          format: "목록에 있는 값 하나",
          allowed: choiceLabels(TAX_CHOICES),
          help: "신선 농·수·축산물은 보통 면세, 가공식품은 과세입니다.",
          width: 10,
          textFormat: true,
        },
        ...priceColumns,
        {
          key: "origin",
          header: "원산지",
          required: false,
          format: `글자 ${PRODUCT_LIMITS.originMaxLength}자 이내`,
          help: "예: 국산, 국산(전남 무안), 호주산",
          width: 14,
          textFormat: true,
        },
        {
          key: "manufacturer",
          header: "제조사/브랜드",
          aliases: ["제조사", "브랜드"],
          required: false,
          format: `글자 ${PRODUCT_LIMITS.manufacturerMaxLength}자 이내`,
          help: "제조사나 브랜드 이름.",
          width: 16,
          textFormat: true,
        },
        {
          key: "shelfLifeDays",
          header: "유통기한기준일수",
          aliases: ["유통기한 기준일수", "유통기한(일)", "유통기한일수"],
          required: false,
          format: `숫자 ${PRODUCT_LIMITS.shelfLifeDaysMin}~${formatDigits(String(PRODUCT_LIMITS.shelfLifeDaysMax))} (예: 365, 365일)`,
          help: "제조일로부터 며칠까지인지. 비워도 됩니다.",
          width: 14,
          textFormat: false,
        },
        barcodeColumn,
        {
          key: "allergens",
          header: "알레르기",
          aliases: ["알레르기 유발물질", "알레르기유발물질"],
          required: false,
          format: "이름을 쉼표(,)로 나눠 적기 (예: 우유, 대두, 밀)",
          allowed: `${ALLERGEN_LABELS} (괄호 안은 생략 가능: 알류, 조개류)`,
          help: "식품 등의 표시기준에 따른 알레르기 유발물질. 없으면 비워 두세요.",
          width: 22,
          textFormat: true,
        },
        statusColumn,
        noteColumn,
      ],
      examples: [
        {
          code: "CAN-001",
          name: "스팸 클래식 1.81kg",
          categoryMajor: "가공식품",
          categoryMiddle: "통조림",
          categoryMinor: "",
          spec: "1.81kg",
          unit: "캔",
          storageType: "상온",
          taxType: "과세",
          purchasePrice: 15000,
          salePrice: 18500,
          origin: "국산",
          manufacturer: "예시식품",
          shelfLifeDays: 1095,
          barcode: "8801234567893",
          allergens: "돼지고기, 대두, 밀",
          isActive: "사용",
          note: "",
        },
        {
          code: "VEG-101",
          name: "양파 15kg",
          categoryMajor: "농산물",
          categoryMiddle: "채소",
          categoryMinor: "",
          spec: "15kg",
          unit: "망",
          storageType: "상온",
          taxType: "면세",
          purchasePrice: 21000,
          salePrice: 25000,
          origin: "국산(전남 무안)",
          manufacturer: "",
          shelfLifeDays: 30,
          barcode: "",
          allergens: "",
          isActive: "사용",
          note: "",
        },
      ],
    },
    {
      key: PRODUCT_IMPORT_SHEETS.bundle,
      sheetName: "묶음상품",
      columns: [
        codeColumn,
        nameColumn,
        {
          key: "components",
          header: "구성상품",
          aliases: ["구성표", "구성"],
          required: true,
          format:
            "기준상품코드*수량을 쉼표로 나눠 적기 (예: PRC-010*6, PRC-005*2)",
          allowed: `* 대신 x, X, × 도 됩니다. 기준상품 ${BUNDLE_ITEMS_MAX}종류까지, 수량은 ${BUNDLE_ITEM_QUANTITY.min}~${formatDigits(String(BUNDLE_ITEM_QUANTITY.max))}`,
          help: "묶음상품에 들어가는 기준상품과 수량(기준상품의 단위 기준). 이미 등록된 기준상품이나 같은 파일 ‘기준상품’ 시트의 기준상품만 쓸 수 있고, 묶음상품은 넣을 수 없습니다. 사용 중인 묶음상품에는 사용중지된 기준상품을 넣을 수 없습니다.",
          width: 30,
          textFormat: true,
        },
        ...categoryColumns,
        specColumn,
        unitColumn,
        ...priceColumns,
        barcodeColumn,
        statusColumn,
        noteColumn,
      ],
      examples: [
        {
          code: "CAN-001-6",
          name: "[묶음] 스팸 클래식 1.81kg X 6개입",
          components: "CAN-001*6",
          categoryMajor: "가공식품",
          categoryMiddle: "통조림",
          categoryMinor: "",
          spec: "1.81kg×6",
          unit: "묶음",
          purchasePrice: 90000,
          salePrice: 108000,
          barcode: "",
          isActive: "사용",
          note: "",
        },
        {
          code: "CAN-001-SET",
          name: "[묶음] 스팸 클래식 1.81kg 2개 + 양파 15kg 1개",
          components: "CAN-001*2, VEG-101*1",
          categoryMajor: "",
          categoryMiddle: "",
          categoryMinor: "",
          spec: "",
          unit: "세트",
          purchasePrice: "",
          salePrice: 60000,
          barcode: "",
          isActive: "사용",
          note: "",
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

/** A product already in the database (import_find_products). */
export type ExistingProduct = {
  code: string
  name: string
  productType: ProductType
  isActive: boolean
  barcode: string | null
}

/** What the database knows for the check. */
export type ProductImportLookups = {
  /**
   * Products whose 상품코드 (ignoring case) or 바코드 is one the file uses
   * (see productImportLookupKeys).
   */
  products: readonly ExistingProduct[]
  /** Every 상품분류 (사용 and 사용 중지), as getCategoryTree returns it. */
  categories: readonly NamedCategoryNode[]
}

/** One 기준상품 row for import_products (database column names). */
export type ProductImportBaseRow = {
  excel_row: number
  code: string
  name: string
  category_path: string[] | null
  spec: string | null
  unit: string
  storage_type: StorageType
  tax_type: TaxType
  purchase_price_incl_vat: number | null
  sale_price_incl_vat: number | null
  origin: string | null
  manufacturer: string | null
  shelf_life_days: number | null
  barcode: string | null
  allergens: Allergen[]
  is_active: boolean
  note: string | null
}

/** One 묶음상품 row for import_products (database column names). */
export type ProductImportBundleRow = {
  excel_row: number
  code: string
  name: string
  category_path: string[] | null
  spec: string | null
  unit: string
  purchase_price_incl_vat: number | null
  sale_price_incl_vat: number | null
  barcode: string | null
  is_active: boolean
  note: string | null
  items: { component_code: string; quantity: number }[]
}

/** The arguments of the database function import_products. */
export type ProductImportPayload = {
  base_rows: ProductImportBaseRow[]
  bundle_rows: ProductImportBundleRow[]
  create_missing_categories: boolean
}

/** Form field → column key, for the zod messages. */
const PRODUCT_FIELDS: Record<string, string> = {
  code: "code",
  name: "name",
  spec: "spec",
  unit: "unit",
  storageType: "storageType",
  taxType: "taxType",
  purchasePriceInclVat: "purchasePrice",
  salePriceInclVat: "salePrice",
  origin: "origin",
  manufacturer: "manufacturer",
  shelfLifeDays: "shelfLifeDays",
  barcode: "barcode",
  allergens: "allergens",
  isActive: "isActive",
  note: "note",
  categoryId: "categoryMajor",
}

const SHEET_LABELS: Record<string, string> = {
  base: "기준상품",
  bundle: "묶음상품",
}

const bundleFieldsSchema = bundleProductFormSchema.omit({ items: true })

/** One row while it is checked. */
type ProductRowState = {
  sheet: "base" | "bundle"
  raw: ImportRawRow
  issues: RowIssues
  code: string
  barcode: string
  categoryPath: string[] | null
  createdCategories: string[]
  base: ProductImportBaseRow | null
  bundle: ProductImportBundleRow | null
}

/**
 * The codes and 바코드 the check needs from the database: every 상품코드
 * and 구성상품 code of the file, and every 바코드 (for import_find_products).
 */
export function productImportLookupKeys(input: ImportInput): {
  codes: string[]
  barcodes: string[]
} {
  const codes = new Map<string, string>()
  const barcodes = new Set<string>()
  const addCode = (code: string) => {
    if (code !== "" && !codes.has(codeKey(code))) codes.set(codeKey(code), code)
  }
  for (const sheet of ["base", "bundle"] as const) {
    for (const row of input.sheets[sheet] ?? []) {
      addCode(cellText(row.values.code))
      const barcode = cellText(row.values.barcode)
      if (barcode !== "") barcodes.add(barcode)
      if (sheet === "bundle") {
        const components = parseComponents(row.values.components)
        if (components.ok)
          components.value.forEach((item) => addCode(item.code))
      }
    }
  }
  return { codes: [...codes.values()], barcodes: [...barcodes] }
}

/** Checks one 기준상품 row on its own (form rules, choices, 분류 names). */
function readBaseRow(raw: ImportRawRow): ProductRowState {
  const issues = new RowIssues()
  addCellFlags(issues, raw)
  const values = raw.values

  const unit = matchUnit(values.unit)
  if (unit === null)
    issues.error("unit", "단위를 입력해 주세요. (예: kg, 개, 박스)")
  if (unit === undefined) {
    issues.error(
      "unit",
      `단위는 목록에 있는 값으로 입력해 주세요: ${UNITS.join(", ")}`
    )
  }
  const storageType = matchChoice(values.storageType, STORAGE_CHOICES)
  if (storageType === null) {
    issues.error(
      "storageType",
      `보관온도를 입력해 주세요. (${choiceLabels(STORAGE_CHOICES)})`
    )
  }
  if (storageType === undefined) {
    issues.error(
      "storageType",
      `보관온도는 ${choiceLabels(STORAGE_CHOICES)} 중 하나로 입력해 주세요.`
    )
  }
  const taxType = matchChoice(values.taxType, TAX_CHOICES)
  if (taxType === null) {
    issues.error(
      "taxType",
      `과세구분을 입력해 주세요. (${choiceLabels(TAX_CHOICES)})`
    )
  }
  if (taxType === undefined) {
    issues.error(
      "taxType",
      `과세구분은 ${choiceLabels(TAX_CHOICES)} 중 하나로 입력해 주세요.`
    )
  }
  const allergens = parseAllergens(values.allergens)
  if (!allergens.ok) {
    issues.error(
      "allergens",
      `알레르기 유발물질 ${allergens.unknown.map((name) => `‘${name}’`).join(", ")}을(를) 찾을 수 없습니다. 쓸 수 있는 이름: ${ALLERGEN_LABELS}`
    )
  }
  const isActive = readStatus(values, issues)
  const categoryPath = readCategoryPath(
    values,
    {
      major: "categoryMajor",
      middle: "categoryMiddle",
      minor: "categoryMinor",
    },
    categoryNameSchema,
    issues
  )

  const parsed = baseProductFormSchema.safeParse({
    productType: "base",
    code: cellText(values.code),
    name: cellText(values.name),
    categoryId: "",
    spec: cellText(values.spec),
    unit: unit ?? "",
    storageType: storageType ?? "",
    taxType: taxType ?? "",
    purchasePriceInclVat: amountText(values.purchasePrice),
    salePriceInclVat: amountText(values.salePrice),
    origin: cellText(values.origin),
    manufacturer: cellText(values.manufacturer),
    shelfLifeDays: integerText(values.shelfLifeDays, ["일"]),
    barcode: cellText(values.barcode),
    allergens: allergens.ok ? allergens.value : [],
    isActive,
    note: cellText(values.note),
  })
  if (!parsed.success) addZodIssues(issues, parsed.error, PRODUCT_FIELDS)

  const base: ProductImportBaseRow | null = parsed.success
    ? {
        excel_row: raw.excelRow,
        code: parsed.data.code,
        name: parsed.data.name,
        category_path: categoryPath,
        spec: parsed.data.spec,
        unit: parsed.data.unit,
        storage_type: parsed.data.storageType,
        tax_type: parsed.data.taxType,
        purchase_price_incl_vat: parsed.data.purchasePriceInclVat,
        sale_price_incl_vat: parsed.data.salePriceInclVat,
        origin: parsed.data.origin,
        manufacturer: parsed.data.manufacturer,
        shelf_life_days: parsed.data.shelfLifeDays,
        barcode: parsed.data.barcode,
        allergens: parsed.data.allergens,
        is_active: parsed.data.isActive,
        note: parsed.data.note,
      }
    : null

  return {
    sheet: "base",
    raw,
    issues,
    code: cellText(values.code),
    barcode: cellText(values.barcode),
    categoryPath,
    createdCategories: [],
    base,
    bundle: null,
  }
}

/** Checks one 묶음상품 row on its own (form rules, 구성상품 cell, 분류 names). */
function readBundleRow(raw: ImportRawRow): ProductRowState {
  const issues = new RowIssues()
  addCellFlags(issues, raw)
  const values = raw.values

  const unit = matchUnit(values.unit)
  if (unit === null)
    issues.error("unit", "단위를 입력해 주세요. (예: 묶음, 세트, 박스)")
  if (unit === undefined) {
    issues.error(
      "unit",
      `단위는 목록에 있는 값으로 입력해 주세요: ${UNITS.join(", ")}`
    )
  }
  const isActive = readStatus(values, issues)
  const categoryPath = readCategoryPath(
    values,
    {
      major: "categoryMajor",
      middle: "categoryMiddle",
      minor: "categoryMinor",
    },
    categoryNameSchema,
    issues
  )

  const items: { component_code: string; quantity: number }[] = []
  const components = parseComponents(values.components)
  if (!components.ok) {
    issues.error(
      "components",
      `구성상품 ${components.invalid.map((part) => `‘${part}’`).join(", ")}을(를) 읽을 수 없습니다. ‘기준상품코드*수량’으로 적고 쉼표로 나눠 주세요. (예: PRC-010*6, PRC-005*2)`
    )
  } else if (components.value.length === 0) {
    issues.error(
      "components",
      "구성상품을 입력해 주세요. (예: PRC-010*6, PRC-005*2)"
    )
  } else if (components.value.length > BUNDLE_ITEMS_MAX) {
    issues.error(
      "components",
      `묶음상품 하나에 기준상품은 ${BUNDLE_ITEMS_MAX}종류까지 넣을 수 있습니다.`
    )
  } else {
    const seen = new Set<string>()
    for (const entry of components.value) {
      const quantity = /^\d{1,7}$/.test(entry.quantity)
        ? Number(entry.quantity)
        : NaN
      if (
        !(quantity >= BUNDLE_ITEM_QUANTITY.min) ||
        quantity > BUNDLE_ITEM_QUANTITY.max
      ) {
        issues.error(
          "components",
          `구성상품 ${entry.code}의 수량은 ${BUNDLE_ITEM_QUANTITY.min}~${formatDigits(String(BUNDLE_ITEM_QUANTITY.max))} 사이의 숫자로 입력해 주세요.`
        )
        break
      }
      if (seen.has(codeKey(entry.code))) {
        issues.error(
          "components",
          `같은 기준상품(${entry.code})을 두 번 넣을 수 없습니다. 한 번만 적고 수량을 늘려 주세요.`
        )
        break
      }
      seen.add(codeKey(entry.code))
      items.push({ component_code: entry.code, quantity })
    }
  }

  const parsed = bundleFieldsSchema.safeParse({
    productType: "bundle",
    code: cellText(values.code),
    name: cellText(values.name),
    categoryId: "",
    spec: cellText(values.spec),
    unit: unit ?? "",
    purchasePriceInclVat: amountText(values.purchasePrice),
    salePriceInclVat: amountText(values.salePrice),
    barcode: cellText(values.barcode),
    isActive,
    note: cellText(values.note),
  })
  if (!parsed.success) addZodIssues(issues, parsed.error, PRODUCT_FIELDS)

  const bundle: ProductImportBundleRow | null = parsed.success
    ? {
        excel_row: raw.excelRow,
        code: parsed.data.code,
        name: parsed.data.name,
        category_path: categoryPath,
        spec: parsed.data.spec,
        unit: parsed.data.unit,
        purchase_price_incl_vat: parsed.data.purchasePriceInclVat,
        sale_price_incl_vat: parsed.data.salePriceInclVat,
        barcode: parsed.data.barcode,
        is_active: parsed.data.isActive,
        note: parsed.data.note,
        items,
      }
    : null

  return {
    sheet: "bundle",
    raw,
    issues,
    code: cellText(values.code),
    barcode: cellText(values.barcode),
    categoryPath,
    createdCategories: [],
    base: null,
    bundle,
  }
}

/** 사용여부 of a row (empty = 사용); an unknown value is an error. */
function readStatus(
  values: Record<string, ImportCell>,
  issues: RowIssues
): boolean {
  const isActive = matchChoice(values.isActive, PRODUCT_STATUS_CHOICES)
  if (isActive === undefined) {
    issues.error(
      "isActive",
      `사용여부는 ${choiceLabels(PRODUCT_STATUS_CHOICES)} 중 하나로 입력해 주세요. (비우면 사용)`
    )
  }
  return isActive ?? true
}

/**
 * Checks every row of a 상품 file and returns the 미리보기 and the 정상
 * rows for import_products:
 * 1. each row on its own: the 상품 등록 form's rules (상품코드, 상품명,
 *    가격, 바코드 …), 단위 / 보관온도 / 과세구분 / 사용여부 from their lists,
 *    알레르기 names, 구성상품 cell, 분류 names;
 * 2. rows against each other: 상품코드 (ignoring case) and 바코드 used twice
 *    in the file (both sheets together);
 * 3. against the database: 상품코드 / 바코드 already registered, 분류 that
 *    exist (사용 중지 → error; missing → created, or an error without
 *    "없는 분류는 자동으로 만들기");
 * 4. 묶음상품: each 구성상품 must be a 기준상품 of the file's 정상 rows or
 *    of the database, 사용 when the 묶음상품 is 사용.
 */
export function checkProductImport(
  input: ImportInput,
  lookups: ProductImportLookups
): { preview: ImportPreview; payload: ProductImportPayload } {
  const createMissing = input.createMissingCategories ?? true
  const rows: ProductRowState[] = [
    ...(input.sheets.base ?? []).map(readBaseRow),
    ...(input.sheets.bundle ?? []).map(readBundleRow),
  ]
  const placeOf = (row: ProductRowState): RowPlace => ({
    sheetLabel: SHEET_LABELS[row.sheet],
    excelRow: row.raw.excelRow,
  })

  // 2. Codes and 바코드 used twice in the file.
  for (const [row, others] of findDuplicates(
    rows,
    (row) => row.code,
    placeOf,
    codeKey
  )) {
    row.issues.error(
      "code",
      `파일 안에서 같은 상품코드가 또 있습니다 (${placesText(others)}). 상품코드는 대소문자를 구분하지 않습니다.`
    )
  }
  for (const [row, others] of findDuplicates(
    rows,
    (row) => row.barcode,
    placeOf
  )) {
    row.issues.error(
      "barcode",
      `파일 안에서 같은 바코드가 또 있습니다 (${placesText(others)}).`
    )
  }

  // 3. Against the database.
  const savedByCode = new Map(
    lookups.products.map((product) => [codeKey(product.code), product])
  )
  const savedByBarcode = new Map(
    lookups.products
      .filter((product) => product.barcode !== null)
      .map((product) => [product.barcode as string, product])
  )
  for (const row of rows) {
    const saved =
      row.code === "" ? undefined : savedByCode.get(codeKey(row.code))
    if (saved) {
      row.issues.error(
        "code",
        `이미 등록된 상품코드입니다 (${saved.code} ${saved.name}). 일괄등록은 새 상품만 등록합니다. 이미 있는 상품은 상품관리에서 수정해 주세요.`
      )
    }
    const sameBarcode =
      row.barcode === "" ? undefined : savedByBarcode.get(row.barcode)
    if (sameBarcode) {
      row.issues.error(
        "barcode",
        `이미 등록된 바코드입니다 (상품코드 ${sameBarcode.code} ${sameBarcode.name}).`
      )
    }
  }

  const planner = new CategoryPlanner(lookups.categories, {
    createMissing,
    allowInactive: false,
    settingsName: "상품분류설정",
    entityLabel: "상품",
  })
  const checkCategory = (row: ProductRowState) => {
    if (row.categoryPath === null) return
    const result = planner.check(row.categoryPath)
    if (!result.ok) row.issues.error("categoryMajor", result.message)
    else row.createdCategories = result.created
  }
  const acceptCategory = (row: ProductRowState) => {
    if (row.categoryPath !== null && !row.issues.hasErrors) {
      planner.accept(row.categoryPath, row.raw.excelRow)
    }
  }

  // 기준상품 first (as the database saves them), so their status is final
  // before the 묶음상품 look at them.
  const baseRows = rows.filter((row) => row.sheet === "base")
  for (const row of baseRows) {
    checkCategory(row)
    acceptCategory(row)
  }

  // 4. 묶음상품.
  const fileBase = new Map<string, ProductRowState>()
  for (const row of baseRows) {
    if (row.code !== "" && !fileBase.has(codeKey(row.code))) {
      fileBase.set(codeKey(row.code), row)
    }
  }
  const fileBundleCodes = new Set(
    rows
      .filter((row) => row.sheet === "bundle" && row.code !== "")
      .map((row) => codeKey(row.code))
  )
  for (const row of rows.filter((row) => row.sheet === "bundle")) {
    checkCategory(row)
    const bundleActive = row.bundle?.is_active ?? true
    const problems: string[] = []
    for (const item of row.bundle?.items ?? []) {
      const code = item.component_code
      const inFile = fileBase.get(codeKey(code))
      if (inFile) {
        if (inFile.issues.hasErrors) {
          problems.push(
            `구성상품 ${code}: 기준상품 시트 ${inFile.raw.excelRow}행에 오류가 있어 함께 등록할 수 없습니다.`
          )
        } else if (bundleActive && inFile.base && !inFile.base.is_active) {
          problems.push(
            `구성상품 ${code}은(는) 사용중지로 등록하는 기준상품이라 사용 중인 묶음상품에 넣을 수 없습니다. 묶음상품을 사용중지로 하거나 기준상품을 사용으로 바꿔 주세요.`
          )
        }
        continue
      }
      if (fileBundleCodes.has(codeKey(code))) {
        problems.push(
          `구성상품 ${code}은(는) 묶음상품입니다. 묶음상품에는 기준상품만 넣을 수 있습니다.`
        )
        continue
      }
      const saved = savedByCode.get(codeKey(code))
      if (!saved) {
        problems.push(
          `구성상품 ${code}을(를) 찾을 수 없습니다. 상품관리나 이 파일의 ‘기준상품’ 시트에 있는 기준상품코드를 적어 주세요.`
        )
      } else if (saved.productType !== "base") {
        problems.push(
          `구성상품 ${code}(${saved.name})은(는) 묶음상품입니다. 묶음상품에는 기준상품만 넣을 수 있습니다.`
        )
      } else if (bundleActive && !saved.isActive) {
        problems.push(
          `구성상품 ${code}(${saved.name})은(는) 사용중지된 기준상품이라 사용 중인 묶음상품에 넣을 수 없습니다. 기준상품을 먼저 사용으로 바꾸거나 묶음상품을 사용중지로 등록해 주세요.`
        )
      }
    }
    if (problems.length > 0) {
      row.issues.error(
        "components",
        problems.length > 2
          ? `${problems.slice(0, 2).join(" ")} (외 ${problems.length - 2}건)`
          : problems.join(" ")
      )
    }
    acceptCategory(row)
  }

  // 미리보기 and the 정상 rows.
  const results: ImportRowResult[] = []
  const payload: ProductImportPayload = {
    base_rows: [],
    bundle_rows: [],
    create_missing_categories: createMissing,
  }
  for (const row of rows) {
    const ok = !row.issues.hasErrors
    const notes: string[] = []
    if (row.bundle && ok) notes.push(`구성 ${row.bundle.items.length}종`)
    if (ok && row.createdCategories.length > 0) {
      notes.push(`새 분류 ${row.createdCategories.length}개`)
    }
    results.push({
      sheet: row.sheet,
      excelRow: row.raw.excelRow,
      status: ok ? "ok" : "error",
      errors: row.issues.errors,
      warnings: row.issues.warnings,
      note: notes.length > 0 ? notes.join(", ") : null,
    })
    if (!ok) continue
    if (row.base) payload.base_rows.push(row.base)
    if (row.bundle) payload.bundle_rows.push(row.bundle)
  }

  return { preview: buildPreview(results, planner.created), payload }
}
