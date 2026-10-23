/**
 * 거래처분류 (partner categories): up to three levels (대분류 → 중분류 →
 * 소분류), managed by the users in the 분류값 설정 window of the
 * 거래처분류설정 screen (/partners/categories). The window saves all its
 * changes at once (savePartnerCategories); the same screen puts checked
 * partners into a category or back to 미분류 (setPartnersCategory).
 *
 * A partner has at most one 거래처분류 (any level); none = "미분류". A
 * category can only be newly chosen when it and every category above it
 * are 사용; partners keep one that was switched off later. Delete only when
 * no partner uses it and it has no sub-categories. The database checks the
 * same rules (supabase/migrations/*_partner_categories_tree_employees_v2.sql).
 *
 * The tree type and its helpers are in ./tree.ts. No server imports here:
 * Client Components use this file too.
 */

import { z } from "zod"

import { PARTNER_CATEGORY_NAME_MAX_LENGTH } from "@/lib/partner-categories/tree"
import { isUuid } from "@/lib/products/schema"

export {
  UNCATEGORIZED_PARTNER_LABEL,
  type PartnerCategoryNode,
} from "@/lib/partner-categories/tree"

/** Shown when a category id is missing or malformed (e.g. an old page). */
export const PARTNER_CATEGORY_NOT_FOUND_MESSAGE =
  "거래처분류를 찾을 수 없습니다. 이미 삭제되었을 수 있으니 화면을 새로 고친 뒤 다시 시도해 주세요."

/** What to do instead of deleting a category that is still in use. */
export const PARTNER_CATEGORY_DEACTIVATE_HINT =
  "더 이상 쓰지 않는 분류라면 삭제 대신 ‘사용 중지’를 해 주세요. 사용 중지한 분류(와 그 아래 분류)에는 거래처를 새로 넣을 수 없고, 이미 넣은 거래처는 그대로 남습니다."

/** A category id (uuid). */
export const partnerCategoryIdSchema = z.guid({
  error: PARTNER_CATEGORY_NOT_FOUND_MESSAGE,
})

/**
 * 분류 이름: spaces at both ends are removed; 1–30 characters.
 * normalize("NFC") turns pasted, decomposed Hangul (e.g. copied from a macOS
 * file name) into the usual form, so a name that looks the same as another
 * also counts as the same name (the database checks this form).
 */
export const partnerCategoryNameSchema = z
  .string({ error: "분류 이름을 입력해 주세요." })
  .trim()
  .normalize("NFC")
  .min(1, { error: "분류 이름을 입력해 주세요." })
  .max(PARTNER_CATEGORY_NAME_MAX_LENGTH, {
    error: `분류 이름은 ${PARTNER_CATEGORY_NAME_MAX_LENGTH}자 이내로 입력해 주세요.`,
  })

/** Most changes one 분류값 설정 save may hold (the database checks it too). */
export const PARTNER_CATEGORY_CHANGES_MAX = 1000

const INVALID_CHANGES_MESSAGE =
  "분류 변경 내용을 읽을 수 없습니다. 창을 닫고 다시 열어 주세요."

/** The window's key of a row added in it, e.g. "new-3". */
const tempIdSchema = z
  .string({ error: INVALID_CHANGES_MESSAGE })
  .min(1, { error: INVALID_CHANGES_MESSAGE })
  .max(50, { error: INVALID_CHANGES_MESSAGE })

/**
 * The changes of the 분류값 설정 window (PartnerCategoryChanges in
 * ./tree.ts, made by buildPartnerCategoryChanges), checked again by the
 * Server Action before they go to the database.
 */
export const partnerCategoryChangesSchema = z
  .object({
    deleted: z
      .array(partnerCategoryIdSchema, { error: INVALID_CHANGES_MESSAGE })
      .transform((ids) => ids.map((id) => id.toLowerCase())),
    categories: z.array(
      z
        .object({
          id: partnerCategoryIdSchema.nullable(),
          tempId: tempIdSchema.nullable(),
          parentId: partnerCategoryIdSchema.nullable(),
          parentTempId: tempIdSchema.nullable(),
          name: partnerCategoryNameSchema,
          isActive: z.boolean({ error: INVALID_CHANGES_MESSAGE }),
          sortOrder: z
            .number({ error: INVALID_CHANGES_MESSAGE })
            .int({ error: INVALID_CHANGES_MESSAGE })
            .min(0, { error: INVALID_CHANGES_MESSAGE })
            .max(999_999_999, { error: INVALID_CHANGES_MESSAGE }),
        })
        // An added row needs its key; a saved row keeps its parent.
        .refine((item) => item.id !== null || item.tempId !== null, {
          error: INVALID_CHANGES_MESSAGE,
        }),
      { error: INVALID_CHANGES_MESSAGE }
    ),
  })
  .refine(
    (changes) =>
      changes.deleted.length + changes.categories.length <=
      PARTNER_CATEGORY_CHANGES_MAX,
    {
      error: `한 번에 저장할 수 있는 분류 변경은 ${PARTNER_CATEGORY_CHANGES_MAX}개까지입니다. 나눠서 저장해 주세요.`,
    }
  )

/**
 * The category for 분류적용 (a category id), or null for 분류해제
 * (미분류).
 */
export const targetPartnerCategorySchema = z
  .union([z.null(), z.string()], { error: PARTNER_CATEGORY_NOT_FOUND_MESSAGE })
  .refine((value) => value === null || isUuid(value), {
    error: PARTNER_CATEGORY_NOT_FOUND_MESSAGE,
  })
  .transform((value) => (value === null ? null : value.toLowerCase()))
