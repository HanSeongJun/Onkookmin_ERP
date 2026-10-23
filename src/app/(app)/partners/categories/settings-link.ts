// Plain constants (no "use client"), so the server page can read them too.

import { PARTNER_CATEGORIES_PATH } from "@/lib/partners/schema"

/**
 * URL param that opens the 분류값 설정 window as soon as the
 * 거래처분류설정 screen loads (used by the [분류값 설정] links of other
 * screens, which open it in a new tab so their unsaved form stays).
 */
export const PARTNER_CATEGORY_SETTINGS_PARAM = "settings"

/** 거래처분류설정 with its 분류값 설정 window open. */
export const PARTNER_CATEGORY_SETTINGS_HREF = `${PARTNER_CATEGORIES_PATH}?${PARTNER_CATEGORY_SETTINGS_PARAM}=1`
