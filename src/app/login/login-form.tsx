"use client"

import { CircleAlertIcon, LoaderCircleIcon } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { Suspense, useActionState } from "react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { signIn, type SignInState } from "@/lib/auth/actions"

const initialState: SignInState = {}

/** Email + password form. The actual sign-in happens on the server (signIn). */
export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initialState)

  return (
    // noValidate: show our own Korean messages instead of the browser's popups.
    <form action={formAction} noValidate>
      {/* Reads ?next=... from the address bar, so it must sit inside <Suspense>. */}
      <Suspense fallback={null}>
        <NextPathInput />
      </Suspense>

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="email" className="font-bold">
            이메일
          </FieldLabel>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="name@example.com"
            defaultValue={state.email}
            className="h-9"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="password" className="font-bold">
            비밀번호
          </FieldLabel>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            className="h-9"
          />
        </Field>

        {state.error && (
          <Alert variant="destructive">
            <CircleAlertIcon />
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        )}

        <Field>
          <Button
            type="submit"
            size="lg"
            disabled={pending}
            className="h-10 font-bold hover:bg-brand-hover"
          >
            {pending && (
              <LoaderCircleIcon
                data-icon="inline-start"
                className="animate-spin"
              />
            )}
            {pending ? "로그인 중…" : "로그인"}
          </Button>
          <FieldDescription className="text-center">
            계정이 없으면 관리자에게 문의하세요.
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  )
}

/**
 * Hidden field that remembers the page the user wanted before being sent to
 * the login page (from /login?next=/products). The server checks this value
 * before redirecting, so only pages inside this app are allowed.
 */
function NextPathInput() {
  const searchParams = useSearchParams()

  return (
    <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />
  )
}
