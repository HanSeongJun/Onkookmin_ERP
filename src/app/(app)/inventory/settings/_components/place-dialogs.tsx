"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { LoaderCircleIcon, SearchIcon } from "lucide-react"
import { useEffect, useState, useTransition } from "react"
import { Controller, useForm, useWatch, type FieldPath } from "react-hook-form"
import { toast } from "sonner"

import {
  AddressSearchDialog,
  type AddressSearchResult,
} from "@/components/address-search-dialog"
import { ActionButton } from "@/components/erp/action-bar"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { FormRow, FormTable } from "@/components/erp/form-table"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useHotkeys } from "@/hooks/use-hotkeys"
import {
  createLocation,
  createWarehouse,
  createZone,
  updateLocation,
  updateWarehouse,
  updateZone,
  type StockPlaceResult,
} from "@/lib/inventory/actions"
import {
  DEFAULT_LOCATION_CODE,
  STOCK_PLACE_LIMITS,
} from "@/lib/inventory/constants"
import type {
  StockLocationNode,
  StockWarehouseNode,
  StockZoneNode,
} from "@/lib/inventory/queries"
import {
  emptyWarehouseFormInput,
  locationFormSchema,
  warehouseFormSchema,
  zoneFormSchema,
  type WarehouseFormInput,
  type WarehouseFormValues,
  type ZoneFormInput,
  type ZoneFormValues,
} from "@/lib/inventory/schema"
import { formatNumber } from "@/lib/format"
import { STORAGE_TYPES, storageTypeLabel } from "@/lib/products/constants"

import { callPlaceAction } from "./call-place-action"

const UNSAVED_MESSAGE = "저장하지 않은 내용은 사라집니다. 창을 닫을까요?"

/** Most 위치 one 위치 추가 makes at once. */
const LOCATIONS_AT_ONCE_MAX = 200

function SaveFooter({
  formId,
  pending,
  onCancel,
  label = "저장",
}: {
  formId: string
  pending: boolean
  onCancel: () => void
  label?: string
}) {
  return (
    <>
      <ActionButton variant="secondary" size="lg" onClick={onCancel}>
        취소
      </ActionButton>
      <ActionButton
        type="submit"
        form={formId}
        size="lg"
        keyHint="F8"
        disabled={pending}
      >
        {pending && (
          <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
        )}
        {pending ? "저장 중…" : label}
      </ActionButton>
    </>
  )
}

function ActiveSwitch({
  id,
  checked,
  onChange,
  offNote,
}: {
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  offNote: string
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id} className="text-[13px]">
        {checked ? "사용" : "사용중지"}
      </label>
      {!checked && (
        <span className="text-xs text-muted-foreground">{offNote}</span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------------------
// 창고
// ---------------------------------------------------------------------------

const WAREHOUSE_FORM_ID = "warehouse-form"

/**
 * 창고 추가 / 수정 dialog: 창고코드*, 창고명*, 주소 (우편번호 + 주소 from
 * the 주소 검색, 상세주소), 메모, 사용 여부. F8 = 저장. Mount it only while
 * open.
 */
export function WarehouseDialog({
  warehouse,
  onClose,
}: {
  /** null = 창고 추가. */
  warehouse: StockWarehouseNode | null
  onClose: () => void
}) {
  const [addressOpen, setAddressOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const form = useForm<WarehouseFormInput, unknown, WarehouseFormValues>({
    resolver: zodResolver(warehouseFormSchema),
    defaultValues: warehouse
      ? {
          code: warehouse.code,
          name: warehouse.name,
          postalCode: warehouse.postalCode ?? "",
          address: warehouse.address ?? "",
          addressDetail: warehouse.addressDetail ?? "",
          note: warehouse.note ?? "",
          isActive: warehouse.isActive,
        }
      : emptyWarehouseFormInput,
  })
  const {
    register,
    control,
    formState: { errors, isDirty },
  } = form

  useEffect(() => {
    form.setFocus("code")
  }, [form])

  function requestClose() {
    if (isPending) return
    if (isDirty && !window.confirm(UNSAVED_MESSAGE)) return
    onClose()
  }

  function applyAddress(result: AddressSearchResult) {
    const options = {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    }
    form.setValue("postalCode", result.postalCode, options)
    form.setValue("address", result.address, options)
    setTimeout(
      () => document.getElementById("warehouse-address-detail")?.focus(),
      0
    )
  }

  function save() {
    if (isPending) return
    void form.handleSubmit(() => {
      const input = form.getValues()
      startTransition(async () => {
        const result = await callPlaceAction<StockPlaceResult>(() =>
          warehouse
            ? updateWarehouse(warehouse.id, warehouse.updatedAt, input)
            : createWarehouse(input)
        )
        if (!result) return
        if (!result.ok) {
          for (const [path, message] of Object.entries(result.fieldErrors)) {
            form.setError(path as FieldPath<WarehouseFormInput>, {
              type: "server",
              message,
            })
          }
          toast.error(result.message)
          return
        }
        toast.success(
          warehouse
            ? "창고를 저장했습니다."
            : `창고 ‘${input.name.trim()}’을(를) 만들었습니다. 이제 구역을 추가해 주세요.`
        )
        onClose()
      })
    })()
  }

  useHotkeys({ F5: () => {}, F8: addressOpen ? undefined : save })

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
      title={warehouse ? `창고 수정 - ${warehouse.name}` : "창고 추가"}
      size="md"
      footer={
        <SaveFooter
          formId={WAREHOUSE_FORM_ID}
          pending={isPending}
          onCancel={requestClose}
        />
      }
    >
      <form
        id={WAREHOUSE_FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <FormTable>
          <FormRow
            label="창고코드"
            htmlFor="warehouse-code"
            required
            error={errors.code?.message}
            errorId="warehouse-code-error"
            hint={`${STOCK_PLACE_LIMITS.warehouseCodeMaxLength}자 이내, 예: W01`}
          >
            <Input
              id="warehouse-code"
              maxLength={STOCK_PLACE_LIMITS.warehouseCodeMaxLength}
              autoComplete="off"
              aria-required
              aria-invalid={!!errors.code}
              aria-describedby={
                errors.code ? "warehouse-code-error" : undefined
              }
              className="h-8 w-40 rounded-sm"
              {...register("code")}
            />
          </FormRow>
          <FormRow
            label="창고명"
            htmlFor="warehouse-name"
            required
            error={errors.name?.message}
            errorId="warehouse-name-error"
          >
            <Input
              id="warehouse-name"
              maxLength={STOCK_PLACE_LIMITS.nameMaxLength}
              autoComplete="off"
              placeholder="예: 본사 물류센터"
              aria-required
              aria-invalid={!!errors.name}
              aria-describedby={
                errors.name ? "warehouse-name-error" : undefined
              }
              className="h-8 rounded-sm"
              {...register("name")}
            />
          </FormRow>
          <FormRow
            label="주소"
            htmlFor="warehouse-address"
            error={
              errors.address?.message ??
              errors.postalCode?.message ??
              errors.addressDetail?.message
            }
            errorId="warehouse-address-error"
          >
            <div className="flex w-full flex-col gap-1">
              <div className="flex gap-1">
                <Input
                  aria-label="우편번호"
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="우편번호"
                  aria-invalid={!!errors.postalCode}
                  className="h-8 w-24 rounded-sm"
                  {...register("postalCode")}
                />
                <ActionButton
                  variant="secondary"
                  size="sm"
                  className="h-8"
                  onClick={() => setAddressOpen(true)}
                >
                  <SearchIcon aria-hidden="true" />
                  주소 검색
                </ActionButton>
              </div>
              <Input
                id="warehouse-address"
                maxLength={STOCK_PLACE_LIMITS.addressMaxLength}
                placeholder="주소"
                aria-invalid={!!errors.address}
                aria-describedby={
                  errors.address ? "warehouse-address-error" : undefined
                }
                className="h-8 rounded-sm"
                {...register("address")}
              />
              <Input
                id="warehouse-address-detail"
                aria-label="상세주소"
                maxLength={STOCK_PLACE_LIMITS.addressDetailMaxLength}
                placeholder="상세주소"
                aria-invalid={!!errors.addressDetail}
                className="h-8 rounded-sm"
                {...register("addressDetail")}
              />
            </div>
          </FormRow>
          <FormRow
            label="메모"
            htmlFor="warehouse-note"
            error={errors.note?.message}
            errorId="warehouse-note-error"
          >
            <Textarea
              id="warehouse-note"
              maxLength={STOCK_PLACE_LIMITS.noteMaxLength}
              rows={2}
              className="min-h-14 rounded-sm text-sm"
              {...register("note")}
            />
          </FormRow>
          <FormRow label="사용 여부">
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <ActiveSwitch
                  id="warehouse-active"
                  checked={field.value}
                  onChange={field.onChange}
                  offNote="새 재고를 넣을 수 없습니다 (있는 재고는 그대로)"
                />
              )}
            />
          </FormRow>
        </FormTable>
        {addressOpen && (
          <AddressSearchDialog
            title="창고 주소 검색"
            query={form
              .getValues("address")
              .replace(/\s*\([^()]*\)\s*$/, "")
              .trim()}
            onSelect={applyAddress}
            onClose={() => setAddressOpen(false)}
          />
        )}
      </form>
    </ErpDialog>
  )
}

// ---------------------------------------------------------------------------
// 구역
// ---------------------------------------------------------------------------

const ZONE_FORM_ID = "zone-form"

/**
 * 구역 추가 / 수정 dialog: 창고 (fixed), 구역코드*, 구역명*, 보관온도*
 * (상온 / 냉장 / 냉동 — no default: the user must choose), 메모, 사용 여부.
 * A new 구역 gets its "기본" 위치 automatically.
 */
export function ZoneDialog({
  warehouse,
  zone,
  onClose,
}: {
  warehouse: StockWarehouseNode
  /** null = 구역 추가. */
  zone: StockZoneNode | null
  onClose: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const form = useForm<ZoneFormInput, unknown, ZoneFormValues>({
    resolver: zodResolver(zoneFormSchema),
    defaultValues: zone
      ? {
          warehouseId: warehouse.id,
          code: zone.code,
          name: zone.name,
          storageType: zone.storageType,
          note: zone.note ?? "",
          isActive: zone.isActive,
        }
      : {
          warehouseId: warehouse.id,
          code: "",
          name: "",
          note: "",
          isActive: true,
        },
  })
  const {
    register,
    control,
    formState: { errors, isDirty },
  } = form
  const storageType = useWatch({ control, name: "storageType" })

  useEffect(() => {
    form.setFocus("code")
  }, [form])

  function requestClose() {
    if (isPending) return
    if (isDirty && !window.confirm(UNSAVED_MESSAGE)) return
    onClose()
  }

  function save() {
    if (isPending) return
    void form.handleSubmit(() => {
      const input = form.getValues()
      startTransition(async () => {
        const result = await callPlaceAction<StockPlaceResult>(() =>
          zone ? updateZone(zone.id, zone.updatedAt, input) : createZone(input)
        )
        if (!result) return
        if (!result.ok) {
          for (const [path, message] of Object.entries(result.fieldErrors)) {
            form.setError(path as FieldPath<ZoneFormInput>, {
              type: "server",
              message,
            })
          }
          toast.error(result.message)
          return
        }
        toast.success(
          zone
            ? "구역을 저장했습니다."
            : `구역 ‘${input.name.trim()}’을(를) 만들었습니다. ‘${DEFAULT_LOCATION_CODE}’ 위치가 함께 생겼습니다.`
        )
        onClose()
      })
    })()
  }

  useHotkeys({ F5: () => {}, F8: save })

  const storageChangedWithStock =
    zone !== null && zone.stockRowCount > 0 && storageType !== zone.storageType

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
      title={
        zone ? `구역 수정 - ${zone.name}` : `구역 추가 - ${warehouse.name}`
      }
      size="md"
      footer={
        <SaveFooter
          formId={ZONE_FORM_ID}
          pending={isPending}
          onCancel={requestClose}
        />
      }
    >
      <form
        id={ZONE_FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <FormTable>
          <FormRow label="창고">
            <span className="font-bold">
              {warehouse.code} {warehouse.name}
            </span>
            {zone && (
              <span className="text-xs text-muted-foreground">
                (구역은 다른 창고로 옮길 수 없습니다)
              </span>
            )}
          </FormRow>
          <FormRow
            label="구역코드"
            htmlFor="zone-code"
            required
            error={errors.code?.message}
            errorId="zone-code-error"
            hint={`${STOCK_PLACE_LIMITS.zoneCodeMaxLength}자 이내, 예: A, COLD-1`}
          >
            <Input
              id="zone-code"
              maxLength={STOCK_PLACE_LIMITS.zoneCodeMaxLength}
              autoComplete="off"
              aria-required
              aria-invalid={!!errors.code}
              aria-describedby={errors.code ? "zone-code-error" : undefined}
              className="h-8 w-40 rounded-sm"
              {...register("code")}
            />
          </FormRow>
          <FormRow
            label="구역명"
            htmlFor="zone-name"
            required
            error={errors.name?.message}
            errorId="zone-name-error"
          >
            <Input
              id="zone-name"
              maxLength={STOCK_PLACE_LIMITS.nameMaxLength}
              autoComplete="off"
              placeholder="예: 냉장 B구역"
              aria-required
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "zone-name-error" : undefined}
              className="h-8 rounded-sm"
              {...register("name")}
            />
          </FormRow>
          <FormRow
            label="보관온도"
            required
            error={errors.storageType?.message}
            errorId="zone-storage-error"
          >
            <Controller
              control={control}
              name="storageType"
              render={({ field }) => (
                <RadioGroup
                  aria-label="보관온도"
                  aria-describedby={
                    errors.storageType ? "zone-storage-error" : undefined
                  }
                  value={field.value ?? ""}
                  onValueChange={(value) => field.onChange(value)}
                  className="flex w-auto flex-wrap gap-x-4 gap-y-1 py-1"
                >
                  {STORAGE_TYPES.map((type) => (
                    <label
                      key={type.value}
                      className="flex cursor-pointer items-center gap-1.5 text-[13px]"
                    >
                      <RadioGroupItem
                        value={type.value}
                        ref={field.value === type.value ? field.ref : undefined}
                      />
                      <span className="font-bold">{type.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {type.description}
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              )}
            />
            {storageChangedWithStock && (
              <p className="w-full text-xs font-bold text-destructive">
                이 구역에 재고 {formatNumber(zone.stockRowCount, 0)}줄이
                있습니다. 보관온도를 {storageTypeLabel(zone.storageType)}에서
                바꾸면 그 재고의 ‘보관온도 불일치’ 표시도 바뀝니다.
              </p>
            )}
          </FormRow>
          <FormRow
            label="메모"
            htmlFor="zone-note"
            error={errors.note?.message}
            errorId="zone-note-error"
          >
            <Textarea
              id="zone-note"
              maxLength={STOCK_PLACE_LIMITS.noteMaxLength}
              rows={2}
              className="min-h-14 rounded-sm text-sm"
              {...register("note")}
            />
          </FormRow>
          <FormRow label="사용 여부">
            <Controller
              control={control}
              name="isActive"
              render={({ field }) => (
                <ActiveSwitch
                  id="zone-active"
                  checked={field.value}
                  onChange={field.onChange}
                  offNote="이 구역의 위치에 새 재고를 넣을 수 없습니다"
                />
              )}
            />
          </FormRow>
        </FormTable>
      </form>
    </ErpDialog>
  )
}

// ---------------------------------------------------------------------------
// 위치 (선반)
// ---------------------------------------------------------------------------

const LOCATION_FORM_ID = "location-form"

/** The codes typed in the 위치코드 box (lines or commas), each once. */
function splitCodes(text: string): string[] {
  const seen = new Set<string>()
  const codes: string[] = []
  for (const part of text.split(/[\n,]+/)) {
    const code = part.normalize("NFC").trim()
    if (!code || seen.has(code.toLowerCase())) continue
    seen.add(code.toLowerCase())
    codes.push(code)
  }
  return codes
}

/**
 * Codes for a 범위로 만들기: prefix + numbers from..to with `digits`
 * digits, e.g. ("B-02-R", 1, 3, 2) → B-02-R01, B-02-R02, B-02-R03.
 */
function rangeCodes(prefix: string, from: number, to: number, digits: number) {
  const codes: string[] = []
  for (
    let number = from;
    number <= to && codes.length <= LOCATIONS_AT_ONCE_MAX;
    number++
  ) {
    codes.push(`${prefix}${String(number).padStart(digits, "0")}`)
  }
  return codes
}

/**
 * 위치 추가 / 수정 dialog. 추가: one or many 위치코드 at once (one per line
 * or separated by commas; [범위로 만들기] writes e.g. B-02-R01 … R10),
 * each made in turn — the ones that could not be made stay in the box
 * with the reason. 수정: 위치코드, 위치 이름, 사용 여부 (a 위치 never moves
 * to another 구역; the 구역's 기본 위치 keeps its mark).
 */
export function LocationDialog({
  warehouse,
  zone,
  location,
  onClose,
}: {
  warehouse: StockWarehouseNode
  zone: StockZoneNode
  /** null = 위치 추가. */
  location: StockLocationNode | null
  onClose: () => void
}) {
  const [codesText, setCodesText] = useState(location?.code ?? "")
  const [name, setName] = useState(location?.name ?? "")
  const [isActive, setIsActive] = useState(location?.isActive ?? true)
  const [errors, setErrors] = useState<{
    code?: string
    name?: string
    list?: string[]
  }>({})
  const [range, setRange] = useState({
    prefix: "",
    from: "1",
    to: "10",
    digits: "2",
  })
  const [isPending, startTransition] = useTransition()
  const isDirty =
    codesText !== (location?.code ?? "") ||
    name !== (location?.name ?? "") ||
    isActive !== (location?.isActive ?? true)
  const codes = location ? [codesText.trim()] : splitCodes(codesText)
  const single = location !== null || codes.length <= 1

  useEffect(() => {
    document.getElementById("location-codes")?.focus()
  }, [])

  function requestClose() {
    if (isPending) return
    if (isDirty && !window.confirm(UNSAVED_MESSAGE)) return
    onClose()
  }

  function fillRange() {
    const from = Number(range.from)
    const to = Number(range.to)
    const digits = Number(range.digits)
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      !Number.isInteger(digits) ||
      from < 0 ||
      to < from ||
      digits < 1 ||
      digits > 6
    ) {
      toast.error("범위를 확인해 주세요. (시작 ≤ 끝, 자릿수 1~6)")
      return
    }
    const made = rangeCodes(range.prefix.trim(), from, to, digits)
    if (made.length > LOCATIONS_AT_ONCE_MAX) {
      toast.error(`한 번에 ${LOCATIONS_AT_ONCE_MAX}개까지 만들 수 있습니다.`)
      return
    }
    const merged = splitCodes([codesText, ...made].join("\n"))
    setCodesText(merged.join("\n"))
    setErrors({})
  }

  function save() {
    if (isPending) return
    if (codes.length === 0 || codes[0] === "") {
      setErrors({ code: "위치코드를 입력해 주세요." })
      document.getElementById("location-codes")?.focus()
      return
    }
    if (codes.length > LOCATIONS_AT_ONCE_MAX) {
      setErrors({
        code: `한 번에 ${LOCATIONS_AT_ONCE_MAX}개까지 만들 수 있습니다.`,
      })
      return
    }
    // The same rules as the server, for every code first.
    const invalid: string[] = []
    for (const code of codes) {
      const parsed = locationFormSchema.safeParse({
        zoneId: zone.id,
        code,
        name: single ? name : "",
        isActive,
      })
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        if (issue?.path[0] === "name") {
          setErrors({ name: issue.message })
          return
        }
        invalid.push(`${code}: ${issue?.message ?? "확인해 주세요."}`)
      }
    }
    if (invalid.length > 0) {
      setErrors({ code: "위치코드를 확인해 주세요.", list: invalid })
      return
    }
    setErrors({})
    startTransition(async () => {
      if (location) {
        const result = await callPlaceAction<StockPlaceResult>(() =>
          updateLocation(location.id, location.updatedAt, {
            zoneId: zone.id,
            code: codes[0],
            name,
            isActive,
          })
        )
        if (!result) return
        if (!result.ok) {
          setErrors({
            code: result.fieldErrors.code,
            name: result.fieldErrors.name,
          })
          toast.error(result.message)
          return
        }
        toast.success("위치를 저장했습니다.")
        onClose()
        return
      }
      const failed: { code: string; message: string }[] = []
      let made = 0
      for (const code of codes) {
        const result = await callPlaceAction<StockPlaceResult>(() =>
          createLocation({
            zoneId: zone.id,
            code,
            name: single ? name : "",
            isActive,
          })
        )
        if (!result) {
          failed.push({ code, message: "연결 오류" })
          continue
        }
        if (!result.ok) {
          failed.push({
            code,
            message: result.fieldErrors.code ?? result.message,
          })
          continue
        }
        made++
      }
      if (failed.length === 0) {
        toast.success(`위치 ${formatNumber(made, 0)}개를 만들었습니다.`)
        onClose()
        return
      }
      if (made > 0)
        toast.success(`위치 ${formatNumber(made, 0)}개를 만들었습니다.`)
      toast.error(
        `위치 ${formatNumber(failed.length, 0)}개는 만들지 못했습니다.`
      )
      setCodesText(failed.map((item) => item.code).join("\n"))
      setErrors({
        code: "아래 위치코드는 만들지 못했습니다. 고쳐서 다시 저장해 주세요.",
        list: failed.map((item) => `${item.code}: ${item.message}`),
      })
    })
  }

  useHotkeys({ F5: () => {}, F8: save })

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
      title={
        location
          ? `위치 수정 - ${location.code}`
          : `위치 추가 - ${warehouse.name} > ${zone.name}`
      }
      size="md"
      footer={
        <SaveFooter
          formId={LOCATION_FORM_ID}
          pending={isPending}
          onCancel={requestClose}
          label={
            !location && codes.length > 1 ? `${codes.length}개 저장` : "저장"
          }
        />
      }
    >
      <form
        id={LOCATION_FORM_ID}
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
        className="flex flex-col gap-3"
      >
        <FormTable>
          <FormRow label="구역">
            <span>
              {warehouse.name} &gt;{" "}
              <span className="font-bold">{zone.name}</span>{" "}
              <span className="text-xs text-muted-foreground">
                ({storageTypeLabel(zone.storageType)})
              </span>
            </span>
          </FormRow>
          <FormRow
            label="위치코드"
            htmlFor="location-codes"
            required
            error={errors.code}
            errorId="location-codes-error"
            hint={
              location
                ? `${STOCK_PLACE_LIMITS.locationCodeMaxLength}자 이내`
                : "여러 개는 줄을 바꾸거나 쉼표로"
            }
          >
            {location ? (
              <Input
                id="location-codes"
                value={codesText}
                maxLength={STOCK_PLACE_LIMITS.locationCodeMaxLength}
                autoComplete="off"
                aria-required
                aria-invalid={!!errors.code}
                aria-describedby={
                  errors.code ? "location-codes-error" : undefined
                }
                onChange={(event) => setCodesText(event.target.value)}
                className="h-8 w-48 rounded-sm"
              />
            ) : (
              <Textarea
                id="location-codes"
                value={codesText}
                rows={4}
                placeholder={"예: B-02-R01\nB-02-R02"}
                aria-required
                aria-invalid={!!errors.code}
                aria-describedby={
                  errors.code ? "location-codes-error" : undefined
                }
                onChange={(event) => setCodesText(event.target.value)}
                className="min-h-20 rounded-sm font-mono text-sm"
              />
            )}
            {!location && codes.length > 1 && (
              <span className="text-xs text-muted-foreground">
                {formatNumber(codes.length, 0)}개
              </span>
            )}
          </FormRow>
          {!location && (
            <FormRow label="범위로 만들기">
              <span className="flex flex-wrap items-center gap-1 text-[13px]">
                <Input
                  aria-label="앞부분 (예: B-02-R)"
                  placeholder="앞부분 B-02-R"
                  value={range.prefix}
                  maxLength={STOCK_PLACE_LIMITS.locationCodeMaxLength - 1}
                  onChange={(event) =>
                    setRange({ ...range, prefix: event.target.value })
                  }
                  className="h-7 w-32 rounded-sm text-[13px]"
                />
                <Input
                  aria-label="시작 번호"
                  inputMode="numeric"
                  value={range.from}
                  onChange={(event) =>
                    setRange({ ...range, from: event.target.value })
                  }
                  className="h-7 w-14 rounded-sm text-right text-[13px]"
                />
                ~
                <Input
                  aria-label="끝 번호"
                  inputMode="numeric"
                  value={range.to}
                  onChange={(event) =>
                    setRange({ ...range, to: event.target.value })
                  }
                  className="h-7 w-14 rounded-sm text-right text-[13px]"
                />
                <Input
                  aria-label="번호 자릿수"
                  inputMode="numeric"
                  value={range.digits}
                  onChange={(event) =>
                    setRange({ ...range, digits: event.target.value })
                  }
                  className="h-7 w-10 rounded-sm text-right text-[13px]"
                />
                자리
                <ActionButton variant="neutral" size="sm" onClick={fillRange}>
                  목록에 넣기
                </ActionButton>
              </span>
            </FormRow>
          )}
          <FormRow
            label="위치 이름"
            htmlFor="location-name"
            error={errors.name}
            errorId="location-name-error"
            hint={single ? "선택" : "여러 개를 만들 때는 비워 둡니다"}
          >
            <Input
              id="location-name"
              value={single ? name : ""}
              disabled={!single}
              maxLength={STOCK_PLACE_LIMITS.nameMaxLength}
              autoComplete="off"
              placeholder="예: 2열 2단"
              aria-invalid={!!errors.name}
              onChange={(event) => setName(event.target.value)}
              className="h-8 rounded-sm"
            />
          </FormRow>
          <FormRow label="사용 여부">
            <ActiveSwitch
              id="location-active"
              checked={isActive}
              onChange={setIsActive}
              offNote="새 재고를 넣을 수 없습니다"
            />
          </FormRow>
        </FormTable>
        {errors.list && errors.list.length > 0 && (
          <ul
            role="alert"
            className="flex max-h-40 flex-col gap-0.5 overflow-y-auto border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs font-bold text-destructive"
          >
            {errors.list.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        {location?.isDefault && (
          <p className="text-xs text-muted-foreground">
            이 구역의 기본 위치입니다. 이름과 코드는 바꿀 수 있지만 삭제할 수는
            없습니다(기초재고 일괄등록에서 선반코드를 비운 줄이 여기로
            들어갑니다).
          </p>
        )}
      </form>
    </ErpDialog>
  )
}
