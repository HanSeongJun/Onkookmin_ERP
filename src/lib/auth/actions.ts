"use server"

import {
  isAuthRetryableFetchError,
  type AuthError,
} from "@supabase/supabase-js"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

/** What the login form gets back after a failed attempt. */
export type SignInState = {
  /** Korean error message shown on the form. */
  error?: string
  /** The email that was typed, so the form can keep showing it. */
  email?: string
}

const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { error: "이메일을 입력해 주세요." })
    .pipe(z.email({ error: "이메일 형식이 올바르지 않습니다." })),
  password: z.string().min(1, { error: "비밀번호를 입력해 주세요." }),
})

/**
 * Signs an employee in with email and password.
 * Used by the login form through React's useActionState.
 */
export async function signIn(
  _prevState: SignInState,
  formData: FormData
): Promise<SignInState> {
  const typedEmail = String(formData.get("email") ?? "")

  const parsed = signInSchema.safeParse({
    email: typedEmail,
    password: String(formData.get("password") ?? ""),
  })
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "입력한 내용을 확인해 주세요.",
      email: typedEmail,
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)
  if (error) {
    return { error: getSignInErrorMessage(error), email: parsed.data.email }
  }

  // Go back to the page the user originally wanted, or to the dashboard.
  redirect(getSafeRedirectPath(await getRequestedNextPath(formData)))
}

/**
 * Signs the current user out on this device and goes to the login page.
 */
export async function signOut(): Promise<void> {
  const supabase = await createClient()

  // scope "local": sign out only this browser. The employee stays signed in
  // on their other devices (Supabase's default would sign out everywhere).
  const { error } = await supabase.auth.signOut({ scope: "local" })

  if (error) {
    // For example Supabase could not be reached, so the login cookies may
    // still be there. Delete them ourselves so that signing out always works,
    // even on a shared office PC. (Supabase cookie names start with "sb-".)
    console.error("Supabase sign-out failed; clearing cookies directly:", error)
    const cookieStore = await cookies()
    cookieStore
      .getAll()
      .filter((cookie) => cookie.name.startsWith("sb-"))
      .forEach((cookie) => cookieStore.delete(cookie.name))
  }

  redirect("/login")
}

/** Turns a Supabase login error into a friendly Korean message. */
function getSignInErrorMessage(error: AuthError): string {
  switch (error.code) {
    case "invalid_credentials":
      return "이메일 또는 비밀번호가 올바르지 않습니다."
    case "email_not_confirmed":
      return "아직 인증되지 않은 계정입니다. 관리자에게 문의하세요."
    case "user_banned":
      return "사용이 중지된 계정입니다. 관리자에게 문의하세요."
    case "over_request_rate_limit":
      return "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요."
  }

  if (isAuthRetryableFetchError(error)) {
    return "로그인 서버에 연결할 수 없습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
  }

  console.error("Unexpected Supabase sign-in error:", error)
  return "로그인 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요."
}

/**
 * The page the user wanted before being sent to the login page
 * (the `next` in /login?next=/products), or null.
 *
 * The login form normally sends it in a hidden field. If the form is sent
 * before the page has fully loaded, that field is missing, so we read it from
 * the address of the login page itself (the browser's Referer header).
 * Either way the value is untrusted: getSafeRedirectPath checks it.
 */
async function getRequestedNextPath(
  formData: FormData
): Promise<FormDataEntryValue | null> {
  const fromForm = formData.get("next")
  if (fromForm) {
    return fromForm
  }

  const referer = (await headers()).get("referer")
  if (!referer) {
    return null
  }

  try {
    return new URL(referer).searchParams.get("next")
  } catch {
    // Not a valid address.
    return null
  }
}

/**
 * Returns `value` only if it is a page inside this app (like "/products?page=2").
 * Anything else falls back to "/" (the dashboard).
 *
 * This stops a crafted link such as /login?next=https://evil.com or
 * /login?next=//evil.com from sending users to another website after login.
 */
function getSafeRedirectPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith("/")) {
    return "/"
  }

  try {
    // Resolve the path against a placeholder origin and make sure it stays there.
    // This also catches tricks like "/\evil.com" that browsers treat as "//evil.com".
    const placeholderOrigin = "http://localhost"
    const url = new URL(value, placeholderOrigin)
    if (url.origin !== placeholderOrigin || url.pathname.startsWith("//")) {
      return "/"
    }
    return url.pathname + url.search + url.hash
  } catch {
    return "/"
  }
}
