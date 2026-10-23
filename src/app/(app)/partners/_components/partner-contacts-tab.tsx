"use client"

import { PlusIcon } from "lucide-react"
import { flushSync } from "react-dom"
import { useFieldArray, useWatch } from "react-hook-form"

import { ActionButton } from "@/components/erp/action-bar"
import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridCheckbox,
  DataGridEmpty,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { FormSection } from "@/components/erp/form-table"
import { formatNumber } from "@/lib/format"
import { PARTNER_LIMITS } from "@/lib/partners/constants"
import {
  emptyPartnerContactInput,
  type PartnerContactInput,
} from "@/lib/partners/schema"

import {
  CONTACT_FIELD_ORDER,
  listErrorMessage,
  rowErrorMessage,
} from "./form-errors"
import type { PartnerErrors, PartnerFormApi } from "./partner-form-fields"
import {
  PhoneCell,
  RemoveCell,
  RowErrorList,
  TextCell,
  type RowError,
} from "./row-table"

/** Id of [담당자 추가] (focused for a message about the whole list). */
export const CONTACTS_ADD_ID = "partner-contacts-add"
const CONTACTS_ERROR_ID = "partner-contacts-error"

const COLUMN_TITLES: Record<keyof PartnerContactInput, string> = {
  id: "담당자",
  isPrimary: "대표",
  name: "이름",
  jobTitle: "부서/직책",
  mobile: "휴대폰",
  phone: "전화",
  email: "이메일",
  memo: "메모",
}

/**
 * 담당자정보: the partner's contact people as an editable table (이름*,
 * 부서/직책, 휴대폰, 전화, 이메일, 메모), with [담당자 추가] and a [삭제]
 * per row. At most one 대표 담당자 (checking one unchecks the others; none
 * is fine). Saved rows keep their id; the whole list is saved with the
 * partner.
 */
export function PartnerContactsTab({
  form,
  errors,
}: {
  form: PartnerFormApi
  errors: PartnerErrors
}) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "contacts",
    // The rows have their own "id" (the saved row's id).
    keyName: "fieldKey",
  })
  const contacts = useWatch({ control: form.control, name: "contacts" })
  const full = fields.length >= PARTNER_LIMITS.contactsMax
  const listMessage = listErrorMessage(errors.contacts)

  const rowErrors: RowError[] = []
  fields.forEach((_, index) => {
    for (const field of CONTACT_FIELD_ORDER) {
      const message = rowErrorMessage(errors.contacts, index, field)
      if (message) {
        rowErrors.push({
          path: `contacts.${index}.${field}`,
          text: `${index + 1}번 담당자 · ${COLUMN_TITLES[field]}: ${message}`,
        })
      }
    }
  })
  const errorOf = (index: number, field: keyof PartnerContactInput) =>
    rowErrorMessage(errors.contacts, index, field)

  function add() {
    if (full) return
    append(emptyPartnerContactInput(), {
      focusName: `contacts.${fields.length}.name`,
    })
  }

  function removeRow(index: number) {
    flushSync(() => remove(index))
    const left = form.getValues("contacts").length
    // The row below took this place; after the last row, the one above.
    if (left > 0) {
      form.setFocus(`contacts.${Math.min(index, left - 1)}.name`)
    } else {
      document.getElementById(CONTACTS_ADD_ID)?.focus()
    }
  }

  /** 대표 담당자: this row only (or none, when unchecked). */
  function setPrimary(index: number, checked: boolean) {
    form.getValues("contacts").forEach((contact, rowIndex) => {
      const next = checked && rowIndex === index
      if (contact.isPrimary !== next) {
        form.setValue(`contacts.${rowIndex}.isPrimary`, next, {
          shouldDirty: true,
        })
      }
    })
    // "대표 담당자는 1명만…" no longer applies.
    if (form.formState.isSubmitted) void form.trigger("contacts")
  }

  return (
    <FormSection
      title="담당자정보"
      description={`발주·정산 등 연락할 사람을 등록합니다. 대표 담당자는 1명만 정할 수 있습니다. (최대 ${PARTNER_LIMITS.contactsMax}명)`}
      actions={
        <ActionButton
          id={CONTACTS_ADD_ID}
          size="sm"
          disabled={full}
          aria-describedby={listMessage ? CONTACTS_ERROR_ID : undefined}
          onClick={add}
        >
          <PlusIcon aria-hidden="true" />
          담당자 추가
        </ActionButton>
      }
    >
      <DataGrid
        aria-label="담당자 목록"
        containerClassName="max-h-[min(60svh,34rem)]"
        className={fields.length > 0 ? "min-w-[64rem]" : undefined}
      >
        <DataGridHeader>
          <tr>
            <DataGridHead className="w-10">No</DataGridHead>
            <DataGridHead className="w-12">대표</DataGridHead>
            <DataGridHead className="w-36">
              <span
                aria-hidden="true"
                className="mr-1 inline-block size-1.5 -translate-y-0.5 rounded-full bg-required"
              />
              이름
            </DataGridHead>
            <DataGridHead className="w-36">부서/직책</DataGridHead>
            <DataGridHead className="w-36">휴대폰</DataGridHead>
            <DataGridHead className="w-36">전화</DataGridHead>
            <DataGridHead className="w-52">이메일</DataGridHead>
            <DataGridHead>메모</DataGridHead>
            <DataGridHead className="w-12">삭제</DataGridHead>
          </tr>
        </DataGridHeader>
        <DataGridBody>
          {fields.length === 0 && (
            <DataGridEmpty colSpan={9}>
              등록된 담당자가 없습니다. [담당자 추가]를 눌러 추가해 주세요.
            </DataGridEmpty>
          )}
          {fields.map((row, index) => {
            const number = index + 1
            const isPrimary = contacts[index]?.isPrimary ?? false
            return (
              <DataGridRow key={row.fieldKey} selected={isPrimary}>
                <DataGridCell align="center" className="tabular-nums">
                  {number}
                </DataGridCell>
                <DataGridCell align="center" className="px-0">
                  <DataGridCheckbox
                    aria-label={`${number}번 담당자를 대표 담당자로`}
                    checked={isPrimary}
                    onCheckedChange={(checked) => setPrimary(index, checked)}
                  />
                </DataGridCell>
                <TextCell
                  form={form}
                  path={`contacts.${index}.name`}
                  label={`${number}번 담당자 이름`}
                  required
                  error={errorOf(index, "name")}
                  maxLength={PARTNER_LIMITS.contactNameMaxLength}
                />
                <TextCell
                  form={form}
                  path={`contacts.${index}.jobTitle`}
                  label={`${number}번 담당자 부서/직책`}
                  error={errorOf(index, "jobTitle")}
                  maxLength={PARTNER_LIMITS.contactJobTitleMaxLength}
                  placeholder="예: 주방 실장"
                />
                <PhoneCell
                  form={form}
                  path={`contacts.${index}.mobile`}
                  label={`${number}번 담당자 휴대폰`}
                />
                <PhoneCell
                  form={form}
                  path={`contacts.${index}.phone`}
                  label={`${number}번 담당자 전화`}
                />
                <TextCell
                  form={form}
                  path={`contacts.${index}.email`}
                  label={`${number}번 담당자 이메일`}
                  type="email"
                  error={errorOf(index, "email")}
                  maxLength={PARTNER_LIMITS.emailMaxLength}
                />
                <TextCell
                  form={form}
                  path={`contacts.${index}.memo`}
                  label={`${number}번 담당자 메모`}
                  error={errorOf(index, "memo")}
                  maxLength={PARTNER_LIMITS.contactMemoMaxLength}
                />
                <RemoveCell
                  label={`${number}번 담당자 삭제`}
                  onRemove={() => removeRow(index)}
                />
              </DataGridRow>
            )
          })}
        </DataGridBody>
      </DataGrid>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <RowErrorList
          listId={CONTACTS_ERROR_ID}
          listMessage={listMessage}
          rowErrors={rowErrors}
        />
        <p className="ml-auto text-xs text-muted-foreground tabular-nums">
          {formatNumber(fields.length, 0)} / {PARTNER_LIMITS.contactsMax}명
          {full && " (더 추가할 수 없습니다)"}
        </p>
      </div>
    </FormSection>
  )
}
