/**
 * 기초재고 일괄등록 (/imports/opening-stock): the stock on hand when the
 * company starts using 재고관리. One row = one lot of a 기준상품 at one
 * 창고 > 구역 > 선반 (위치). Registering makes ONE 기초재고 전표 (all rows
 * or none; database function import_opening_stock) dated today — or, when
 * a row's 입고일 is after today (at most today + the 재고 설정's days), the
 * latest 입고일: a 예정 기초재고 whose stock can go out from that date.
 *
 * The spec (columns, template examples) and the check of a file. No server
 * imports: Client Components use this file too.
 */

import {
  addCellFlags,
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
  amountText,
  cellText,
  choiceLabels,
  dateText,
  matchChoice,
  numberText,
  type ImportChoice,
} from "@/lib/imports/values"
import {
  STOCK_LIMITS,
  docDateLimitMessage,
  expiryStatus,
  maxDocDate,
  parseStockQuantity,
  suggestExpiryDate,
  type ExpiryKind,
} from "@/lib/inventory/constants"
import { isCalendarDate, todayInKorea } from "@/lib/inventory/schema"
import {
  storageTypeLabel,
  type ProductType,
  type StorageType,
} from "@/lib/products/constants"

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

/** 기한종류: 소비기한 / 유통기한 / 없음 (also the short and English forms). */
export const EXPIRY_KIND_CHOICES: readonly ImportChoice<ExpiryKind>[] = [
  { value: "use_by", label: "소비기한", aliases: ["소비", "use_by", "useby"] },
  {
    value: "sell_by",
    label: "유통기한",
    aliases: ["유통", "sell_by", "sellby"],
  },
  {
    value: "none",
    label: "없음",
    aliases: ["기한없음", "해당없음", "무", "-", "none", "없슴"],
  },
]

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

const DATE_FORMAT = "날짜 (예: 2026-10-23, 2026.10.23, 2026/10/23, 20261023)"
const CODE_FORMAT = "등록된 코드 (대소문자 구분 없음)"

export const OPENING_STOCK_IMPORT: ImportSpec = {
  kind: "opening-stock",
  title: "기초재고 일괄등록",
  entityLabel: "기초재고",
  templateFileName: "기초재고_일괄등록_양식.xlsx",
  listHref: "/inventory/locations",
  listLabel: "재고처별 재고현황",
  fixHint:
    "잘못 넣었으면 ‘입고 등록’에서 이 기초재고 전표를 열어 [전표 취소]로 되돌린 뒤 다시 올려 주세요.",
  hasCategoryOption: false,
  savedCodesLabel: "로트번호",
  instructions: [
    "‘기초재고’ 시트의 2행부터 한 줄에 로트(같은 기한으로 들어온 묶음) 하나씩 적어 주세요. 첫 줄(열 이름)은 지우거나 바꾸지 마세요. 열 이름 뒤의 *는 꼭 채워야 하는 칸입니다.",
    "지금 창고에 있는 재고를 처음 넣을 때 씁니다. 등록하면 오늘 날짜의 ‘기초재고’ 전표 하나로 저장되고(입고일이 오늘 이후인 행이 있으면 가장 늦은 입고일 날짜의 예정 전표), 잘못 넣었으면 재고관리 → 입고 등록에서 그 전표를 열어 [전표 취소]로 되돌릴 수 있습니다.",
    "상품코드는 기준상품코드만 됩니다(묶음상품은 구성 기준상품으로 나눠 적어 주세요). 수량은 상품의 단위로 적고, kg·g·L·mL 단위만 소수점(3자리까지)을 쓸 수 있습니다.",
    "창고코드·구역코드·선반코드는 창고·로케이션 설정에 먼저 만들어 두어야 합니다. 선반코드를 비우면 구역의 ‘기본’ 위치에 넣습니다.",
    "기한종류는 소비기한·유통기한·없음 중 하나입니다. 기한일을 비우고 제조일자를 적으면 ‘제조일자 + 상품의 유통기한 기준일수’로 계산합니다(제조일을 1일째로 셈).",
    "로트번호를 비우면 자동으로 붙입니다(L+오늘 날짜-일련번호). 입고단가는 부가세 포함 금액(원)입니다. 비우면 재고금액은 상품의 기본 매입가로 추정합니다.",
    "‘예시’ 시트는 작성 예입니다. 등록되지 않습니다.",
    "엑셀(.xlsx) 또는 CSV 파일을 올릴 수 있고, 한 번에 3,000행까지 올릴 수 있습니다. 오류 행은 등록하지 않고, 정상 행만 기초재고 전표 하나로 한꺼번에 등록합니다(저장 중에 문제가 생기면 아무것도 등록하지 않습니다).",
    "오류 행은 [오류 목록 엑셀로 받기]로 받아 고친 뒤 그 파일만 다시 올려 주세요. 전체 파일을 다시 올리면 이미 등록한 정상 행의 재고가 두 번 들어갑니다.",
  ],
  sheets: [
    {
      key: MAIN_SHEET,
      sheetName: "기초재고",
      columns: [
        {
          key: "productCode",
          header: "상품코드",
          aliases: ["기준상품코드"],
          required: true,
          format: CODE_FORMAT,
          help: "기준상품의 상품코드. 묶음상품코드는 쓸 수 없습니다.",
          width: 14,
          textFormat: true,
        },
        {
          key: "quantity",
          header: "수량",
          aliases: ["재고수량", "기초재고수량", "현재고"],
          required: true,
          format: "숫자 (상품의 단위, kg·g·L·mL만 소수점 3자리까지)",
          help: "이 로트가 이 위치에 지금 있는 수량.",
          width: 10,
          textFormat: false,
        },
        {
          key: "warehouseCode",
          header: "창고코드",
          required: true,
          format: CODE_FORMAT,
          help: "창고·로케이션 설정의 창고코드 (사용 중인 창고).",
          width: 10,
          textFormat: true,
        },
        {
          key: "zoneCode",
          header: "구역코드",
          required: true,
          format: CODE_FORMAT,
          help: "그 창고 안의 구역코드 (사용 중인 구역).",
          width: 10,
          textFormat: true,
        },
        {
          key: "locationCode",
          header: "선반코드",
          aliases: ["위치코드", "로케이션", "로케이션코드", "선반"],
          required: false,
          format: CODE_FORMAT,
          help: "그 구역 안의 선반(위치)코드. 비우면 구역의 ‘기본’ 위치.",
          width: 12,
          textFormat: true,
        },
        {
          key: "expiryKind",
          header: "기한종류",
          required: false,
          format: "목록에 있는 값 하나",
          allowed: `${choiceLabels(EXPIRY_KIND_CHOICES)} (비우면: 기한일이 있으면 소비기한, 없으면 없음)`,
          help: "제품에 표시된 기한의 종류. 2023년부터 대부분 소비기한입니다.",
          width: 10,
          textFormat: true,
        },
        {
          key: "expiryDate",
          header: "기한일",
          aliases: ["기한일자", "기한날짜"],
          required: false,
          dateColumn: true,
          format: DATE_FORMAT,
          help: "소비기한 또는 유통기한 날짜. 비우면 제조일자 + 유통기한 기준일수로 계산합니다.",
          width: 12,
          textFormat: false,
        },
        {
          key: "manufacturedDate",
          header: "제조일자",
          aliases: ["제조일"],
          required: false,
          dateColumn: true,
          format: DATE_FORMAT,
          help: "입고일보다 늦을 수 없습니다.",
          width: 12,
          textFormat: false,
        },
        {
          key: "receivedDate",
          header: "입고일",
          required: false,
          dateColumn: true,
          format: DATE_FORMAT,
          help: "이 로트가 들어온 날 (비우면 기초재고 전표 날짜, 보통 오늘). 오늘 이후는 재고 설정의 일수까지 되며(예정), 그러면 기초재고 전표가 그 날짜로 등록되어 그날부터 출고할 수 있습니다. 같은 기한이면 먼저 들어온 로트부터 출고됩니다.",
          width: 12,
          textFormat: false,
        },
        {
          key: "lotNo",
          header: "로트번호",
          aliases: ["로트", "LOT", "LOT번호"],
          required: false,
          format: `글자 ${STOCK_LIMITS.lotNoMaxLength}자 이내`,
          help: "비우면 자동(L+오늘 날짜-일련번호). 같은 상품에 같은 로트번호는 쓸 수 없습니다.",
          width: 14,
          textFormat: true,
        },
        {
          key: "unitCost",
          header: "입고단가(부가세포함)",
          aliases: ["입고단가부가세포함", "단가(부가세포함)"],
          notAccepted: ["입고단가", "단가", "매입단가", "매입가"],
          required: false,
          format: "원 단위 정수 (예: 12000, 12,000원)",
          help: "개당(단위당) 부가세 포함 금액. 비우면 재고금액은 상품의 기본 매입가로 추정합니다.",
          width: 14,
          textFormat: false,
        },
        {
          key: "supplierCode",
          header: "매입처코드",
          aliases: ["매입처", "거래처코드"],
          required: false,
          format: CODE_FORMAT,
          help: "거래처관리의 매입처(또는 매출·매입) 거래처코드.",
          width: 12,
          textFormat: true,
        },
        {
          key: "memo",
          header: "메모",
          aliases: ["비고"],
          required: false,
          format: `글자 ${STOCK_LIMITS.memoMaxLength}자 이내`,
          help: "",
          width: 24,
          textFormat: true,
        },
      ],
      examples: [
        {
          productCode: "PRC-010",
          quantity: 24,
          warehouseCode: "W01",
          zoneCode: "R",
          locationCode: "A-01-01",
          expiryKind: "소비기한",
          expiryDate: "2028-12-31",
          manufacturedDate: "",
          receivedDate: "2026-10-01",
          lotNo: "",
          unitCost: 23700,
          supplierCode: "300003",
          memo: "",
        },
        {
          productCode: "MEA-001",
          quantity: 12.5,
          warehouseCode: "W01",
          zoneCode: "C",
          locationCode: "",
          expiryKind: "소비기한",
          expiryDate: "",
          manufacturedDate: "2026-10-20",
          receivedDate: "",
          lotNo: "M-1020",
          unitCost: 21000,
          supplierCode: "",
          memo: "기한일은 제조일자로 자동 계산",
        },
        {
          productCode: "VEG-001",
          quantity: 20,
          warehouseCode: "W01",
          zoneCode: "R",
          locationCode: "A-01-02",
          expiryKind: "없음",
          expiryDate: "",
          manufacturedDate: "",
          receivedDate: "",
          lotNo: "",
          unitCost: "",
          supplierCode: "",
          memo: "",
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------

/** What the database knows for the check (import_find_opening_stock_refs). */
export type OpeningStockLookups = {
  /** Products whose 상품코드 (ignoring case) the file uses. */
  products: readonly {
    code: string
    name: string
    productType: ProductType
    isActive: boolean
    unit: string
    storageType: StorageType | null
    shelfLifeDays: number | null
  }[]
  /** Partners whose 거래처코드 the file uses as 매입처. */
  suppliers: readonly {
    code: string
    name: string
    partnerType: "sales" | "purchase" | "both"
    isActive: boolean
  }[]
  /** 로트번호 those products use already (ignoring case). */
  lots: readonly { productCode: string; lotNo: string }[]
  /**
   * 기초재고 of those products registered already (not undone): a row
   * equal to one of them gets a note (the same file uploaded twice?).
   */
  openingLots?: readonly {
    productCode: string
    warehouseCode: string
    zoneCode: string
    locationCode: string
    quantity: number
    expiryDate: string | null
    receivedDate: string
    docNo: string
  }[]
  /** Every 창고 > 구역 > 위치. */
  warehouses: readonly {
    code: string
    name: string
    isActive: boolean
    zones: readonly {
      code: string
      name: string
      storageType: StorageType
      isActive: boolean
      locations: readonly {
        code: string
        name: string | null
        isDefault: boolean
        isActive: boolean
      }[]
    }[]
  }[]
  /** Today in Korea ("YYYY-MM-DD"). */
  today?: string
  /**
   * 전표 일자 허용 범위 (재고 설정): 입고일 up to today + this many days
   * (default 0 = today at most).
   */
  futureDocDays?: number
}

/** One row for import_opening_stock (database keys). */
export type OpeningStockImportRow = {
  excel_row: number
  product_code: string
  /** Digits as typed ("12.5"), so no decimal changes on the way. */
  quantity: string
  warehouse_code: string
  zone_code: string
  /** null = the 구역's 기본 위치. */
  location_code: string | null
  expiry_kind: ExpiryKind
  expiry_date: string | null
  manufactured_date: string | null
  received_date: string | null
  lot_no: string | null
  unit_cost_incl_vat: number | null
  supplier_code: string | null
  memo: string | null
}

export type OpeningStockImportPayload = { rows: OpeningStockImportRow[] }

/** The codes and 로트번호 the check needs from the database. */
export function openingStockLookupKeys(input: ImportInput): {
  productCodes: string[]
  supplierCodes: string[]
  lotNos: string[]
} {
  const productCodes = new Set<string>()
  const supplierCodes = new Set<string>()
  const lotNos = new Set<string>()
  for (const row of input.sheets[MAIN_SHEET] ?? []) {
    const code = cellText(row.values.productCode)
    if (code) productCodes.add(code)
    const supplier = cellText(row.values.supplierCode)
    if (supplier) supplierCodes.add(supplier)
    const lotNo = cellText(row.values.lotNo)
    if (lotNo) lotNos.add(lotNo)
  }
  return {
    productCodes: [...productCodes],
    supplierCodes: [...supplierCodes],
    lotNos: [...lotNos],
  }
}

/** A quantity cell as typed text ("1,234.5", the number 12.5 → "12.5"). */
function quantityText(
  cell: ImportRawRow["values"][string] | undefined
): string {
  if (typeof cell === "number") return numberText(cell)
  return cellText(cell)
}

type RowState = {
  raw: ImportRawRow
  issues: RowIssues
  productCode: string
  lotNo: string
  row: OpeningStockImportRow | null
  note: string | null
}

/** The 입고일 cell of a row when it is a date ("" / invalid → null). */
function receivedDateOf(raw: ImportRawRow): string | null {
  const text = dateText(raw.values.receivedDate)
  return text !== "" && isCalendarDate(text) ? text : null
}

/**
 * The date of the 기초재고 전표 (same rule as import_opening_stock): today,
 * or the latest 입고일 when it is later (only 입고일 within the limit
 * count; later ones are errors).
 */
function openingDocDate(
  receivedDates: readonly (string | null)[],
  today: string,
  limit: string
): string {
  let date = today
  for (const received of receivedDates) {
    if (received && received > date && received <= limit) date = received
  }
  return date
}

function checkRow(
  raw: ImportRawRow,
  lookups: OpeningStockLookups,
  today: string,
  futureDays: number,
  docDate: string
): RowState {
  const issues = new RowIssues()
  addCellFlags(issues, raw)
  const values = raw.values
  const notes: string[] = []

  // 상품
  const productCode = cellText(values.productCode)
  const product = productCode
    ? lookups.products.find(
        (item) => codeKey(item.code) === codeKey(productCode)
      )
    : undefined
  if (!productCode) {
    issues.error("productCode", "상품코드를 적어 주세요.")
  } else if (!product) {
    issues.error(
      "productCode",
      `상품코드 ‘${productCode}’을(를) 찾을 수 없습니다.`
    )
  } else if (product.productType !== "base") {
    issues.error(
      "productCode",
      `‘${product.name}’은(는) 묶음상품입니다. 기초재고는 구성 기준상품코드로 나눠 적어 주세요.`
    )
  } else if (!product.isActive) {
    issues.error(
      "productCode",
      `사용중지된 상품(${product.code} ${product.name})은 재고를 등록할 수 없습니다.`
    )
  }

  // 수량 (in the product's unit)
  const quantity = quantityText(values.quantity)
  const parsedQuantity = parseStockQuantity(quantity, product?.unit ?? "kg")
  if (!parsedQuantity.ok) issues.error("quantity", parsedQuantity.message)

  // 창고 > 구역 > 선반
  const warehouseCode = cellText(values.warehouseCode)
  const zoneCode = cellText(values.zoneCode)
  const locationCode = cellText(values.locationCode)
  const warehouse = warehouseCode
    ? lookups.warehouses.find(
        (item) => codeKey(item.code) === codeKey(warehouseCode)
      )
    : undefined
  const zone = warehouse?.zones.find(
    (item) => codeKey(item.code) === codeKey(zoneCode)
  )
  const location = zone
    ? locationCode
      ? zone.locations.find(
          (item) => codeKey(item.code) === codeKey(locationCode)
        )
      : zone.locations.find((item) => item.isDefault)
    : undefined
  if (!warehouseCode) {
    issues.error("warehouseCode", "창고코드를 적어 주세요.")
  } else if (!warehouse) {
    issues.error(
      "warehouseCode",
      `창고코드 ‘${warehouseCode}’을(를) 찾을 수 없습니다. 창고·로케이션 설정에서 먼저 만들어 주세요.`
    )
  } else if (!zoneCode) {
    issues.error("zoneCode", "구역코드를 적어 주세요.")
  } else if (!zone) {
    issues.error(
      "zoneCode",
      `창고 ‘${warehouse.code}’에 구역코드 ‘${zoneCode}’이(가) 없습니다.`
    )
  } else if (!location) {
    issues.error(
      "locationCode",
      `구역 ‘${zone.code}’에 선반코드 ‘${locationCode}’이(가) 없습니다.`
    )
  } else if (!warehouse.isActive || !zone.isActive || !location.isActive) {
    issues.error(
      !warehouse.isActive
        ? "warehouseCode"
        : !zone.isActive
          ? "zoneCode"
          : "locationCode",
      `사용중지된 위치(${warehouse.name} > ${zone.name} > ${location.code})에는 재고를 넣을 수 없습니다.`
    )
  }
  if (
    product?.storageType &&
    zone &&
    zone.storageType !== product.storageType
  ) {
    issues.warn(
      "zoneCode",
      `${product.name}은(는) ${storageTypeLabel(product.storageType)} 상품인데 ${storageTypeLabel(zone.storageType)} 구역입니다. 그래도 등록됩니다.`
    )
  }

  // 날짜
  const readDate = (
    key: "expiryDate" | "manufacturedDate" | "receivedDate",
    label: string
  ) => {
    const text = dateText(values[key])
    if (text === "") return null
    if (!isCalendarDate(text)) {
      issues.error(key, `${label}을(를) 날짜(예: 2026-10-23)로 적어 주세요.`)
      return undefined
    }
    return text
  }
  const receivedDate = readDate("receivedDate", "입고일")
  const manufacturedDate = readDate("manufacturedDate", "제조일자")
  let expiryDate = readDate("expiryDate", "기한일")
  // A blank 입고일 = the 전표 date (today, or the latest 입고일 of the file).
  const received = receivedDate ?? docDate
  if (receivedDate && receivedDate > maxDocDate(futureDays, today)) {
    issues.error(
      "receivedDate",
      docDateLimitMessage(futureDays, today, "입고일은")
    )
  } else if (receivedDate && receivedDate > today) {
    issues.warn(
      "receivedDate",
      `입고일이 오늘 이후입니다. 기초재고 전표가 ${docDate} 날짜(예정)로 등록되어, 이 파일의 재고는 모두 ${docDate}부터 출고할 수 있습니다.`
    )
    notes.push(`예정 ${receivedDate.slice(5)}`)
  }
  if (manufacturedDate && manufacturedDate > received) {
    issues.error(
      "manufacturedDate",
      `제조일자는 입고일(${received})보다 늦을 수 없습니다.`
    )
  }

  // 기한종류 + 기한일
  let expiryKind = matchChoice(values.expiryKind, EXPIRY_KIND_CHOICES)
  if (expiryKind === undefined) {
    issues.error(
      "expiryKind",
      `기한종류는 ${choiceLabels(EXPIRY_KIND_CHOICES)} 중 하나로 적어 주세요.`
    )
  }
  const computed =
    expiryDate === null && manufacturedDate
      ? suggestExpiryDate(manufacturedDate, product?.shelfLifeDays)
      : null
  if (expiryKind === null) {
    expiryKind = expiryDate || computed ? "use_by" : "none"
    if (expiryDate || computed) {
      issues.warn("expiryKind", "기한종류를 비워 ‘소비기한’으로 등록합니다.")
    }
  }
  if (expiryKind === "none" && expiryDate) {
    issues.error("expiryDate", "기한종류가 ‘없음’이면 기한일을 비워 주세요.")
  }
  if (expiryKind && expiryKind !== "none" && expiryDate === null) {
    if (computed) {
      expiryDate = computed
      notes.push(`기한 자동 ${computed}`)
    } else if (product && !issues.hasError("expiryDate")) {
      issues.error(
        "expiryDate",
        product.shelfLifeDays
          ? "기한일을 적거나 제조일자를 적어 주세요. (제조일자가 있으면 유통기한 기준일수로 계산합니다.)"
          : "기한일을 적어 주세요. (이 상품에는 유통기한 기준일수가 없어 자동 계산할 수 없습니다.)"
      )
    }
  }
  if (expiryDate && manufacturedDate && expiryDate < manufacturedDate) {
    issues.error("expiryDate", "기한일은 제조일자보다 빠를 수 없습니다.")
  }
  // Past its 기한 on the 전표 date (where the stock appears).
  if (
    expiryDate &&
    expiryKind !== "none" &&
    expiryStatus(expiryDate, 0, docDate) === "expired"
  ) {
    issues.warn(
      "expiryDate",
      docDate === today
        ? "기한이 이미 지난 재고입니다. 출고에서 빠지며, 등록한 뒤 폐기 등록으로 정리할 수 있습니다."
        : `기초재고 전표 날짜(${docDate})에 이미 기한이 지난 재고입니다. 출고에서 빠지며, 등록한 뒤 폐기 등록으로 정리할 수 있습니다.`
    )
  }

  // 로트번호, 단가, 매입처, 메모
  const lotNo = cellText(values.lotNo)
  if (lotNo.length > STOCK_LIMITS.lotNoMaxLength) {
    issues.error(
      "lotNo",
      `로트번호는 ${STOCK_LIMITS.lotNoMaxLength}자 이하로 적어 주세요.`
    )
  } else if (
    lotNo &&
    product &&
    lookups.lots.some(
      (lot) =>
        codeKey(lot.productCode) === codeKey(product.code) &&
        codeKey(lot.lotNo) === codeKey(lotNo)
    )
  ) {
    issues.error(
      "lotNo",
      `‘${product.name}’에 로트번호 ‘${lotNo}’이(가) 이미 있습니다.`
    )
  }
  if (!lotNo) notes.push("로트 자동")

  // The same 기초재고 registered before (e.g. the same file uploaded twice):
  // only a note — two lots may really be alike.
  if (product && warehouse && zone && location && parsedQuantity.ok) {
    const same = (lookups.openingLots ?? []).find(
      (lot) =>
        codeKey(lot.productCode) === codeKey(product.code) &&
        codeKey(lot.warehouseCode) === codeKey(warehouse.code) &&
        codeKey(lot.zoneCode) === codeKey(zone.code) &&
        codeKey(lot.locationCode) === codeKey(location.code) &&
        lot.quantity === parsedQuantity.value &&
        lot.expiryDate ===
          (expiryKind === "none" ? null : (expiryDate ?? null)) &&
        lot.receivedDate === received
    )
    if (same) {
      issues.warn(
        "productCode",
        `같은 상품·위치·수량·기한의 기초재고가 이미 등록되어 있습니다 (${same.docNo}). 같은 파일을 두 번 올린 것이 아닌지 확인해 주세요. (그래도 등록됩니다)`
      )
    }
  }

  const costText = amountText(values.unitCost)
  let unitCost: number | null = null
  if (costText !== "") {
    if (
      !/^\d{1,11}$/.test(costText) ||
      Number(costText) > STOCK_LIMITS.unitCostMax
    ) {
      issues.error(
        "unitCost",
        "입고단가는 0원 이상 100억 원 이하의 정수(원 단위)로 적어 주세요."
      )
    } else {
      unitCost = Number(costText)
    }
  }

  const supplierCode = cellText(values.supplierCode)
  if (supplierCode) {
    const supplier = lookups.suppliers.find(
      (item) => codeKey(item.code) === codeKey(supplierCode)
    )
    if (!supplier) {
      issues.error(
        "supplierCode",
        `매입처코드 ‘${supplierCode}’을(를) 찾을 수 없습니다.`
      )
    } else if (supplier.partnerType === "sales") {
      issues.error(
        "supplierCode",
        `‘${supplier.name}’은(는) 매출처입니다. 매입처(또는 매출·매입) 거래처코드를 적어 주세요.`
      )
    } else if (!supplier.isActive) {
      issues.error(
        "supplierCode",
        `미사용 거래처(${supplier.name})는 매입처로 고를 수 없습니다.`
      )
    }
  }

  const memo = cellText(values.memo)
  if (memo.length > STOCK_LIMITS.memoMaxLength) {
    issues.error(
      "memo",
      `메모는 ${STOCK_LIMITS.memoMaxLength}자 이하로 적어 주세요.`
    )
  }

  const row: OpeningStockImportRow | null =
    issues.hasErrors || !product || !expiryKind
      ? null
      : {
          excel_row: raw.excelRow,
          product_code: product.code,
          quantity: quantity.replace(/,/g, "").trim(),
          warehouse_code: warehouseCode,
          zone_code: zoneCode,
          location_code: locationCode || null,
          expiry_kind: expiryKind,
          expiry_date: expiryKind === "none" ? null : (expiryDate ?? null),
          manufactured_date: manufacturedDate ?? null,
          received_date: receivedDate ?? null,
          lot_no: lotNo || null,
          unit_cost_incl_vat: unitCost,
          supplier_code: supplierCode || null,
          memo: memo || null,
        }
  return {
    raw,
    issues,
    productCode: product?.code ?? productCode,
    lotNo,
    row,
    note: notes.length ? notes.join(", ") : null,
  }
}

/**
 * Checks every row of a 기초재고 file and returns the 미리보기 and the 정상
 * rows for import_opening_stock:
 * 1. each row: 상품 (기준상품, 사용), 수량 (by the product's 단위), 창고 >
 *    구역 > 선반 (사용; blank 선반 = 기본 위치), 기한종류 / 기한일 (or
 *    제조일자 + 유통기한 기준일수), 날짜 order (입고일 at most today + the
 *    재고 설정's days), 로트번호, 입고단가, 매입처; notes for 보관온도
 *    불일치, stock already past its 기한 on the 전표 date and a 예정 입고일;
 * 2. the same 로트번호 twice for one 상품 in the file.
 * The 전표 date is today or the latest 입고일 of the 정상 rows (as the
 * database decides it); blank 입고일 get that date.
 */
export function checkOpeningStockImport(
  input: ImportInput,
  lookups: OpeningStockLookups
): { preview: ImportPreview; payload: OpeningStockImportPayload } {
  const today = lookups.today ?? todayInKorea()
  const futureDays = lookups.futureDocDays ?? 0
  const limit = maxDocDate(futureDays, today)
  const raws = input.sheets[MAIN_SHEET] ?? []
  // First with every row's 입고일; again when the 정상 rows decide another
  // date (a row with the latest 입고일 may have another error).
  let docDate = openingDocDate(raws.map(receivedDateOf), today, limit)
  let rows = checkRows(raws, lookups, today, futureDays, docDate)
  const okDocDate = openingDocDate(
    rows.map((state) =>
      state.issues.hasErrors || !state.row ? null : state.row.received_date
    ),
    today,
    limit
  )
  if (okDocDate !== docDate) {
    docDate = okDocDate
    rows = checkRows(raws, lookups, today, futureDays, docDate)
  }

  const results: ImportRowResult[] = rows.map((state) => ({
    sheet: MAIN_SHEET,
    excelRow: state.raw.excelRow,
    status: state.issues.hasErrors ? "error" : "ok",
    errors: state.issues.errors,
    warnings: state.issues.warnings,
    note: state.issues.hasErrors ? null : state.note,
  }))
  return {
    preview: buildPreview(results),
    payload: {
      rows: rows.flatMap((state) =>
        !state.issues.hasErrors && state.row ? [state.row] : []
      ),
    },
  }
}

/** Every row checked for one 전표 date, then 로트번호 twice in the file. */
function checkRows(
  raws: readonly ImportRawRow[],
  lookups: OpeningStockLookups,
  today: string,
  futureDays: number,
  docDate: string
): RowState[] {
  const rows = raws.map((raw) =>
    checkRow(raw, lookups, today, futureDays, docDate)
  )

  for (const [state, others] of findDuplicates(
    rows,
    (state) =>
      state.lotNo ? `${codeKey(state.productCode)}\u001f${state.lotNo}` : null,
    (state) => ({ sheetLabel: null, excelRow: state.raw.excelRow }),
    codeKey
  )) {
    state.issues.error(
      "lotNo",
      `파일 안에서 같은 상품에 같은 로트번호가 또 있습니다 (${placesText(others)}).`
    )
    state.row = null
  }
  return rows
}
