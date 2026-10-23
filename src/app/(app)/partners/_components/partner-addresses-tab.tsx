"use client"

import { PlusIcon, SearchIcon } from "lucide-react"
import { flushSync } from "react-dom"
import { useFieldArray, useWatch } from "react-hook-form"

import { ActionButton } from "@/components/erp/action-bar"
import {
  DataGrid,
  DataGridBody,
  DataGridCell,
  DataGridEmpty,
  DataGridHead,
  DataGridHeader,
  DataGridRow,
} from "@/components/erp/data-grid"
import { FormSection } from "@/components/erp/form-table"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { formatNumber } from "@/lib/format"
import { PARTNER_LIMITS } from "@/lib/partners/constants"
import {
  emptyPartnerAddressInput,
  type PartnerAddressInput,
} from "@/lib/partners/schema"

import {
  ADDRESS_FIELD_ORDER,
  listErrorMessage,
  rowErrorMessage,
} from "./form-errors"
import {
  partnerErrorId,
  partnerFieldId,
  type PartnerErrors,
  type PartnerFormApi,
} from "./partner-form-fields"
import {
  PhoneCell,
  RemoveCell,
  RowErrorList,
  TextCell,
  type RowError,
} from "./row-table"

/** Id of [배송지 추가] (focused for a message about the whole list). */
export const ADDRESSES_ADD_ID = "partner-addresses-add"
const ADDRESSES_ERROR_ID = "partner-addresses-error"

const COLUMN_TITLES: Record<keyof PartnerAddressInput, string> = {
  id: "배송지",
  isDefault: "기본",
  label: "배송지명",
  postalCode: "우편번호",
  address: "주소",
  addressDetail: "상세주소",
  recipient: "받는 분",
  phone: "연락처",
  memo: "배송 메모",
}

/** Id of a 배송지 row's 상세주소 box (focused after an address search). */
export function addressDetailInputId(index: number): string {
  return partnerFieldId(`addresses.${index}.addressDetail`)
}

/**
 * 배송지: where goods are delivered, as an editable table (배송지명*,
 * 우편번호 + [검색], 주소*, 상세주소, 받는 분, 연락처, 배송 메모), with
 * [배송지 추가] and a [삭제] per row. When there are any, exactly one is
 * the 기본 배송지 (the radio button in front): the first one added becomes
 * it, and when it is deleted the first remaining one takes over. The list
 * screen shows the 기본 배송지.
 */
export function PartnerAddressesTab({
  form,
  errors,
  onSearchAddress,
}: {
  form: PartnerFormApi
  errors: PartnerErrors
  /** Opens the 주소 검색 for this row. */
  onSearchAddress: (index: number) => void
}) {
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "addresses",
    // The rows have their own "id" (the saved row's id).
    keyName: "fieldKey",
  })
  const addresses = useWatch({ control: form.control, name: "addresses" })
  const full = fields.length >= PARTNER_LIMITS.addressesMax
  const listMessage = listErrorMessage(errors.addresses)

  const rowErrors: RowError[] = []
  fields.forEach((_, index) => {
    for (const field of ADDRESS_FIELD_ORDER) {
      const message = rowErrorMessage(errors.addresses, index, field)
      if (message) {
        rowErrors.push({
          path: `addresses.${index}.${field}`,
          text: `${index + 1}번 배송지 · ${COLUMN_TITLES[field]}: ${message}`,
        })
      }
    }
  })
  const errorOf = (index: number, field: keyof PartnerAddressInput) =>
    rowErrorMessage(errors.addresses, index, field)

  function add() {
    if (full) return
    const current = form.getValues("addresses")
    // The first 배송지 becomes the 기본 배송지 by itself.
    const isDefault = !current.some((address) => address.isDefault)
    append(emptyPartnerAddressInput(isDefault), {
      focusName: `addresses.${current.length}.label`,
    })
  }

  /** Makes this row the 기본 배송지 (and no other). */
  function makeDefault(index: number) {
    form.getValues("addresses").forEach((address, rowIndex) => {
      const next = rowIndex === index
      if (address.isDefault !== next) {
        form.setValue(`addresses.${rowIndex}.isDefault`, next, {
          shouldDirty: true,
        })
      }
    })
    if (form.formState.isSubmitted) void form.trigger("addresses")
  }

  function removeRow(index: number) {
    const wasDefault = form.getValues(`addresses.${index}.isDefault`)
    flushSync(() => remove(index))
    const left = form.getValues("addresses")
    // The 기본 배송지 was deleted: the first remaining one takes over.
    if (wasDefault && left.length > 0 && !left.some((row) => row.isDefault)) {
      form.setValue("addresses.0.isDefault", true, { shouldDirty: true })
    }
    if (left.length > 0) {
      form.setFocus(`addresses.${Math.min(index, left.length - 1)}.label`)
    } else {
      document.getElementById(ADDRESSES_ADD_ID)?.focus()
    }
  }

  return (
    <FormSection
      title="배송지"
      description={`상품을 받는 곳입니다. 목록에는 기본 배송지가 보입니다. 첫 배송지는 자동으로 기본 배송지가 됩니다. (최대 ${PARTNER_LIMITS.addressesMax}곳)`}
      actions={
        <ActionButton
          id={ADDRESSES_ADD_ID}
          size="sm"
          disabled={full}
          aria-describedby={listMessage ? ADDRESSES_ERROR_ID : undefined}
          onClick={add}
        >
          <PlusIcon aria-hidden="true" />
          배송지 추가
        </ActionButton>
      }
    >
      <DataGrid
        aria-label="배송지 목록"
        containerClassName="max-h-[min(60svh,34rem)]"
        className={fields.length > 0 ? "min-w-[80rem]" : undefined}
      >
        <DataGridHeader>
          <tr>
            <DataGridHead className="w-10">No</DataGridHead>
            <DataGridHead className="w-12">기본</DataGridHead>
            <DataGridHead className="w-32">
              <RequiredMark />
              배송지명
            </DataGridHead>
            <DataGridHead className="w-36">우편번호</DataGridHead>
            <DataGridHead className="min-w-64">
              <RequiredMark />
              주소
            </DataGridHead>
            <DataGridHead className="w-44">상세주소</DataGridHead>
            <DataGridHead className="w-24">받는 분</DataGridHead>
            <DataGridHead className="w-36">연락처</DataGridHead>
            <DataGridHead className="w-48">배송 메모</DataGridHead>
            <DataGridHead className="w-12">삭제</DataGridHead>
          </tr>
        </DataGridHeader>
        <DataGridBody>
          {fields.length === 0 && (
            <DataGridEmpty colSpan={10}>
              등록된 배송지가 없습니다. [배송지 추가]를 눌러 추가해 주세요.
            </DataGridEmpty>
          )}
          {fields.map((row, index) => {
            const number = index + 1
            const isDefault = addresses[index]?.isDefault ?? false
            const postalPath = `addresses.${index}.postalCode` as const
            const postalError = errorOf(index, "postalCode")
            return (
              <DataGridRow key={row.fieldKey} selected={isDefault}>
                <DataGridCell align="center" className="tabular-nums">
                  {number}
                </DataGridCell>
                <DataGridCell align="center" className="px-0">
                  {/* One radio per row (a group around the whole table would
                      take the arrow keys from the text boxes). */}
                  <RadioGroup
                    aria-label={`${number}번 배송지`}
                    value={isDefault ? "default" : ""}
                    onValueChange={() => makeDefault(index)}
                    className="flex w-auto justify-center"
                  >
                    <RadioGroupItem
                      value="default"
                      aria-label={`${number}번 배송지를 기본 배송지로`}
                      title={isDefault ? "기본 배송지" : "기본 배송지로 지정"}
                    />
                  </RadioGroup>
                </DataGridCell>
                <TextCell
                  form={form}
                  path={`addresses.${index}.label`}
                  label={`${number}번 배송지명`}
                  required
                  error={errorOf(index, "label")}
                  maxLength={PARTNER_LIMITS.addressLabelMaxLength}
                  placeholder="예: 본점"
                />
                <DataGridCell className="px-1 py-0.5">
                  <span className="flex items-center gap-1">
                    <Input
                      id={partnerFieldId(postalPath)}
                      aria-label={`${number}번 배송지 우편번호`}
                      aria-invalid={Boolean(postalError)}
                      aria-describedby={
                        postalError ? partnerErrorId(postalPath) : undefined
                      }
                      inputMode="numeric"
                      autoComplete="off"
                      maxLength={5}
                      className="h-7 w-16 rounded-sm px-1.5 text-[13px] tabular-nums md:text-[13px]"
                      {...form.register(postalPath)}
                    />
                    <ActionButton
                      size="sm"
                      variant="secondary"
                      aria-label={`${number}번 배송지 주소 검색`}
                      title="주소 검색"
                      onClick={() => onSearchAddress(index)}
                    >
                      <SearchIcon aria-hidden="true" />
                      검색
                    </ActionButton>
                  </span>
                </DataGridCell>
                <TextCell
                  form={form}
                  path={`addresses.${index}.address`}
                  label={`${number}번 배송지 주소`}
                  required
                  error={errorOf(index, "address")}
                  maxLength={PARTNER_LIMITS.addressMaxLength}
                  placeholder="주소 검색 또는 직접 입력"
                />
                <TextCell
                  form={form}
                  path={`addresses.${index}.addressDetail`}
                  label={`${number}번 배송지 상세주소`}
                  error={errorOf(index, "addressDetail")}
                  maxLength={PARTNER_LIMITS.addressDetailMaxLength}
                  placeholder="동·호수 등"
                />
                <TextCell
                  form={form}
                  path={`addresses.${index}.recipient`}
                  label={`${number}번 배송지 받는 분`}
                  error={errorOf(index, "recipient")}
                  maxLength={PARTNER_LIMITS.recipientMaxLength}
                />
                <PhoneCell
                  form={form}
                  path={`addresses.${index}.phone`}
                  label={`${number}번 배송지 연락처`}
                />
                <TextCell
                  form={form}
                  path={`addresses.${index}.memo`}
                  label={`${number}번 배송 메모`}
                  error={errorOf(index, "memo")}
                  maxLength={PARTNER_LIMITS.deliveryMemoMaxLength}
                  placeholder="예: 오전 10시 전, 뒷문"
                />
                <RemoveCell
                  label={`${number}번 배송지 삭제`}
                  onRemove={() => removeRow(index)}
                />
              </DataGridRow>
            )
          })}
        </DataGridBody>
      </DataGrid>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <RowErrorList
          listId={ADDRESSES_ERROR_ID}
          listMessage={listMessage}
          rowErrors={rowErrors}
        />
        <p className="ml-auto text-xs text-muted-foreground tabular-nums">
          {formatNumber(fields.length, 0)} / {PARTNER_LIMITS.addressesMax}곳
          {full && " (더 추가할 수 없습니다)"}
        </p>
      </div>
    </FormSection>
  )
}

/** The small red dot of a required column title. */
function RequiredMark() {
  return (
    <span
      aria-hidden="true"
      className="mr-1 inline-block size-1.5 -translate-y-0.5 rounded-full bg-required"
    />
  )
}
