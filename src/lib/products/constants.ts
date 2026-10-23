/**
 * Fixed choices and input rules for 상품 (products).
 *
 * The database checks the same rules (see the products migration in
 * supabase/migrations/). When you change a rule here, change it there too
 * with a new migration.
 */

import type { Enums } from "@/types/database"

// ---------------------------------------------------------------------------
// 상품유형 (product type): 기준상품 or 묶음상품
// ---------------------------------------------------------------------------

/** Database value of 상품유형: "base" (기준상품) | "bundle" (묶음상품). */
export type ProductType = Enums<"product_type">

/**
 * 상품유형 choices, in display order. Chosen when a product is registered;
 * it never changes afterwards (the database refuses it).
 * - 기준상품 (개입): one single unit, the top-level code. It holds the food
 *   information, and later all stock.
 * - 묶음상품: one or more 기준상품 × quantity (구성표), e.g.
 *   "[묶음] 스팸 클래식 1.81kg X 6개입". Its food information is worked out
 *   from its 기준상품 (see deriveBundleFoodInfo in `@/lib/products/bundle`).
 */
export const PRODUCT_TYPES = [
  {
    value: "base",
    label: "기준상품",
    /** For the radio button: "기준상품(개입)". */
    longLabel: "기준상품(개입)",
    /** For the list's 구분 badge. */
    shortLabel: "기준",
    description: "낱개(개입) 1개 단위의 최상위 상품",
  },
  {
    value: "bundle",
    label: "묶음상품",
    longLabel: "묶음상품",
    shortLabel: "묶음",
    description: "기준상품 여러 개를 묶은 상품 (예: 6개입, 24개입, 선물세트)",
  },
] as const satisfies readonly {
  value: ProductType
  label: string
  longLabel: string
  shortLabel: string
  description: string
}[]

/**
 * Korean label of a 상품유형 value.
 * @example productTypeLabel("bundle") // "묶음상품"
 */
export function productTypeLabel(value: ProductType): string {
  return PRODUCT_TYPES.find((type) => type.value === value)?.label ?? value
}

/**
 * Short label for the list's 구분 badge.
 * @example productTypeShortLabel("base") // "기준"
 */
export function productTypeShortLabel(value: ProductType): string {
  return PRODUCT_TYPES.find((type) => type.value === value)?.shortLabel ?? value
}

// ---------------------------------------------------------------------------
// 보관온도 (storage type)
// ---------------------------------------------------------------------------

/** Database value of 보관온도: "room" | "chilled" | "frozen". */
export type StorageType = Enums<"storage_type">

/** 보관온도 choices, in display order. */
export const STORAGE_TYPES = [
  { value: "room", label: "상온", description: "냉장·냉동이 필요 없음" },
  { value: "chilled", label: "냉장", description: "0~10°C" },
  { value: "frozen", label: "냉동", description: "-18°C 이하" },
] as const satisfies readonly {
  value: StorageType
  label: string
  description: string
}[]

/**
 * Korean label of a 보관온도 value.
 * @example storageTypeLabel("chilled") // "냉장"
 */
export function storageTypeLabel(value: StorageType): string {
  return STORAGE_TYPES.find((type) => type.value === value)?.label ?? value
}

// ---------------------------------------------------------------------------
// 과세구분 (VAT type)
// ---------------------------------------------------------------------------

/** Database value of 과세구분: "taxable" | "exempt". */
export type TaxType = Enums<"tax_type">

/** 과세구분 choices of a 기준상품, in display order. There is no default: users must pick one. */
export const TAX_TYPES = [
  { value: "taxable", label: "과세", description: "부가세 10%" },
  { value: "exempt", label: "면세", description: "부가세 없음" },
] as const satisfies readonly {
  value: TaxType
  label: string
  description: string
}[]

/**
 * 과세구분 in effect (the list, its filter and the 엑셀 file): a 기준상품's
 * own value, or for a 묶음상품 "taxable" when all its 기준상품 are 과세,
 * "exempt" when all are 면세, otherwise "mixed" (혼합). The view
 * product_list_items returns the same values (effective_tax_type).
 * A 혼합 묶음상품's price (부가세 포함) is split into a 과세 and a 면세 part
 * by its 기준상품's prices to work out its 부가세 (allocateMixed in
 * `@/lib/products/vat`; the future 정산 module uses the same rule).
 */
export type EffectiveTaxType = TaxType | "mixed"

/** 과세구분 filter / display choices including 혼합, in display order. */
export const EFFECTIVE_TAX_TYPES = [
  ...TAX_TYPES,
  {
    value: "mixed",
    label: "혼합",
    description: "과세·면세 기준상품이 섞인 묶음상품",
  },
] as const satisfies readonly {
  value: EffectiveTaxType
  label: string
  description: string
}[]

/**
 * Korean label of a 과세구분 value (also "mixed" → "혼합").
 * @example taxTypeLabel("exempt") // "면세"
 */
export function taxTypeLabel(value: EffectiveTaxType): string {
  return (
    EFFECTIVE_TAX_TYPES.find((type) => type.value === value)?.label ?? value
  )
}

// ---------------------------------------------------------------------------
// 단위 (unit)
// ---------------------------------------------------------------------------

/**
 * Units a product can use, in display order. Each product has exactly one
 * unit (no 박스 ↔ 개 conversion for now). The database only checks that the
 * unit is 1–10 characters, so this list can change without a migration.
 */
export const UNITS = [
  "kg",
  "g",
  "L",
  "mL",
  "개",
  "EA",
  "박스",
  "봉",
  "팩",
  "병",
  "캔",
  "통",
  "판",
  "단",
  "망",
  "포",
  "마리",
  "장",
  "묶음",
  "세트",
] as const

/** One of UNITS. */
export type Unit = (typeof UNITS)[number]

// ---------------------------------------------------------------------------
// 알레르기 유발물질 (allergens)
// ---------------------------------------------------------------------------

/**
 * Allergens that must be labeled in Korea, in the order the law lists them.
 * `value` is the key stored in products.allergens; never change a value,
 * only labels.
 *
 * Source: 식품 등의 표시·광고에 관한 법률 시행규칙 [별표 2] 소비자 안전을 위한
 * 표시사항, 1. 알레르기 유발물질 표시 (개정 2024. 12. 30., 시행 2026. 1. 1. 기준),
 * checked on 2026-10-21. A draft amendment (식품의약품안전처공고 제2026-386호,
 * 입법예고 2026-08-07) would add 참깨, 들깨, 아몬드, 캐슈너트; it was not in
 * force yet. When it is, add those items here AND update the
 * products_allergens_check constraint with a new migration.
 */
export const ALLERGENS = [
  { value: "egg", label: "알류(가금류)" },
  { value: "milk", label: "우유" },
  { value: "buckwheat", label: "메밀" },
  { value: "peanut", label: "땅콩" },
  { value: "soybean", label: "대두" },
  { value: "wheat", label: "밀" },
  { value: "mackerel", label: "고등어" },
  { value: "crab", label: "게" },
  { value: "shrimp", label: "새우" },
  { value: "pork", label: "돼지고기" },
  { value: "peach", label: "복숭아" },
  { value: "tomato", label: "토마토" },
  { value: "sulfites", label: "아황산류" },
  { value: "walnut", label: "호두" },
  { value: "chicken", label: "닭고기" },
  { value: "beef", label: "쇠고기" },
  { value: "squid", label: "오징어" },
  { value: "shellfish", label: "조개류(굴·전복·홍합 포함)" },
  { value: "pine_nut", label: "잣" },
] as const satisfies readonly { value: string; label: string }[]

/** One of the ALLERGENS values, e.g. "egg". */
export type Allergen = (typeof ALLERGENS)[number]["value"]

/**
 * Korean label of an allergen key. Unknown keys are returned as they are.
 * @example allergenLabel("pine_nut") // "잣"
 */
export function allergenLabel(value: string): string {
  return ALLERGENS.find((allergen) => allergen.value === value)?.label ?? value
}

// ---------------------------------------------------------------------------
// Input rules (the database checks the same rules)
// ---------------------------------------------------------------------------

/** 상품코드: 1–30 letters, digits, ".", "_" or "-". Unique ignoring case. */
export const PRODUCT_CODE_PATTERN = /^[A-Za-z0-9._-]{1,30}$/

/** 바코드: 8–14 digits. Unique when filled in. */
export const BARCODE_PATTERN = /^[0-9]{8,14}$/

/**
 * Maximum lengths (characters) and number ranges for product and category
 * fields. Text is stored trimmed; empty optional text is stored as null.
 */
export const PRODUCT_LIMITS = {
  codeMaxLength: 30,
  nameMaxLength: 100,
  unitMaxLength: 10,
  specMaxLength: 100,
  originMaxLength: 100,
  manufacturerMaxLength: 100,
  noteMaxLength: 1000,
  categoryNameMaxLength: 30,
  shelfLifeDaysMin: 1,
  shelfLifeDaysMax: 3650,
  /**
   * Prices are whole won (원), 0 or more, 부가세 포함 (VAT-inclusive, as
   * typed). The 부가세 별도 amount is worked out (`@/lib/products/vat`).
   */
  priceMin: 0,
} as const

/**
 * 수량 of one 기준상품 in a 묶음상품's 구성표 (`product_bundle_items.quantity`),
 * in that 기준상품's own unit: whole number 1–100000. The database checks the
 * same range (constraint `product_bundle_items_quantity_check`).
 */
export const BUNDLE_ITEM_QUANTITY = {
  min: 1,
  max: 100000,
} as const

/**
 * Most 기준상품 (rows) one 묶음상품 may contain. The functions
 * create_bundle_product / update_bundle_product check the same number.
 */
export const BUNDLE_ITEMS_MAX = 100

/**
 * Names of database constraints that a Server Action can turn into a field
 * error. A violation comes back from Supabase with `error.code === "23505"`
 * (duplicate) and the constraint name inside `error.message`.
 */
export const PRODUCT_DB_CONSTRAINTS = {
  /** Same 상품코드 already used (ignoring case). → "이미 사용 중인 상품코드입니다." */
  codeUnique: "products_code_lower_key",
  /** Same 바코드 already used. */
  barcodeUnique: "products_barcode_key",
  /** Same category name under the same parent. */
  categoryNameUnique: "product_categories_parent_id_name_key",
  /** Product's category does not exist (deleted meanwhile). */
  categoryForeignKey: "products_category_id_fkey",
  /** Same 기준상품 twice in one 묶음상품. */
  bundleItemUnique: "product_bundle_items_pkey",
  /** 구성표 수량 out of range (see BUNDLE_ITEM_QUANTITY). */
  bundleItemQuantity: "product_bundle_items_quantity_check",
  /** 기준상품 without 보관온도/과세구분, or 묶음상품 with food fields. */
  productTypeFields: "products_product_type_fields_check",
} as const

/**
 * Keys of the rules that the database's own functions and triggers check
 * for 기준상품/묶음상품 (supabase/migrations/*_bundle_products.sql and
 * *_vat_inclusive_prices.sql). The database sends a Korean message
 * (`error.message`, ready to show) and this key in `error.hint`, so a
 * Server Action knows which field it belongs to.
 * Change both places together.
 */
export const PRODUCT_DB_RULES = {
  /** 상품유형 cannot change after registration. */
  typeFixed: "product_type_fixed",
  /** A 구성상품 that does not exist. */
  componentNotFound: "bundle_component_not_found",
  /** A 묶음상품 inside a 묶음상품. */
  componentNotBase: "bundle_component_not_base",
  /** 구성표 row for a 묶음상품 that does not exist. */
  bundleNotFound: "bundle_not_found",
  /** 구성표 row under a 기준상품. */
  itemParentNotBundle: "bundle_item_parent_not_bundle",
  /** A 사용중지 기준상품 put into a 사용 묶음상품. */
  componentInactive: "bundle_component_inactive",
  /** A 묶음상품 switched on while one of its 기준상품 is 사용중지. */
  activationBlocked: "bundle_activation_blocked",
  /** A 묶음상품 without any 기준상품. */
  itemsEmpty: "bundle_items_empty",
  /** More than BUNDLE_ITEMS_MAX 기준상품. */
  itemsTooMany: "bundle_items_too_many",
  /** The same 기준상품 twice. */
  itemsDuplicate: "bundle_items_duplicate",
  /** update_bundle_product: no such product. */
  productNotFound: "product_not_found",
  /** update_bundle_product: the product is a 기준상품. */
  productNotBundle: "product_not_bundle",
  /** update_bundle_product: saved by someone else after the form opened. */
  productChanged: "product_changed",
  /**
   * create_bundle_product / update_bundle_product got the old price keys
   * "purchase_price" / "sale_price" (before prices became VAT-inclusive:
   * now "purchase_price_incl_vat" / "sale_price_incl_vat"). Only an app
   * from before that change sends them.
   */
  priceKeysRenamed: "price_keys_renamed",
} as const
