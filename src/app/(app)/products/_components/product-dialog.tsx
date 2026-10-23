"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { LoaderCircleIcon } from "lucide-react"
import { unstable_rethrow } from "next/navigation"
import { useEffect, useRef, useState, useTransition } from "react"
import { flushSync } from "react-dom"
import {
  Controller,
  useForm,
  useWatch,
  type FieldErrors,
} from "react-hook-form"
import { toast } from "sonner"

import { BaseProductPickerDialog } from "@/components/base-product-picker-dialog"
import { CategoryPickerDialog } from "@/components/category-picker-dialog"
import { ActionButton } from "@/components/erp/action-bar"
import { ErpDialog } from "@/components/erp/erp-dialog"
import { ErpTabBar, ErpTabPanel, erpTabIds } from "@/components/erp/erp-tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { useHotkeys } from "@/hooks/use-hotkeys"
import type { CategoryNode } from "@/lib/categories/tree"
import { formatNumber } from "@/lib/format"
import {
  createProduct,
  loadBaseProductsForBundle,
  loadBundlesContainingProduct,
  loadProductForEdit,
  suggestAvailableProductCode,
  updateProduct,
  type ProductActionResult,
} from "@/lib/products/actions"
import {
  deriveBundleFoodInfo,
  suggestBundleCode,
  suggestBundleName,
  type BaseProductOption,
  type BundleSuggestionItem,
} from "@/lib/products/bundle"
import {
  BUNDLE_ITEMS_MAX,
  productTypeLabel,
  type ProductType,
} from "@/lib/products/constants"
import type { ContainingBundle, ProductDetail } from "@/lib/products/queries"
import {
  buildProductModalHref,
  emptyProductFormInput,
  isUuid,
  parseProductModal,
  productFormSchema,
  productToFormInput,
  type BundleItemInput,
  type ProductFieldErrors,
  type ProductFieldName,
  type ProductFormInput,
  type ProductFormValues,
  type ProductModalState,
} from "@/lib/products/schema"

import {
  BUNDLE_ITEMS_ADD_ID,
  BundleFoodInfoSection,
  BundleItemsSection,
  bundleQuantityInputId,
  parseBundleQuantity,
} from "./bundle-items-section"
import { ProductBundlesTab } from "./product-bundles-tab"
import {
  ProductCommonFields,
  ProductDetailFields,
  ProductPriceFields,
  type ProductFormApi,
} from "./product-form-fields"

/** The tabs of the 상품 등록/수정 modal. */
export type ProductDialogTab = "common" | "price" | "detail" | "bundles"

const TAB_LABELS: Record<ProductDialogTab, string> = {
  common: "공통정보",
  price: "상품단가",
  detail: "상세설정",
  bundles: "묶음상품",
}

/** Which tab each field is on. */
const FIELD_TABS: Record<ProductFieldName, ProductDialogTab> = {
  productType: "common",
  code: "common",
  name: "common",
  spec: "common",
  unit: "common",
  taxType: "common",
  storageType: "common",
  origin: "common",
  manufacturer: "common",
  barcode: "common",
  categoryId: "common",
  isActive: "common",
  note: "common",
  // 묶음상품's 구성상품 table, below the fields above.
  items: "common",
  purchasePriceInclVat: "price",
  salePriceInclVat: "price",
  shelfLifeDays: "detail",
  allergens: "detail",
}

/** Fields in screen order (tab by tab, top to bottom). */
const FIELD_ORDER = Object.keys(FIELD_TABS) as ProductFieldName[]

const FORM_ID = "product-form"
const TABS_ID = "product-tabs"

const UNSAVED_CHANGES_MESSAGE =
  "저장하지 않은 내용은 사라집니다. 창을 닫을까요?"
const UNSAVED_CHANGES_LEAVE_MESSAGE =
  "저장하지 않은 내용은 사라집니다. 다른 상품 창으로 넘어갈까요?"

/** What happens to an edited product while its data is read. */
type LoadState =
  | { status: "loading" }
  | { status: "ready"; product: ProductDetail | null }
  | { status: "missing" }
  | { status: "error" }

/**
 * A 기준상품 switched to 사용중지 while 사용 묶음상품 contain it: asks
 * first. `bundles` = those 묶음상품, read when 저장 was pressed.
 */
type DeactivateConfirm = {
  bundles: ContainingBundle[]
  input: ProductFormInput
}

/** The 상품코드 and 상품명 the form filled in by itself (see suggest). */
type Suggestion = { code: string; name: string }

/**
 * 상품 등록/수정 modal (the URL says which: ?modal=new, ?modal=new-bundle
 * (&base=<기준상품 id>) or ?modal=edit&id=…).
 *
 * - Tabs: 공통정보, 상품단가, 상세설정 (기준상품 only) and, when editing a
 *   기준상품, 묶음상품 (the 묶음상품 that contain it). Hidden tabs keep
 *   their values.
 * - 상품유형 (기준상품 / 묶음상품) is chosen on 등록 and fixed afterwards.
 *   A 묶음상품 gets a 구성상품 table ([기준상품 추가] opens the 기준상품
 *   picker) and shows its food information worked out from them.
 * - New 묶음상품: 상품코드 and 상품명 are suggested from the 구성상품
 *   ("PRC-010-6", "[묶음] 스팸 클래식 1.81kg X 6개입") until the user types
 *   their own; [제안값 적용] puts the suggestion back. A suggested code
 *   that is taken becomes "PRC-010-6-2" etc.
 * - 묶음상품 수정: nothing is filled in by itself, but when the 구성상품
 *   change, a note under 상품코드 / 상품명 says they may no longer match,
 *   with [제안값 적용].
 * - A click on a 구성상품's name opens that 기준상품; a 기준상품's
 *   묶음상품 tab opens its 묶음상품 (closing comes back here).
 * - Changing the 단위 of a 기준상품 that 묶음상품 use shows a warning (their
 *   구성 수량 count in this unit).
 * - The rules are checked in the browser and again on the server (same zod
 *   schema). On an error the first tab with an error opens, tabs with errors
 *   get a red dot, and the first wrong field gets the focus.
 * - F8 = 저장. Esc, × and [취소] close it, asking first when something was
 *   changed. F5 does nothing here (it must not reload and lose the form).
 * - 상품 수정 reads the product when it opens. If someone else saves the
 *   product meanwhile, saving is refused (the server compares updated_at).
 * - Switching a 기준상품 to 사용중지 asks first when 사용 묶음상품 contain
 *   it (the database switches them off too). The list of those 묶음상품 is
 *   read again when 저장 is pressed.
 * - When the modal is gone before a save finishes (e.g. the browser's back
 *   button), the result is only shown as a message: the modal shown by then
 *   is not closed.
 *
 * Mount it with a `key` per modal address, so every modal starts fresh.
 */
export function ProductDialog({
  modal,
  initialTab = "common",
  categories,
  onClose,
  onOpenModal,
  onReloadCategories,
  reloadingCategories,
}: {
  modal: ProductModalState
  /** The tab to show first (e.g. back from a 묶음상품 opened from here). */
  initialTab?: ProductDialogTab
  /** All categories, including switched-off ones. */
  categories: CategoryNode[]
  /** Closes the modal (the parent removes it from the URL). */
  onClose: () => void
  /**
   * Opens another 상품 modal instead of this one (a 묶음상품 from the
   * 묶음상품 tab, or a new one). `returnTab` = the tab to show when the
   * user comes back to this modal.
   */
  onOpenModal: (next: ProductModalState, returnTab: ProductDialogTab) => void
  /** Reads the categories again (e.g. after adding one in another tab). */
  onReloadCategories: () => void
  reloadingCategories: boolean
}) {
  const isEdit = modal.mode === "edit"
  const productId = modal.mode === "edit" ? modal.id : null
  // ?modal=new-bundle&base=<id>: a new 묶음상품 that starts with this 기준상품.
  const prefillBaseId =
    modal.mode === "new" && modal.productType === "bundle"
      ? (modal.baseProductId ?? null)
      : null

  const [tab, setTab] = useState<ProductDialogTab>(initialTab)
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [basePickerOpen, setBasePickerOpen] = useState(false)
  const [deactivateConfirm, setDeactivateConfirm] =
    useState<DeactivateConfirm | null>(null)
  // 기준상품: the 묶음상품 containing it as read again on 저장 (they may have
  // changed since the modal opened); null = as read with the product.
  const [latestBundles, setLatestBundles] = useState<ContainingBundle[] | null>(
    null
  )
  const [isPending, startTransition] = useTransition()
  // Reading the product (or the 기준상품 of a new 묶음상품).
  const [, startLoad] = useTransition()
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
   * navigation only after a running Server Action has answered, so this
   * dialog can still be on screen although the address already moved on.
   */
  function isStillShown(): boolean {
    if (!mountedRef.current) return false
    const shown = parseProductModal(new URLSearchParams(window.location.search))
    return buildProductModalHref("", shown) === buildProductModalHref("", modal)
  }
  const [load, setLoad] = useState<LoadState>(
    productId !== null
      ? isUuid(productId)
        ? { status: "loading" }
        : { status: "missing" }
      : prefillBaseId !== null
        ? { status: "loading" }
        : { status: "ready", product: null }
  )
  const [loadAttempt, setLoadAttempt] = useState(0)
  // The 기준상품 of the 구성상품 table (and any picked before), by id.
  const [components, setComponents] = useState<
    ReadonlyMap<string, BaseProductOption>
  >(() => new Map())
  const [suggestion, setSuggestion] = useState<Suggestion>({
    code: "",
    name: "",
  })

  const form: ProductFormApi = useForm<
    ProductFormInput,
    unknown,
    ProductFormValues
  >({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      ...emptyProductFormInput,
      productType:
        modal.mode === "new" ? (modal.productType ?? "base") : "base",
    },
    // The first wrong field may be on a hidden tab: focusError() opens that
    // tab first, then focuses the field.
    shouldFocusError: false,
  })
  const {
    reset,
    formState: { errors, isDirty },
  } = form

  const productType = useWatch({ control: form.control, name: "productType" })
  const items = useWatch({ control: form.control, name: "items" })
  const codeValue = useWatch({ control: form.control, name: "code" })
  const nameValue = useWatch({ control: form.control, name: "name" })
  const isActiveValue = useWatch({ control: form.control, name: "isActive" })
  const taxTypeValue = useWatch({ control: form.control, name: "taxType" })
  const unitValue = useWatch({ control: form.control, name: "unit" })

  // 상품 수정: read the product, then fill the form with it.
  // New 묶음상품 from a 기준상품 (&base=…): read that 기준상품 and put it
  // into the 구성상품 table.
  // In a transition, so a redirect from the server (e.g. to the login page
  // when the session has expired) is carried out by Next.js.
  useEffect(() => {
    let ignore = false
    if (productId !== null) {
      if (!isUuid(productId)) return
      startLoad(async () => {
        let product: ProductDetail | null
        try {
          product = await loadProductForEdit(productId)
        } catch (error) {
          if (ignore) return
          unstable_rethrow(error)
          console.error(error)
          setLoad({ status: "error" })
          return
        }
        if (ignore) return
        if (!product) {
          setLoad({ status: "missing" })
          return
        }
        setComponents(
          new Map(
            product.components.map((component) => [component.id, component])
          )
        )
        reset(productToFormInput(product))
        setLoad({ status: "ready", product })
      })
    } else if (prefillBaseId !== null) {
      startLoad(async () => {
        let found: BaseProductOption[]
        try {
          found = await loadBaseProductsForBundle([prefillBaseId])
        } catch (error) {
          if (ignore) return
          unstable_rethrow(error)
          console.error(error)
          toast.error(
            "기준상품을 불러오지 못했습니다. [기준상품 추가]로 다시 골라 주세요."
          )
          setLoad({ status: "ready", product: null })
          return
        }
        if (ignore) return
        const base = found[0]
        if (base && base.isActive) {
          setComponents(new Map([[base.id, base]]))
          // Part of the starting values: closing without changes does not
          // ask "저장하지 않은 내용…".
          reset({
            ...emptyProductFormInput,
            productType: "bundle",
            items: [{ componentId: base.id, quantity: "" }],
          })
        } else {
          toast.info(
            base
              ? "사용중지된 기준상품은 묶음상품에 넣을 수 없습니다. [기준상품 추가]로 골라 주세요."
              : "기준상품을 찾을 수 없습니다. [기준상품 추가]로 골라 주세요."
          )
        }
        setLoad({ status: "ready", product: null })
      })
    }
    return () => {
      ignore = true
    }
  }, [productId, prefillBaseId, loadAttempt, reset])

  // While the product (or the 기준상품) loads only [취소] can take the
  // focus, so the dialog starts there (a second Enter would close it). Once
  // the form is shown, move the focus to the first field to fill in (unless
  // the user already moved it into the form).
  const needsLoad = productId !== null || prefillBaseId !== null
  const startsOnBundles = initialTab === "bundles"
  useEffect(() => {
    if (!needsLoad || load.status !== "ready") return
    const active = document.activeElement
    if (document.getElementById(FORM_ID)?.contains(active)) return
    if (isEdit) {
      // Back from a 묶음상품 opened in the 묶음상품 tab: stay on that tab.
      const bundlesTab = startsOnBundles
        ? document.getElementById(erpTabIds(TABS_ID, "bundles").tabId)
        : null
      if (bundlesTab) {
        bundlesTab.focus()
      } else {
        form.setFocus("code")
      }
    } else {
      // New 묶음상품 with its 기준상품: type the 수량 first.
      ;(
        document.getElementById(bundleQuantityInputId(0)) ??
        document.getElementById(BUNDLE_ITEMS_ADD_ID)
      )?.focus()
    }
  }, [needsLoad, isEdit, startsOnBundles, load.status, form])

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

  const product = load.status === "ready" ? load.product : null
  const canSave = load.status === "ready" && !isPending
  const isBundle = productType === "bundle"
  const isSavedBase = product !== null && product.product_type === "base"
  // A saved 기준상품's 묶음상품 (the newest list read, see latestBundles).
  const bundlesNow = latestBundles ?? product?.bundles ?? []

  // ---- 구성상품 and what follows from them ---------------------------------

  const bundleRows = items.map((item) => ({
    item,
    component: components.get(item.componentId) ?? null,
  }))
  const bundleComponents = bundleRows.flatMap(({ item, component }) =>
    component
      ? [{ ...component, quantity: parseBundleQuantity(item.quantity) }]
      : []
  )
  const foodInfo = deriveBundleFoodInfo(bundleComponents)
  const inactiveComponents = bundleComponents.filter(
    (component) => !component.isActive
  )
  const currentSuggestion = suggestFrom(items, components)
  // 묶음상품 수정: the 구성상품 differ from the saved ones (then the saved
  // 상품코드 / 상품명 may no longer describe them).
  const savedComponents =
    product !== null && product.product_type === "bundle"
      ? product.components
      : null
  const compositionChanged =
    savedComponents !== null &&
    (items.length !== savedComponents.length ||
      items.some(
        (item, index) =>
          item.componentId !== savedComponents[index].id ||
          parseBundleQuantity(item.quantity) !== savedComponents[index].quantity
      ))

  /**
   * New 묶음상품: fills 상품코드 and 상품명 from the 구성상품 while they are
   * empty or still hold the previous suggestion (never over what the user
   * typed). The suggested code is checked against the saved codes and
   * becomes "…-6-2" / "…-SET-2" etc. when taken.
   * 상품 수정: does nothing (see applySuggestion).
   */
  function suggest(
    nextItems: BundleItemInput[],
    nextComponents: ReadonlyMap<string, BaseProductOption>
  ) {
    if (isEdit) return
    const next = suggestFrom(nextItems, nextComponents)
    if (!next) return

    const updated = { ...suggestion }
    const code = form.getValues("code")
    if (code === "" || code === suggestion.code) {
      form.setValue("code", next.code, {
        shouldDirty: true,
        shouldValidate: form.formState.isSubmitted,
      })
      updated.code = next.code
    }
    const name = form.getValues("name")
    if (name === "" || name === suggestion.name) {
      form.setValue("name", next.name, {
        shouldDirty: true,
        shouldValidate: form.formState.isSubmitted,
      })
      updated.name = next.name
    }
    setSuggestion(updated)
    if (updated.code === next.code) fillFreeCode(next.code)
  }

  /**
   * [제안값 적용]: puts the suggestion for the 구성상품 shown now into one
   * field (also on 상품 수정, where nothing is filled in by itself).
   */
  function applySuggestion(field: "code" | "name") {
    const next = suggestFrom(form.getValues("items"), components)
    if (!next) return
    form.setValue(field, next[field], {
      shouldDirty: true,
      shouldValidate: form.formState.isSubmitted,
    })
    setSuggestion((current) => ({ ...current, [field]: next[field] }))
    if (field === "code") fillFreeCode(next.code)
  }

  /**
   * The suggested 상품코드 may be taken already (e.g. a second 6개입 of the
   * same 기준상품): asks the server for a free one ("…-6-2") and puts it in,
   * unless the box no longer holds `candidate`. Only a suggestion: saving
   * still checks the code.
   */
  function fillFreeCode(candidate: string) {
    if (!candidate) return
    // 상품 수정: the product's own code is not "taken".
    if (
      product !== null &&
      candidate.toLowerCase() === product.code.toLowerCase()
    ) {
      return
    }
    suggestAvailableProductCode(candidate).then(
      (available) => {
        if (
          available === candidate ||
          !available ||
          form.getValues("code") !== candidate
        ) {
          return
        }
        form.setValue("code", available, {
          shouldDirty: true,
          shouldValidate: form.formState.isSubmitted,
        })
        setSuggestion((current) =>
          current.code === candidate ? { ...current, code: available } : current
        )
      },
      (error: unknown) => {
        if (!isNavigationError(error)) console.error(error)
      }
    )
  }

  /** Changes the 구성상품 (and the suggestions that follow from them). */
  function setItems(
    nextItems: BundleItemInput[],
    nextComponents: ReadonlyMap<string, BaseProductOption> = components
  ) {
    form.setValue("items", nextItems, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: form.formState.isSubmitted,
    })
    // "사용중지된 기준상품이 들어 있어…" no longer applies to a new list.
    if (form.formState.errors.isActive?.type === "client") {
      form.clearErrors("isActive")
    }
    if (isEdit) {
      // What [제안값 적용] put in described the 구성상품 before this change.
      setSuggestion({ code: "", name: "" })
      return
    }
    suggest(nextItems, nextComponents)
  }

  /** The picker's [선택 추가]: appends the 기준상품 with an empty 수량. */
  function addComponents(picked: BaseProductOption[]) {
    const current = form.getValues("items")
    const existing = new Set(current.map((item) => item.componentId))
    const fresh = picked
      .filter((option) => !existing.has(option.id))
      .slice(0, Math.max(BUNDLE_ITEMS_MAX - current.length, 0))
    if (fresh.length === 0) return
    const nextComponents = new Map(components)
    for (const option of fresh) nextComponents.set(option.id, option)
    setComponents(nextComponents)
    setItems(
      [
        ...current,
        ...fresh.map((option) => ({ componentId: option.id, quantity: "" })),
      ],
      nextComponents
    )
    // Type the 수량 of the first new row next. (After the picker has closed
    // and given the focus back to [기준상품 추가].)
    const firstNew = current.length
    setTimeout(() => {
      document.getElementById(bundleQuantityInputId(firstNew))?.focus()
    }, 0)
  }

  function changeQuantity(index: number, quantity: string) {
    const current = form.getValues("items")
    setItems(
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, quantity } : item
      )
    )
  }

  function removeComponent(index: number) {
    const current = form.getValues("items")
    const next = current.filter((_, itemIndex) => itemIndex !== index)
    flushSync(() => setItems(next))
    // The row below took this place; after the last row, go to the button.
    ;(
      document.getElementById(
        bundleQuantityInputId(Math.min(index, next.length - 1))
      ) ?? document.getElementById(BUNDLE_ITEMS_ADD_ID)
    )?.focus()
  }

  /**
   * 등록 only: 기준상품 ↔ 묶음상품. What the user typed is kept; a 상품코드 /
   * 상품명 the form suggested for the 묶음상품 is taken out again for a
   * 기준상품 (and suggested again when switching back).
   */
  function changeProductType(next: ProductType) {
    if (isEdit) return
    form.setValue("productType", next, { shouldDirty: true })
    // Messages about the other type's fields no longer apply.
    form.clearErrors()
    if (next === "bundle") {
      suggest(form.getValues("items"), components)
      return
    }
    for (const field of ["code", "name"] as const) {
      const value = form.getValues(field)
      if (value !== "" && value === suggestion[field]) {
        form.setValue(field, "", { shouldDirty: true })
      }
    }
    setSuggestion({ code: "", name: "" })
  }

  // ---- Close, leave, save ----------------------------------------------------

  function requestClose() {
    if (isPending) return
    if (isDirty && !window.confirm(UNSAVED_CHANGES_MESSAGE)) return
    onClose()
  }

  /**
   * Opens another 상품 modal from here (a 묶음상품 from the 묶음상품 tab, a
   * 기준상품 from the 구성상품 table), asking first when something was
   * changed. `returnTab` = the tab to show when the user comes back.
   */
  function openOther(next: ProductModalState, returnTab: ProductDialogTab) {
    if (isPending) return
    if (isDirty && !window.confirm(UNSAVED_CHANGES_LEAVE_MESSAGE)) return
    onOpenModal(next, returnTab)
  }

  /**
   * Focuses a field. For the 구성표: the 수량 of the first wrong row, or
   * [기준상품 추가] when the problem is the list as a whole (none, duplicates).
   */
  function focusField(
    field: ProductFieldName,
    fieldErrors: FieldErrors<ProductFormInput> | ProductFieldErrors
  ) {
    if (field === "items") {
      // Browser check: the row errors are in the error object (the red
      // marks on the rows are not drawn yet at this moment).
      const rowErrors = fieldErrors.items
      const wrongRow = Array.isArray(rowErrors)
        ? rowErrors.findIndex(Boolean)
        : -1
      const target =
        (wrongRow >= 0
          ? document.getElementById(bundleQuantityInputId(wrongRow))
          : null) ??
        // Server check: the message is for the whole list; a row already
        // marked red is the best guess.
        document.querySelector<HTMLElement>(
          `#${FORM_ID} [data-bundle-quantity][aria-invalid="true"]`
        ) ??
        document.getElementById(BUNDLE_ITEMS_ADD_ID)
      target?.focus()
      return
    }
    form.setFocus(field)
  }

  /** Opens the tab of the first wrong field and focuses that field. */
  function focusError(
    fieldErrors: FieldErrors<ProductFormInput> | ProductFieldErrors
  ) {
    const first = FIELD_ORDER.find((field) => fieldErrors[field])
    if (!first) return
    flushSync(() => setTab(FIELD_TABS[first]))
    focusField(first, fieldErrors)
    // The new tab's panel can become visible a frame later (the focus above
    // then does nothing and stays on the old tab): focus once more then.
    requestAnimationFrame(() => focusField(first, fieldErrors))
  }

  /** Sends the form to the server and handles the answer. */
  async function send(input: ProductFormInput) {
    let result: ProductActionResult
    try {
      result =
        product !== null
          ? await updateProduct(product.id, product.updated_at, input)
          : await createProduct(input)
    } catch (error) {
      submittingRef.current = false
      // A redirect from the server (e.g. to the login page when the
      // session has expired) is not an error: let Next.js carry it out.
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
      const fieldErrors = Object.entries(result.fieldErrors) as [
        ProductFieldName,
        string,
      ][]
      for (const [field, message] of fieldErrors) {
        form.setError(field, { type: "server", message })
      }
      focusError(result.fieldErrors)
      toast.error(result.message)
      return
    }

    toast.success(
      isEdit
        ? "변경 내용을 저장했습니다."
        : input.productType === "bundle"
          ? "묶음상품을 등록했습니다."
          : "상품을 등록했습니다.",
      {
        description:
          result.bundlesDeactivated > 0
            ? `이 기준상품이 들어간 묶음상품 ${formatNumber(result.bundlesDeactivated, 0)}개도 함께 사용중지했습니다.`
            : undefined,
      }
    )
    // Saved, but the user already left this modal (e.g. the browser's back
    // button): closing now would close the modal they went back to.
    if (stillShown) onClose()
  }

  function save() {
    if (!canSave || submittingRef.current) return
    submittingRef.current = true

    void form.handleSubmit(
      (values) => {
        // Send what the user typed: the server checks it again with the same
        // rules and never trusts the browser.
        const input = form.getValues()

        // A 사용 묶음상품 cannot contain a 사용중지 기준상품 (the database
        // refuses it too).
        if (values.productType === "bundle" && values.isActive) {
          const inactive = values.items
            .map((item) => components.get(item.componentId))
            .filter((component) => component && !component.isActive)
          if (inactive.length > 0) {
            submittingRef.current = false
            const message = `사용중지된 기준상품(${inactive
              .map((component) => component?.name)
              .join(
                ", "
              )})이 들어 있어 ‘사용’으로 저장할 수 없습니다. 사용중지로 저장하거나, 구성상품에서 빼거나, 기준상품을 먼저 사용으로 바꿔 주세요.`
            form.setError("isActive", { type: "client", message })
            focusError({ isActive: message })
            toast.error(message)
            return
          }
        }

        // 기준상품 사용 → 사용중지: its 사용 묶음상품 are switched off too.
        // Ask first when there are any. The list is read again now: someone
        // may have added a 묶음상품 since the modal opened.
        if (
          product !== null &&
          product.product_type === "base" &&
          product.is_active &&
          !values.isActive
        ) {
          const productIdToCheck = product.id
          startTransition(async () => {
            let bundles: ContainingBundle[]
            try {
              bundles = await loadBundlesContainingProduct(productIdToCheck)
            } catch (error) {
              submittingRef.current = false
              unstable_rethrow(error)
              console.error(error)
              toast.error(
                "저장하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요."
              )
              return
            }
            if (!isStillShown()) {
              submittingRef.current = false
              return
            }
            setLatestBundles(bundles)
            const switchedOff = bundles.filter((bundle) => bundle.isActive)
            if (switchedOff.length > 0) {
              submittingRef.current = false
              setDeactivateConfirm({ bundles: switchedOff, input })
              return
            }
            await send(input)
          })
          return
        }

        startTransition(async () => {
          await send(input)
        })
      },
      // Some fields are invalid: open their tab and focus the first one.
      (fieldErrors) => {
        submittingRef.current = false
        focusError(fieldErrors)
        toast.error(
          "입력한 내용을 확인해 주세요. 빨간 글씨로 표시된 항목이 있습니다."
        )
      }
    )()
  }

  function confirmDeactivate() {
    if (!deactivateConfirm || submittingRef.current) return
    const { input } = deactivateConfirm
    setDeactivateConfirm(null)
    submittingRef.current = true
    startTransition(async () => {
      await send(input)
    })
  }

  // F8 = 저장 (not while a smaller dialog is open on top). F5 is caught so
  // the browser does not reload the page and lose the form.
  const smallDialogOpen =
    categoryPickerOpen || basePickerOpen || deactivateConfirm !== null
  useHotkeys({
    F5: () => {},
    F8: smallDialogOpen ? undefined : save,
  })

  // ---- Tabs -----------------------------------------------------------------

  const tabs: ProductDialogTab[] = isBundle
    ? ["common", "price"]
    : isSavedBase
      ? ["common", "price", "detail", "bundles"]
      : ["common", "price", "detail"]
  const shownTab = tabs.includes(tab) ? tab : "common"

  const tabErrors = new Set(
    FIELD_ORDER.filter((field) => errors[field]).map(
      (field) => FIELD_TABS[field]
    )
  )
  const tabItems = tabs.map((value) => ({
    value,
    label: (
      <span className="flex items-center gap-1.5">
        {TAB_LABELS[value]}
        {value === "bundles" && product && (
          <span className="text-xs tabular-nums">
            ({formatNumber(bundlesNow.length, 0)})
          </span>
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
  }))

  // ---- Notes next to fields ---------------------------------------------------

  const activeBundles = bundlesNow.filter((bundle) => bundle.isActive)
  let isActiveNote: React.ReactNode
  if (isBundle && isActiveValue && inactiveComponents.length > 0) {
    isActiveNote = (
      <span className="font-bold text-destructive">
        사용중지된 기준상품이 들어 있어 ‘사용’으로 저장할 수 없습니다.
      </span>
    )
  } else if (
    isSavedBase &&
    product.is_active &&
    !isActiveValue &&
    activeBundles.length > 0
  ) {
    isActiveNote = (
      <span className="font-bold text-destructive">
        이 기준상품이 들어간 묶음상품 {formatNumber(activeBundles.length, 0)}
        개도 함께 사용중지됩니다.
      </span>
    )
  } else if (
    isSavedBase &&
    !product.is_active &&
    isActiveValue &&
    bundlesNow.length > 0
  ) {
    isActiveNote =
      "기준상품을 다시 사용으로 바꿔도 묶음상품은 자동으로 사용되지 않습니다."
  }

  // A 묶음상품's 구성 수량 counts in its 기준상품's unit: changing the unit
  // changes what every 묶음상품 using it holds.
  const unitNote =
    isSavedBase &&
    bundlesNow.length > 0 &&
    unitValue !== "" &&
    unitValue !== product.unit ? (
      <span className="font-bold text-destructive">
        이 기준상품이 들어간 묶음상품 {formatNumber(bundlesNow.length, 0)}개의
        구성 수량도 ‘{unitValue}’ 단위로 바뀝니다.
      </span>
    ) : undefined

  // 등록: the suggestion state. 수정: a note only once the 구성상품 changed.
  const showSuggestionHints = isBundle && (!isEdit || compositionChanged)
  const codeHint = showSuggestionHints ? (
    <SuggestionHint
      value={codeValue}
      suggested={suggestion.code}
      current={currentSuggestion?.code ?? ""}
      onApply={() => applySuggestion("code")}
      fieldLabel="상품코드"
      changedNote={
        isEdit
          ? "구성상품이 바뀌었습니다. 상품코드가 구성과 다를 수 있습니다."
          : undefined
      }
    />
  ) : undefined
  const nameHint = showSuggestionHints ? (
    <SuggestionHint
      value={nameValue}
      suggested={suggestion.name}
      current={currentSuggestion?.name ?? ""}
      onApply={() => applySuggestion("name")}
      fieldLabel="상품명"
      changedNote={
        isEdit
          ? "구성상품이 바뀌었습니다. 상품명이 구성과 다를 수 있습니다."
          : undefined
      }
    />
  ) : undefined

  // "기준상품 등록" follows the 상품유형 radio; "묶음상품 수정 - …".
  const title = isEdit
    ? product
      ? `${productTypeLabel(product.product_type)} 수정 - ${product.name}`
      : "상품 수정"
    : `${productTypeLabel(productType)} 등록`

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose()
      }}
      title={title}
      // 상품 등록: start with the 상품코드 (기준상품) or [기준상품 추가]
      // (묶음상품). While something loads, the effect above moves the focus.
      initialFocus={
        needsLoad
          ? undefined
          : () =>
              document.getElementById(
                isBundle ? BUNDLE_ITEMS_ADD_ID : "product-code"
              ) ?? true
      }
      tabs={
        <ErpTabBar
          idPrefix={TABS_ID}
          aria-label="상품 정보"
          items={tabItems}
          value={shownTab}
          onValueChange={(value) => setTab(value as ProductDialogTab)}
        />
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
          title="상품을 찾을 수 없습니다"
          description="주소가 잘못되었거나 등록되지 않은 상품입니다. 창을 닫고 목록에서 다시 선택해 주세요."
        />
      ) : load.status === "error" ? (
        <DialogMessage
          title="상품 정보를 불러오지 못했습니다"
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
          <ErpTabPanel
            idPrefix={TABS_ID}
            value="common"
            selectedValue={shownTab}
          >
            <ProductCommonFields
              form={form}
              errors={errors}
              productType={productType}
              typeLocked={isEdit}
              onProductTypeChange={changeProductType}
              codeHint={codeHint}
              nameHint={nameHint}
              unitNote={unitNote}
              unitLocked={isEdit && (product?.hasStockRecords ?? false)}
              isActiveNote={isActiveNote}
              bundleSection={
                <>
                  <Controller
                    control={form.control}
                    name="items"
                    render={({ field }) => (
                      <BundleItemsSection
                        rows={bundleRows}
                        errors={errors.items}
                        addButtonRef={field.ref}
                        onAdd={() => setBasePickerOpen(true)}
                        onQuantityChange={changeQuantity}
                        onQuantityBlur={field.onBlur}
                        onRemove={removeComponent}
                        onOpenComponent={(componentId) =>
                          openOther({ mode: "edit", id: componentId }, "common")
                        }
                      />
                    )}
                  />
                  <BundleFoodInfoSection
                    foodInfo={foodInfo}
                    hasComponents={bundleComponents.length > 0}
                  />
                </>
              }
              categories={categories}
              savedCategoryId={product?.category_id ?? ""}
              savedCategoryPath={product?.categoryPath ?? []}
              createdAt={product?.created_at}
              updatedAt={product?.updated_at}
              onOpenCategoryPicker={() => {
                setCategoryPickerOpen(true)
                // Read the categories again: the user may have just added
                // some in the 상품분류설정 tab ([분류값 설정]).
                onReloadCategories()
              }}
            />
          </ErpTabPanel>
          <ErpTabPanel
            idPrefix={TABS_ID}
            value="price"
            selectedValue={shownTab}
          >
            <ProductPriceFields
              form={form}
              taxType={isBundle ? (foodInfo.taxType ?? "") : taxTypeValue}
              bundleComponents={isBundle ? bundleComponents : null}
            />
          </ErpTabPanel>
          {!isBundle && (
            <ErpTabPanel
              idPrefix={TABS_ID}
              value="detail"
              selectedValue={shownTab}
            >
              <ProductDetailFields form={form} />
            </ErpTabPanel>
          )}
          {isSavedBase && (
            <ErpTabPanel
              idPrefix={TABS_ID}
              value="bundles"
              selectedValue={shownTab}
            >
              <ProductBundlesTab
                baseName={product.name}
                baseUnit={product.unit}
                baseIsActive={product.is_active}
                bundles={bundlesNow}
                onOpenBundle={(bundleId) =>
                  openOther({ mode: "edit", id: bundleId }, "bundles")
                }
                onAddBundle={() =>
                  openOther(
                    {
                      mode: "new",
                      productType: "bundle",
                      baseProductId: product.id,
                    },
                    "bundles"
                  )
                }
              />
            </ErpTabPanel>
          )}

          {/* Inside the product dialog, so Esc closes only the picker. */}
          <CategoryPickerDialog
            open={categoryPickerOpen}
            onOpenChange={setCategoryPickerOpen}
            categories={categories}
            value={form.getValues("categoryId") || null}
            keepCategoryId={product?.category_id ?? null}
            purpose="assign"
            onConfirm={(category) =>
              form.setValue("categoryId", category.id, {
                shouldDirty: true,
                shouldValidate: form.formState.isSubmitted,
              })
            }
            onReload={onReloadCategories}
            reloading={reloadingCategories}
          />
          {basePickerOpen && (
            <BaseProductPickerDialog
              addedIds={new Set(items.map((item) => item.componentId))}
              capacity={Math.max(BUNDLE_ITEMS_MAX - items.length, 0)}
              onAdd={addComponents}
              onClose={() => setBasePickerOpen(false)}
            />
          )}
          <ErpDialog
            open={deactivateConfirm !== null}
            onOpenChange={(open) => {
              if (!open) setDeactivateConfirm(null)
            }}
            title="사용중지 확인"
            size="md"
            footer={
              <>
                <ActionButton
                  variant="secondary"
                  size="lg"
                  onClick={() => setDeactivateConfirm(null)}
                >
                  취소
                </ActionButton>
                <ActionButton size="lg" onClick={confirmDeactivate}>
                  사용중지하고 저장
                </ActionButton>
              </>
            }
          >
            {deactivateConfirm && (
              <div className="flex flex-col gap-2 py-2 text-sm">
                <p>
                  이 기준상품이 들어간 묶음상품{" "}
                  <strong className="font-bold text-destructive">
                    {formatNumber(deactivateConfirm.bundles.length, 0)}개
                  </strong>
                  도 함께 사용중지됩니다. 저장할까요?
                </p>
                <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-[13px]">
                  {deactivateConfirm.bundles.map((bundle) => (
                    <li key={bundle.id}>
                      {bundle.name}{" "}
                      <span className="text-muted-foreground tabular-nums">
                        ({bundle.code})
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-[13px] text-muted-foreground">
                  기준상품을 나중에 다시 사용으로 바꿔도 묶음상품은 자동으로
                  사용되지 않습니다. 묶음상품은 각각 [선택 사용]이나 수정 창에서
                  사용으로 바꿔 주세요.
                </p>
              </div>
            )}
          </ErpDialog>
        </form>
      )}
    </ErpDialog>
  )
}

/**
 * The suggested 상품코드 / 상품명 of a 묶음상품 from its 구성상품, or null
 * while a 기준상품 or a 수량 is missing.
 */
function suggestFrom(
  items: readonly BundleItemInput[],
  components: ReadonlyMap<string, BaseProductOption>
): Suggestion | null {
  const list: BundleSuggestionItem[] = []
  for (const item of items) {
    const component = components.get(item.componentId)
    const quantity = parseBundleQuantity(item.quantity)
    if (!component || quantity === null) return null
    list.push({ code: component.code, name: component.name, quantity })
  }
  if (list.length === 0) return null
  return { code: suggestBundleCode(list), name: suggestBundleName(list) }
}

/**
 * Next to 상품코드 / 상품명 of a 묶음상품: "자동 제안" while the field holds
 * the suggestion, "직접 수정함" + [제안값 적용] when the user typed something
 * else. 상품 수정 (`changedNote`, shown only after the 구성상품 changed):
 * that note + [제안값 적용] while the field differs from the suggestion.
 */
function SuggestionHint({
  value,
  suggested,
  current,
  onApply,
  fieldLabel,
  changedNote,
}: {
  value: string
  /** What the form filled in last. */
  suggested: string
  /** The suggestion for the 구성상품 now ("" while it cannot be made). */
  current: string
  onApply: () => void
  fieldLabel: string
  /** 상품 수정: says the saved value may no longer match the 구성상품. */
  changedNote?: string
}) {
  if (value !== "" && value === suggested) {
    return (
      <span title="구성상품에 맞춰 자동으로 채웠습니다. 고쳐 써도 됩니다.">
        자동 제안값
      </span>
    )
  }
  if (current !== "" && value !== current && (value !== "" || changedNote)) {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        {changedNote ? (
          <span className="font-bold text-destructive">{changedNote}</span>
        ) : (
          <span className="rounded-sm border border-input px-1 font-bold text-foreground">
            직접 수정함
          </span>
        )}
        <ActionButton
          size="sm"
          variant="neutral"
          title={`제안값: ${current}`}
          aria-label={`${fieldLabel} 제안값 적용: ${current}`}
          onClick={onApply}
        >
          제안값 적용
        </ActionButton>
      </span>
    )
  }
  if (value === "" && !changedNote) {
    return (
      <span title="구성상품과 수량을 넣으면 자동으로 채워집니다. 직접 입력해도 됩니다.">
        구성상품 입력 시 자동
      </span>
    )
  }
  return undefined
}

/** Whether `error` is a Next.js redirect or similar (not a real error). */
function isNavigationError(error: unknown): boolean {
  try {
    unstable_rethrow(error)
    return false
  } catch {
    return true
  }
}

/** Placeholder while the product is read. */
function FormLoading() {
  return (
    <div className="grid gap-5 lg:grid-cols-2" aria-busy="true">
      <span className="sr-only">상품 정보를 불러오는 중…</span>
      {[7, 4].map((rowCount, index) => (
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
