"use client"

import { Trash2Icon } from "lucide-react"
import { Controller, type FieldPath } from "react-hook-form"

import { DataGridCell } from "@/components/erp/data-grid"
import { Input } from "@/components/ui/input"
import type { PartnerFormInput } from "@/lib/partners/schema"
import { cn } from "@/lib/utils"

import { PhoneInput } from "./formatted-input"
import {
  partnerErrorId,
  partnerFieldId,
  type PartnerFormApi,
} from "./partner-form-fields"

/**
 * Shared parts of the editable 담당자 / 배송지 tables: a text box cell, a
 * phone number cell, a [삭제] cell and the list of error messages under the
 * table. Each box's id is partnerFieldId(path) (e.g.
 * "partner-contacts-0-name"); its error message (in <RowErrorList>) has
 * partnerErrorId(path).
 */

type RowPath = FieldPath<PartnerFormInput>

const cellInputClass = "h-7 w-full rounded-sm px-1.5 text-[13px] md:text-[13px]"

/** A table cell with a text box registered under `path`. */
export function TextCell({
  form,
  path,
  label,
  error,
  required = false,
  maxLength,
  placeholder,
  type = "text",
  className,
}: {
  form: PartnerFormApi
  path: RowPath
  /** Screen-reader name, e.g. "1번 담당자 이름". */
  label: string
  error: string | undefined
  required?: boolean
  maxLength?: number
  placeholder?: string
  type?: "text" | "email"
  className?: string
}) {
  return (
    <DataGridCell className={cn("px-1 py-0.5", className)}>
      <Input
        id={partnerFieldId(path)}
        type={type}
        aria-label={label}
        aria-required={required || undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? partnerErrorId(path) : undefined}
        autoComplete="off"
        spellCheck={false}
        maxLength={maxLength}
        placeholder={placeholder}
        className={cellInputClass}
        {...form.register(path)}
      />
    </DataGridCell>
  )
}

/** A table cell with a phone number box (hyphens as you type). */
export function PhoneCell({
  form,
  path,
  label,
  className,
}: {
  form: PartnerFormApi
  path: RowPath
  label: string
  className?: string
}) {
  return (
    <DataGridCell className={cn("px-1 py-0.5", className)}>
      <Controller
        control={form.control}
        name={path}
        render={({ field, fieldState }) => (
          <PhoneInput
            id={partnerFieldId(path)}
            ref={field.ref}
            name={field.name}
            value={typeof field.value === "string" ? field.value : ""}
            onChange={field.onChange}
            onBlur={field.onBlur}
            aria-label={label}
            aria-invalid={fieldState.invalid}
            aria-describedby={
              fieldState.invalid ? partnerErrorId(path) : undefined
            }
            placeholder=""
            className={cellInputClass}
          />
        )}
      />
    </DataGridCell>
  )
}

/** The [삭제] cell of a row (an icon button). */
export function RemoveCell({
  label,
  onRemove,
}: {
  /** e.g. "1번 담당자 삭제". */
  label: string
  onRemove: () => void
}) {
  return (
    <DataGridCell align="center" className="px-1">
      <button
        type="button"
        aria-label={label}
        title="삭제"
        onClick={onRemove}
        className="inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Trash2Icon aria-hidden="true" className="size-4" />
      </button>
    </DataGridCell>
  )
}

/** One message of <RowErrorList>. */
export type RowError = {
  /** The field's react-hook-form name, e.g. "contacts.0.name". */
  path: string
  /** e.g. "1번 담당자 · 이름: 담당자 이름을 입력해 주세요." */
  text: string
}

/**
 * The messages of the table (a whole-list message first, then one per
 * wrong box), shown in red under it. The boxes point at their message
 * (aria-describedby), so screen readers read it with the box.
 */
export function RowErrorList({
  listId,
  listMessage,
  rowErrors,
}: {
  /** Id of the whole-list message (the add button points at it). */
  listId: string
  listMessage: string | undefined
  rowErrors: RowError[]
}) {
  if (!listMessage && rowErrors.length === 0) return null
  return (
    <ul className="flex flex-col gap-0.5 text-xs font-bold text-destructive">
      {listMessage && <li id={listId}>{listMessage}</li>}
      {rowErrors.map((error) => (
        <li key={error.path} id={partnerErrorId(error.path)}>
          {error.text}
        </li>
      ))}
    </ul>
  )
}
