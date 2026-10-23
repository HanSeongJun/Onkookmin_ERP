"use client"

import { LoaderCircleIcon } from "lucide-react"
import { useEffect, useEffectEvent, useState } from "react"

import { ActionButton } from "@/components/erp/action-bar"
import { ErpDialog } from "@/components/erp/erp-dialog"

/**
 * The Daum/Kakao 우편번호 service (free, no key needed). Loaded only when an
 * address search opens.
 */
const POSTCODE_SCRIPT_URL =
  "https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"

/** Give up waiting for the script after this long (ms), e.g. offline. */
const SCRIPT_TIMEOUT = 15_000

/** What the user picked in the address search. */
export type AddressSearchResult = {
  /** 우편번호: the 5-digit 국가기초구역번호, e.g. "04536". */
  postalCode: string
  /**
   * 도로명 주소 with the 참고항목 (법정동, 건물명) in brackets, e.g.
   * "서울 중구 명동9길 43 (을지로2가)". The 상세주소 (동·호수) is typed by
   * the user in its own box.
   */
  address: string
}

/** The parts of the Daum script's answer that we use. */
type PostcodeData = {
  zonecode: string
  roadAddress: string
  jibunAddress: string
  address: string
  bname: string
  buildingName: string
  apartment: "Y" | "N"
}

type PostcodeConstructor = new (options: {
  oncomplete: (data: PostcodeData) => void
  width?: string
  height?: string
  /**
   * false: the service searches without loading a new page inside its
   * frame. Each such page load would add a browser history entry, so the
   * back button (and closing our modal, which goes back) would first
   * "go back" inside the removed search frame and seem to do nothing.
   */
  submitMode?: boolean
}) => {
  embed: (
    element: HTMLElement,
    options?: { q?: string; autoClose?: boolean }
  ) => void
}

/** daum.Postcode once the script has loaded, or null. */
function postcodeConstructor(): PostcodeConstructor | null {
  const daum = (window as { daum?: { Postcode?: PostcodeConstructor } }).daum
  return daum?.Postcode ?? null
}

/** The script being loaded (null again after a failure, so a retry loads it again). */
let scriptPromise: Promise<PostcodeConstructor> | null = null

/** Loads the 우편번호 script once per page; rejects when it cannot load. */
function loadPostcodeScript(): Promise<PostcodeConstructor> {
  const loaded = postcodeConstructor()
  if (loaded) return Promise.resolve(loaded)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<PostcodeConstructor>((resolve, reject) => {
    const script = document.createElement("script")
    script.src = POSTCODE_SCRIPT_URL
    script.async = true
    const timer = window.setTimeout(
      () => fail(new Error("The postcode script took too long to load.")),
      SCRIPT_TIMEOUT
    )
    function fail(error: Error) {
      window.clearTimeout(timer)
      script.remove()
      scriptPromise = null
      reject(error)
    }
    script.onload = () => {
      const Postcode = postcodeConstructor()
      if (!Postcode) {
        fail(new Error("The postcode script loaded without daum.Postcode."))
        return
      }
      window.clearTimeout(timer)
      resolve(Postcode)
    }
    script.onerror = () =>
      fail(new Error("Could not load the postcode script."))
    document.head.append(script)
  })
  return scriptPromise
}

/**
 * The address to put in the form: the 도로명 주소 (or, when the service has
 * none, the address the user picked), plus the 참고항목 the way the
 * service's own guide builds it: the 법정동 (a name ending in 동/로/가) and,
 * for an apartment, the 건물명, e.g. "서울 중구 명동9길 43 (을지로2가)".
 */
function toResult(data: PostcodeData): AddressSearchResult {
  const base = data.roadAddress || data.address
  const extras: string[] = []
  if (data.roadAddress) {
    if (data.bname && /[동로가]$/.test(data.bname)) extras.push(data.bname)
    if (data.buildingName && data.apartment === "Y") {
      extras.push(data.buildingName)
    }
  }
  return {
    postalCode: data.zonecode,
    address: extras.length > 0 ? `${base} (${extras.join(", ")})` : base,
  }
}

/**
 * 주소 검색: the Daum/Kakao 우편번호 service embedded as a layer inside our
 * screen (a small dialog on top of the form, not a popup window). The user
 * searches by 도로명, 건물명 or 지번 and clicks an address: `onSelect` gets
 * the 우편번호 and the 도로명 주소, then the dialog closes (the caller
 * usually moves the focus to its 상세주소 box).
 *
 * The script is loaded only when the dialog first opens. When it cannot be
 * loaded (offline, blocked), the dialog says so: the 우편번호 and 주소 boxes
 * of the form can always be typed in by hand.
 *
 * Mount it only while it is open (`{open && <AddressSearchDialog … />}`):
 * every opening starts a fresh search.
 */
export function AddressSearchDialog({
  title = "주소 검색",
  query,
  onSelect,
  onClose,
}: {
  title?: string
  /** Text to search for right away (e.g. the address already typed). */
  query?: string
  onSelect: (result: AddressSearchResult) => void
  onClose: () => void
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading"
  )
  const [attempt, setAttempt] = useState(0)
  // The box the search is embedded in (set once it is on screen).
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  const complete = useEffectEvent((data: PostcodeData) => {
    onSelect(toResult(data))
    onClose()
  })
  const initialQuery = useEffectEvent(() => query?.trim() || undefined)

  useEffect(() => {
    if (!container) return
    let cancelled = false
    loadPostcodeScript().then(
      (Postcode) => {
        if (cancelled) return
        container.replaceChildren()
        new Postcode({
          oncomplete: (data) => complete(data),
          width: "100%",
          height: "100%",
          submitMode: false,
        }).embed(container, { q: initialQuery(), autoClose: false })
        setStatus("ready")
      },
      (error: unknown) => {
        if (cancelled) return
        console.error(error)
        setStatus("failed")
      }
    )
    return () => {
      cancelled = true
    }
  }, [container, attempt])

  return (
    <ErpDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={title}
      size="md"
      description="도로명, 건물명 또는 지번으로 검색한 뒤 주소를 누르세요. 우편번호와 주소가 채워지고, 상세주소(동·호수)는 직접 입력합니다."
      bodyClassName="flex flex-col px-3 py-3 sm:px-4"
      footer={
        <ActionButton variant="secondary" size="lg" onClick={onClose}>
          닫기
        </ActionButton>
      }
    >
      {status === "failed" ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-2 px-4 py-16 text-center"
        >
          <p className="text-base font-bold">
            주소 검색 서비스를 불러오지 못했습니다
          </p>
          <p className="text-[13px] text-muted-foreground">
            인터넷 연결을 확인한 뒤 다시 시도해 주세요. 우편번호(숫자 5자리)와
            주소는 입력 칸에 직접 입력해도 됩니다.
          </p>
          <ActionButton
            variant="neutral"
            onClick={() => {
              setStatus("loading")
              setAttempt((current) => current + 1)
            }}
          >
            다시 시도
          </ActionButton>
        </div>
      ) : (
        <div className="relative h-[min(30rem,calc(100dvh-14rem))] min-h-80 flex-1 sm:flex-none">
          {status === "loading" && (
            <p className="absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-muted-foreground">
              <LoaderCircleIcon
                aria-hidden="true"
                className="size-4 animate-spin"
              />
              주소 검색을 불러오는 중…
            </p>
          )}
          {/* The service draws its search box and results in here. */}
          <div
            key={attempt}
            ref={setContainer}
            className="relative size-full border border-input"
          />
        </div>
      )}
    </ErpDialog>
  )
}
