"use server"

import type { PostgrestError } from "@supabase/supabase-js"
import { revalidatePath } from "next/cache"

import { requireUser } from "@/lib/auth/user"
import {
  getPartnerCategoryTree,
  getPartnerCategoryTreeVersion,
} from "@/lib/partner-categories/queries"
import {
  partnerCategoryChangesSchema,
  targetPartnerCategorySchema,
} from "@/lib/partner-categories/schema"
import {
  isCategorySelectable,
  partnerCategoryPathText,
  type PartnerCategoryNode,
} from "@/lib/partner-categories/tree"
import { isPartnerDbRule, PARTNER_DB_RULES } from "@/lib/partners/constants"
import { partnerIdsSchema } from "@/lib/partners/schema"
import { createClient } from "@/lib/supabase/server"

/**
 * Every 거래처분류 as a tree (사용 and 사용 중지, with partner counts), read
 * fresh: pickers and filters call it when they open, so categories changed
 * in another tab show up without reloading the page (a Server Action, not
 * router.refresh(): see "Modal state lives in the URL" in CLAUDE.md).
 */
export async function loadPartnerCategories(): Promise<PartnerCategoryNode[]> {
  await requireUser()
  return getPartnerCategoryTree()
}

/**
 * What the 분류값 설정 window starts from: the tree and its version (hand
 * the version back to savePartnerCategories). The version is read first,
 * so a change that lands in between makes the save refuse instead of
 * silently undoing it.
 */
export async function loadPartnerCategorySettings(): Promise<{
  tree: PartnerCategoryNode[]
  version: string
}> {
  await requireUser()
  const version = await getPartnerCategoryTreeVersion()
  const tree = await getPartnerCategoryTree()
  return { tree, version }
}

/** What the 분류값 설정 window gets back from savePartnerCategories. */
export type PartnerCategorySaveResult =
  | {
      ok: true
      /** Korean message for a toast, e.g. "거래처분류를 저장했습니다. (추가 2, 삭제 1)". */
      message: string
      added: number
      updated: number
      deleted: number
    }
  | {
      ok: false
      /** Korean message (shown in the window or as a toast). */
      error: string
      /**
       * True when someone else changed the categories after the window
       * was opened: close and open it again (loadPartnerCategorySettings).
       */
      treeChanged: boolean
    }

/**
 * Saves every change of the 분류값 설정 window at once (adds, also below
 * rows added in the same save, renames, new order, 사용 / 사용 중지,
 * deletes) in one transaction: everything is saved, or nothing.
 *
 * @param loadedVersion the version from loadPartnerCategorySettings
 * @param changes buildPartnerCategoryChanges(savedTree, draft)
 *   (`@/lib/partner-categories/tree`), checked here again
 */
export async function savePartnerCategories(
  loadedVersion: unknown,
  changes: unknown
): Promise<PartnerCategorySaveResult> {
  await requireUser()
  if (typeof loadedVersion !== "string" || loadedVersion === "") {
    return {
      ok: false,
      error: "분류 목록을 다시 불러와 주세요. 창을 닫고 다시 열어 주세요.",
      treeChanged: true,
    }
  }
  const parsed = partnerCategoryChangesSchema.safeParse(changes)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "입력한 내용을 확인해 주세요.",
      treeChanged: false,
    }
  }
  const { deleted, categories } = parsed.data

  const supabase = await createClient()
  const { data, error } = await supabase.rpc("save_partner_categories", {
    loaded_version: loadedVersion,
    changes: {
      deleted,
      categories: categories.map((category) => ({
        id: category.id?.toLowerCase() ?? null,
        temp_id: category.tempId,
        parent_id: category.parentId?.toLowerCase() ?? null,
        parent_temp_id: category.parentTempId,
        name: category.name,
        is_active: category.isActive,
        sort_order: category.sortOrder,
      })),
    },
  })
  if (error) {
    return {
      ok: false,
      error: databaseErrorMessage(error, "거래처분류를 저장하지 못했습니다."),
      treeChanged: error.hint === PARTNER_DB_RULES.categoryTreeChanged,
    }
  }

  const counts = data as { added: number; updated: number; deleted: number }
  revalidatePartnerPages()
  const parts = [
    counts.added > 0 ? `추가 ${counts.added}` : null,
    counts.updated > 0 ? `수정 ${counts.updated}` : null,
    counts.deleted > 0 ? `삭제 ${counts.deleted}` : null,
  ].filter((part) => part !== null)
  return {
    ok: true,
    message:
      parts.length > 0
        ? `거래처분류를 저장했습니다. (${parts.join(", ")})`
        : "바뀐 내용이 없습니다.",
    added: counts.added,
    updated: counts.updated,
    deleted: counts.deleted,
  }
}

/** What the 거래처분류설정 list gets back from setPartnersCategory. */
export type PartnerCategoryAssignResult =
  | {
      ok: true
      /** Korean message for a toast. */
      message: string
      /** Partners whose 거래처분류 changed. */
      changed: number
      /** Checked partners that already had it (or no longer exist). */
      unchanged: number
    }
  | { ok: false; message: string }

/**
 * 분류적용 (`categoryId` = a category id, any level) / 분류해제
 * (`categoryId` = null → 미분류) for the checked partners, in one request
 * and one transaction. The category and every category above it must be
 * 사용 (checked here and again by the database). `partnerIds`: 1–300 ids.
 */
export async function setPartnersCategory(
  partnerIds: unknown,
  categoryId: unknown
): Promise<PartnerCategoryAssignResult> {
  await requireUser()
  const ids = partnerIdsSchema.safeParse(partnerIds)
  if (!ids.success) {
    return {
      ok: false,
      message: ids.error.issues[0]?.message ?? "거래처를 다시 선택해 주세요.",
    }
  }
  const target = targetPartnerCategorySchema.safeParse(categoryId)
  if (!target.success) {
    return {
      ok: false,
      message:
        target.error.issues[0]?.message ?? "거래처분류를 다시 선택해 주세요.",
    }
  }

  let pathText = "미분류"
  if (target.data !== null) {
    const tree = await getPartnerCategoryTree()
    if (!isCategorySelectable(tree, target.data)) {
      return {
        ok: false,
        message:
          "사용 중지된 분류(또는 상위 분류가 사용 중지된 분류)이거나 삭제된 분류입니다. 다른 분류를 선택해 주세요.",
      }
    }
    pathText = partnerCategoryPathText(tree, target.data)
  }

  const supabase = await createClient()
  const { data: changed, error } = await supabase.rpc("set_partner_category", {
    partner_ids: ids.data,
    target_category_id: target.data ?? undefined,
  })
  if (error) {
    return {
      ok: false,
      message: databaseErrorMessage(
        error,
        target.data === null
          ? "분류를 해제하지 못했습니다."
          : "분류를 적용하지 못했습니다."
      ),
    }
  }

  revalidatePartnerPages()
  const unchanged = ids.data.length - changed
  const rest = unchanged > 0 ? ` (${unchanged}개는 이미 그 분류입니다.)` : ""
  return {
    ok: true,
    changed,
    unchanged,
    message:
      target.data === null
        ? `거래처 ${changed}개의 분류를 해제했습니다. (미분류)${rest}`
        : `거래처 ${changed}개를 ‘${pathText}’ 분류로 옮겼습니다.${rest}`,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * 거래처분류 appear on every 거래처 page (목록 필터, 등록·수정 창,
 * 거래처분류설정), so refresh all pages under /partners. "(app)" is the
 * route group folder in src/app that these pages live in.
 */
function revalidatePartnerPages() {
  revalidatePath("/(app)/partners", "layout")
}

/**
 * The Korean message for a database error: the database's own message for
 * our rules (PARTNER_DB_RULES), otherwise `failedTo` + what to do.
 */
function databaseErrorMessage(error: PostgrestError, failedTo: string): string {
  if (isPartnerDbRule(error.hint)) return error.message
  if (error.code === "23505") {
    return "같은 위치에 이름이 같은 분류가 있습니다. 이름을 바꿔 주세요."
  }
  if (error.code === "23503") {
    return "다른 직원이 방금 분류나 거래처를 바꿨습니다. 창을 닫고 다시 열어 확인해 주세요."
  }
  if (error.code === "42501") {
    return `${failedTo} 권한이 없습니다. 다시 로그인해 주세요.`
  }
  console.error(`Partner category action failed (${failedTo}):`, error)
  return `${failedTo} 잠시 후 다시 시도해 주세요.`
}
