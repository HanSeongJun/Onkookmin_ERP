"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { LoaderCircleIcon } from "lucide-react"
import { unstable_rethrow } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import { flushSync } from "react-dom"
import { Controller, useForm, useWatch, type FieldPath } from "react-hook-form"
import { toast } from "sonner"

import {
  AddressSearchDialog,
  type AddressSearchResult,
} from "@/components/address-search-dialog"
import { ActionButton } from "@/components/erp/action-bar"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { ErpTabBar, ErpTabPanel } from "@/components/erp/erp-tabs"
import { PartnerCategoryPickerDialog } from "@/components/partner-category-picker-dialog"
import { RadioGroup } from "@/components/ui/radio-group"
import { Skeleton } from "@/components/ui/skeleton"
import { useHotkeys } from "@/hooks/use-hotkeys"
import {
  checkPartnerCode,
  createPartner,
  findPartnersWithBusinessNumber,
  loadPartnerForEdit,
  loadPartnerFormOptions,
  updatePartner,
  type PartnerActionResult,
} from "@/lib/partners/actions"
import {
  isValidBusinessNumber,
  toBusinessNumberDigits,
} from "@/lib/partners/business-number"
import { PARTNER_CODE_PATTERN } from "@/lib/partners/constants"
import type {
  PartnerDetail,
  SameBusinessNumberPartner,
} from "@/lib/partners/queries"
import {
  buildPartnerModalHref,
  emptyPartnerFormInput,
  PARTNER_FORM_TABS,
  partnerFieldTab,
  partnerFormSchema,
  partnerToFormInput,
  parsePartnerModal,
  type PartnerFormInput,
  type PartnerFormTab,
  type PartnerFormValues,
  type PartnerModalState,
} from "@/lib/partners/schema"
import { isUuid } from "@/lib/products/schema"

import { errorPaths, sortErrorPaths } from "./form-errors"
import {
  ADDRESSES_ADD_ID,
  addressDetailInputId,
  PartnerAddressesTab,
} from "./partner-addresses-tab"
import { CONTACTS_ADD_ID, PartnerContactsTab } from "./partner-contacts-tab"
import {
  BUSINESS_ADDRESS_DETAIL_ID,
  InlineRadio,
  PartnerBasicFields,
  PartnerBusinessFields,
  partnerFieldId,
  PartnerNoteFields,
  type PartnerFormApi,
  type PartnerFormOptions,
} from "./partner-form-fields"

const FORM_ID = "partner-form"
const TABS_ID = "partner-tabs"

/** Wait after the last key before checking 거래처코드 / 사업자번호 (ms). */
const CHECK_DELAY = 400

const UNSAVED_CHANGES_MESSAGE =
  "저장하지 않은 내용은 사라집니다. 창을 닫을까요?"

/** What happens while the partner (and the form's choices) are read. */
type LoadState =
  | { status: "loading" }
  | {
      status: "ready"
      /** 거래처 수정: the saved partner; null for 등록. */
      partner: PartnerDetail | null
      options: PartnerFormOptions
    }
  | { status: "missing" }
  | { status: "error" }

/** Where an address search puts its result. */
type AddressTarget = { kind: "business" } | { kind: "delivery"; index: number }

/** The answer of the 거래처코드 check, for the code it was asked for. */
type CodeCheck = {
  code: string
  status: "available" | "taken" | "invalid" | "unknown"
}

/**
 * 거래처 등록/수정 modal (the URL says which: ?modal=new or
 * ?modal=edit&id=…).
 *
 * - Tabs: 기본정보 (필수정보·기본정보 on the left, 추가정보 = 거래조건 on
 *   the right), 사업자정보, 담당자정보, 배송지, 특이사항. Hidden tabs keep
 *   their values. 사용 / 미사용 sits right of the tabs, like the reference
 *   screen.
 * - 거래처코드: a hint says whether the code is free (checked while
 *   typing); saving checks it again.
 * - 사업자등록번호: checked as you type (check digit); other partners with
 *   the same number are listed as a warning (saving is still allowed).
 * - Phone numbers get their hyphens as you type. Addresses come from the
 *   주소 검색 (Daum/Kakao 우편번호 service, inside this screen) or are
 *   typed by hand.
 * - The rules are checked in the browser and again on the server (same zod
 *   schema). On an error the first tab with an error opens, tabs with
 *   errors get a red dot, and the first wrong field gets the focus.
 * - F8 = 저장. Esc, × and [취소] close it, asking first when something was
 *   changed. F5 does nothing here (it must not reload and lose the form).
 * - 거래처 수정 reads the partner when it opens. If someone else saves it
 *   meanwhile, saving is refused (the server compares updated_at).
 * - When the modal is gone before a save finishes (e.g. the browser's back
 *   button), the result is only shown as a message.
 *
 * Mount it with a `key` per modal address, so every modal starts fresh.
 */
export function PartnerDialog({
  modal,
  onClose,
}: {
  modal: PartnerModalState
  /** Closes the modal (the parent removes it from the URL). */
  onClose: () => void
}) {
  const isEdit = modal.mode === "edit"
  const partnerId = modal.mode === "edit" ? modal.id : null

  const [tab, setTab] = useState<PartnerFormTab>("basic")
  const [load, setLoad] = useState<LoadState>(
    partnerId !== null && !isUuid(partnerId)
      ? { status: "missing" }
      : { status: "loading" }
  )
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [addressTarget, setAddressTarget] = useState<AddressTarget | null>(null)
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [isReloadingOptions, startReloadOptions] = useTransition()
  const [codeCheck, setCodeCheck] = useState<CodeCheck | null>(null)
  // Other partners per 사업자등록번호 (10 digits) already looked up.
  const [sameNumber, setSameNumber] = useState<
    ReadonlyMap<string, SameBusinessNumberPartner[]>
  >(() => new Map())
  const [isPending, startTransition] = useTransition()
  // Reading the partner and the choices.
  const [, startLoad] = useTransition()
  // Background checks (거래처코드, 사업자번호, choices read again).
  const [, startCheck] = useTransition()
  // Set while a save is being checked or sent, so F8 or a double click
  // cannot send the form twice.
  const submittingRef = useRef(false)
  // False once this modal is gone. (Set again on mount: React may run
  // effects twice in development.) See isStillShown.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  /**
   * Whether this modal is still the one the user is looking at. It may not
   * be after the browser's back button while a save was running: the save's
   * answer must then not close (or show errors in) the modal shown by then.
   * The address is checked too, because Next.js carries out a back
   * navigation only after a running Server Action has answered.
   */
  function isStillShown(): boolean {
    if (!mountedRef.current) return false
    const shown = parsePartnerModal(new URLSearchParams(window.location.search))
    return buildPartnerModalHref("", shown) === buildPartnerModalHref("", modal)
  }

  const form: PartnerFormApi = useForm<
    PartnerFormInput,
    unknown,
    PartnerFormValues
  >({
    resolver: zodResolver(partnerFormSchema),
    defaultValues: emptyPartnerFormInput,
    // The first wrong field may be on a hidden tab: focusPath() opens that
    // tab first, then focuses the field.
    shouldFocusError: false,
  })
  const {
    reset,
    formState: { errors, isDirty },
  } = form

  // Read the form's choices (거래처분류, 직원) and, for 거래처 수정, the
  // partner; then fill the form with it. In a transition, so a redirect
  // from the server (e.g. to the login page when the session has expired)
  // is carried out by Next.js.
  useEffect(() => {
    if (partnerId !== null && !isUuid(partnerId)) return
    let ignore = false
    startLoad(async () => {
      let partner: PartnerDetail | null
      let options: PartnerFormOptions
      try {
        ;[partner, options] = await Promise.all([
          partnerId === null ? null : loadPartnerForEdit(partnerId),
          loadPartnerFormOptions(),
        ])
      } catch (error) {
        if (ignore) return
        unstable_rethrow(error)
        console.error(error)
        setLoad({ status: "error" })
        return
      }
      if (ignore) return
      if (partnerId !== null && !partner) {
        setLoad({ status: "missing" })
        return
      }
      if (partner) {
        reset(partnerToFormInput(partner))
        const saved = partner.business_number
        if (saved) {
          setSameNumber(new Map([[saved, partner.sameBusinessNumberPartners]]))
        }
      }
      setLoad({ status: "ready", partner, options })
    })
    return () => {
      ignore = true
    }
  }, [partnerId, loadAttempt, reset])

  // Once the form is shown, start at 거래처코드 (unless the user already
  // moved the focus into the form).
  useEffect(() => {
    if (load.status !== "ready") return
    const active = document.activeElement
    if (document.getElementById(FORM_ID)?.contains(active)) return
    form.setFocus("code")
  }, [load.status, form])

  // Closing the tab or reloading the page with unsaved changes: the browser
  // asks first.
  useEffect(() => {
    if (!isDirty) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [isDirty])

  const partner = load.status === "ready" ? load.partner : null
  const canSave = load.status === "ready" && !isPending

  // ---- 거래처코드: is it free? ------------------------------------------------

  const codeValue = useWatch({ control: form.control, name: "code" }).trim()
  const savedCode = partner?.code ?? null
  const codeToCheck =
    load.status === "ready" &&
    PARTNER_CODE_PATTERN.test(codeValue) &&
    (savedCode === null || codeValue.toLowerCase() !== savedCode.toLowerCase())
      ? codeValue
      : null
  useEffect(() => {
    if (codeToCheck === null) return
    const timer = window.setTimeout(() => {
      startCheck(async () => {
        try {
          const status = await checkPartnerCode(codeToCheck, partnerId)
          setCodeCheck({ code: codeToCheck, status })
        } catch (error) {
          unstable_rethrow(error)
          console.error(error)
        }
      })
    }, CHECK_DELAY)
    return () => window.clearTimeout(timer)
  }, [codeToCheck, partnerId])

  let codeHint: React.ReactNode
  if (codeToCheck !== null && codeCheck?.code === codeToCheck) {
    if (codeCheck.status === "available") {
      codeHint = (
        <span className="font-bold text-brand">사용할 수 있는 코드입니다.</span>
      )
    } else if (codeCheck.status === "taken") {
      codeHint = (
        <span className="font-bold text-destructive">
          이미 사용 중인 거래처코드입니다.
        </span>
      )
    }
  }

  // ---- 사업자등록번호: other partners with the same number -------------------

  const businessDigits = toBusinessNumberDigits(
    useWatch({ control: form.control, name: "businessNumber" })
  )
  const businessValid = isValidBusinessNumber(businessDigits)
  const numberToLookUp =
    load.status === "ready" && businessValid && !sameNumber.has(businessDigits)
      ? businessDigits
      : null
  useEffect(() => {
    if (numberToLookUp === null) return
    const timer = window.setTimeout(() => {
      startCheck(async () => {
        try {
          const others = await findPartnersWithBusinessNumber(
            numberToLookUp,
            partnerId
          )
          setSameNumber((current) =>
            new Map(current).set(numberToLookUp, others)
          )
        } catch (error) {
          unstable_rethrow(error)
          console.error(error)
        }
      })
    }, CHECK_DELAY)
    return () => window.clearTimeout(timer)
  }, [numberToLookUp, partnerId])
  const sameNumberPartners = businessValid
    ? (sameNumber.get(businessDigits) ?? null)
    : null

  // ---- Choices read again (a select box opened) ----------------------------

  const reloadingRef = useRef(false)
  function reloadOptions() {
    if (reloadingRef.current) return
    reloadingRef.current = true
    startReloadOptions(async () => {
      try {
        const options = await loadPartnerFormOptions()
        setLoad((current) =>
          current.status === "ready" ? { ...current, options } : current
        )
      } catch (error) {
        unstable_rethrow(error)
        // Keep the choices read before; only log it.
        console.error(error)
      } finally {
        reloadingRef.current = false
      }
    })
  }

  // ---- Address search ---------------------------------------------------------

  function openAddressSearch(target: AddressTarget) {
    setAddressTarget(target)
  }

  /**
   * The address already in the target's box, searched for right away
   * (without a "(을지로2가)" 참고항목 at the end, which the search does not
   * need).
   */
  function addressQuery(target: AddressTarget): string {
    const address =
      target.kind === "business"
        ? form.getValues("address")
        : (form.getValues(`addresses.${target.index}.address`) ?? "")
    return address.replace(/\s*\([^()]*\)\s*$/, "").trim()
  }

  function applyAddress(target: AddressTarget, result: AddressSearchResult) {
    const options = {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    }
    if (target.kind === "business") {
      form.setValue("postalCode", result.postalCode, options)
      form.setValue("address", result.address, options)
    } else {
      form.setValue(
        `addresses.${target.index}.postalCode`,
        result.postalCode,
        options
      )
      form.setValue(
        `addresses.${target.index}.address`,
        result.address,
        options
      )
    }
    // Type the 상세주소 next (after the search has closed and given the
    // focus back to its button).
    const detailId =
      target.kind === "business"
        ? BUSINESS_ADDRESS_DETAIL_ID
        : addressDetailInputId(target.index)
    setTimeout(() => document.getElementById(detailId)?.focus(), 0)
  }

  // ---- Close and save ---------------------------------------------------------

  function requestClose() {
    if (isPending) return
    if (isDirty && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return
    onClose()
  }

  /** Opens the tab of a field and focuses it. */
  function focusPath(path: string) {
    flushSync(() => setTab(partnerFieldTab(path)))
    if (path === "contacts") {
      document.getElementById(CONTACTS_ADD_ID)?.focus()
    } else if (path === "addresses") {
      document.getElementById(ADDRESSES_ADD_ID)?.focus()
    } else {
      form.setFocus(path as FieldPath<PartnerFormInput>)
    }
  }

  /** Sends the form to the server and handles the answer. */
  async function send(input: PartnerFormInput) {
    let result: PartnerActionResult
    try {
      result =
        partner !== null
          ? await updatePartner(partner.id, partner.updated_at, input)
          : await createPartner(input)
    } catch (error) {
      submittingRef.current = false
      // A redirect from the server (e.g. to the login page when the session
      // has expired) is not an error: let Next.js carry it out.
      unstable_rethrow(error)
      console.error(error)
      toast.error(
        "저장하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
      )
      return
    }
    submittingRef.current = false

    const stillShown = isStillShown()

    if (!result.ok) {
      // The user left this modal meanwhile: only say what happened.
      if (!stillShown) {
        toast.error(result.message)
        return
      }
      const paths = Object.keys(result.fieldErrors)
      for (const [path, message] of Object.entries(result.fieldErrors)) {
        form.setError(path as FieldPath<PartnerFormInput>, {
          type: "server",
          message,
        })
      }
      const first = sortErrorPaths(paths)[0]
      if (first) focusPath(first)
      toast.error(result.message)
      return
    }

    toast.success(
      isEdit ? "변경 내용을 저장했습니다." : "거래처를 등록했습니다."
    )
    // Saved, but the user already left this modal (e.g. the browser's back
    // button): closing now would close the modal they went back to.
    if (stillShown) onClose()
  }

  function save() {
    if (!canSave || submittingRef.current) return
    submittingRef.current = true

    void form.handleSubmit(
      () => {
        // Send what the user typed: the server checks it again with the
        // same rules and never trusts the browser.
        const input = form.getValues()
        startTransition(async () => {
          await send(input)
        })
      },
      // Some fields are invalid: open their tab and focus the first one.
      (fieldErrors) => {
        submittingRef.current = false
        const first = errorPaths(fieldErrors)[0]
        if (first) focusPath(first)
        toast.error(
          "입력한 내용을 확인해 주세요. 빨간 글씨로 표시된 항목이 있습니다."
        )
      }
    )()
  }

  // F8 = 저장 (not while the address search is open on top). F5 is caught
  // so the browser does not reload the page and lose the form.
  useHotkeys({
    F5: () => {},
    F8: addressTarget || categoryPickerOpen ? undefined : save,
  })

  // ---- Tabs -------------------------------------------------------------------

  const tabErrors = new Set(
    errorPaths(errors).map((path) => partnerFieldTab(path))
  )
  const contactCount = useWatch({
    control: form.control,
    name: "contacts",
  }).length
  const addressCount = useWatch({
    control: form.control,
    name: "addresses",
  }).length
  const tabItems = PARTNER_FORM_TABS.map(({ value, label }) => {
    const count =
      value === "contacts"
        ? contactCount
        : value === "addresses"
          ? addressCount
          : null
    return {
      value,
      label: (
        <span className="flex items-center gap-1.5">
          {label}
          {count !== null && count > 0 && (
            <span className="text-xs tabular-nums">({count})</span>
          )}
          {tabErrors.has(value) && (
            <>
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-required"
              />
              <span className="sr-only">(입력 오류 있음)</span>
            </>
          )}
        </span>
      ),
      disabled: load.status !== "ready",
    }
  })

  const title = isEdit
    ? partner
      ? `거래처 수정 - ${partner.name}`
      : "거래처 수정"
    : "거래처 등록"

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
      title={title}
      tabs={
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <ErpTabBar
            idPrefix={TABS_ID}
            aria-label="거래처 정보"
            items={tabItems}
            value={tab}
            onValueChange={(value) => setTab(value as PartnerFormTab)}
            className="min-w-0"
          />
          {load.status === "ready" && <ActiveRadio form={form} />}
        </div>
      }
      footer={
        <>
          <ActionButton variant="secondary" size="lg" onClick={requestClose}>
            취소
          </ActionButton>
          <ActionButton
            type="submit"
            form={FORM_ID}
            size="lg"
            keyHint="F8"
            disabled={!canSave}
          >
            {isPending && (
              <LoaderCircleIcon aria-hidden="true" className="animate-spin" />
            )}
            {isPending ? "저장 중…" : "저장"}
          </ActionButton>
        </>
      }
    >
      {load.status === "loading" ? (
        <FormLoading />
      ) : load.status === "missing" ? (
        <DialogMessage
          title="거래처를 찾을 수 없습니다"
          description="주소가 잘못되었거나 등록되지 않은 거래처입니다. 창을 닫고 목록에서 다시 선택해 주세요."
        />
      ) : load.status === "error" ? (
        <DialogMessage
          title="거래처 정보를 불러오지 못했습니다"
          description="인터넷 연결을 확인한 뒤 다시 시도해 주세요."
        >
          <ActionButton
            variant="neutral"
            onClick={() => {
              setLoad({ status: "loading" })
              setLoadAttempt((attempt) => attempt + 1)
            }}
          >
            다시 시도
          </ActionButton>
        </DialogMessage>
      ) : (
        // noValidate: show our own Korean messages instead of the
        // browser's popups.
        <form
          id={FORM_ID}
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <ErpTabPanel idPrefix={TABS_ID} value="basic" selectedValue={tab}>
            <PartnerBasicFields
              form={form}
              errors={errors}
              options={load.options}
              saved={partner}
              codeHint={codeHint}
              onReloadOptions={reloadOptions}
              onOpenCategoryPicker={() => {
                setCategoryPickerOpen(true)
                reloadOptions()
              }}
              onManageAddresses={() => {
                flushSync(() => setTab("addresses"))
                const rows = form.getValues("addresses")
                const defaultIndex = Math.max(
                  rows.findIndex((row) => row.isDefault),
                  0
                )
                if (rows.length > 0) {
                  form.setFocus(`addresses.${defaultIndex}.label`)
                } else {
                  document.getElementById(ADDRESSES_ADD_ID)?.focus()
                }
              }}
            />
          </ErpTabPanel>
          <ErpTabPanel idPrefix={TABS_ID} value="business" selectedValue={tab}>
            <PartnerBusinessFields
              form={form}
              errors={errors}
              sameNumberPartners={sameNumberPartners}
              onSearchAddress={() => openAddressSearch({ kind: "business" })}
            />
          </ErpTabPanel>
          <ErpTabPanel idPrefix={TABS_ID} value="contacts" selectedValue={tab}>
            <PartnerContactsTab form={form} errors={errors} />
          </ErpTabPanel>
          <ErpTabPanel idPrefix={TABS_ID} value="addresses" selectedValue={tab}>
            <PartnerAddressesTab
              form={form}
              errors={errors}
              onSearchAddress={(index) =>
                openAddressSearch({ kind: "delivery", index })
              }
            />
          </ErpTabPanel>
          <ErpTabPanel idPrefix={TABS_ID} value="note" selectedValue={tab}>
            <PartnerNoteFields form={form} errors={errors} />
          </ErpTabPanel>

          {/* Inside the partner dialog, so Esc closes only the search. */}
          {addressTarget && (
            <AddressSearchDialog
              title={
                addressTarget.kind === "business"
                  ? "사업장 주소 검색"
                  : `${addressTarget.index + 1}번 배송지 주소 검색`
              }
              query={addressQuery(addressTarget)}
              onSelect={(result) => applyAddress(addressTarget, result)}
              onClose={() => setAddressTarget(null)}
            />
          )}
          {/* Inside the partner dialog, so Esc closes only the picker. */}
          <PartnerCategoryPickerDialog
            open={categoryPickerOpen}
            onOpenChange={setCategoryPickerOpen}
            categories={load.options.categories}
            value={form.getValues("categoryId") || null}
            keepCategoryId={partner?.category_id ?? null}
            purpose="assign"
            onConfirm={(category) =>
              form.setValue("categoryId", category.id, {
                shouldDirty: true,
                shouldValidate: form.formState.isSubmitted,
              })
            }
            onReload={reloadOptions}
            reloading={isReloadingOptions}
          />
        </form>
      )}
    </ErpDialog>
  )
}

/**
 * 거래처 사용 / 거래처 미사용, right of the tabs (like the reference
 * screen). 미사용 partners drop out of the list's default view.
 */
function ActiveRadio({ form }: { form: PartnerFormApi }) {
  return (
    <Controller
      control={form.control}
      name="isActive"
      render={({ field }) => (
        <RadioGroup
          aria-label="사용 여부"
          value={field.value ? "true" : "false"}
          onValueChange={(value) => field.onChange(value === "true")}
          className="flex w-auto flex-wrap gap-x-4 gap-y-1 py-1.5"
          title={
            field.value
              ? undefined
              : "미사용 거래처는 목록 기본 화면에서 빠집니다 (사용여부 ‘미사용’으로 조회)."
          }
        >
          <InlineRadio
            id={partnerFieldId("isActive-true")}
            value="true"
            label="거래처 사용"
            ref={field.value ? field.ref : undefined}
          />
          <InlineRadio
            id={partnerFieldId("isActive-false")}
            value="false"
            label="거래처 미사용"
            ref={field.value ? undefined : field.ref}
          />
        </RadioGroup>
      )}
    />
  )
}

/** Placeholder while the partner is read. */
function FormLoading() {
  return (
    <div className="grid gap-5 lg:grid-cols-2" aria-busy="true">
      <span className="sr-only">거래처 정보를 불러오는 중…</span>
      {[8, 6].map((rowCount, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-5 w-20 rounded-sm" />
          <div className="flex flex-col gap-px border border-grid-line">
            {Array.from({ length: rowCount }, (_, row) => (
              <Skeleton key={row} className="h-10 rounded-none" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/** A message in the middle of the modal (not found, could not load). */
function DialogMessage({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: React.ReactNode
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-2 px-4 py-16 text-center"
    >
      <p className="text-base font-bold">{title}</p>
      <p className="text-[13px] text-muted-foreground">{description}</p>
      {children}
    </div>
  )
}
