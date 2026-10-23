import type { Metadata } from "next"
import { Suspense } from "react"

import { PageTitle } from "@/components/erp/page-title"
import { InventoryNotReady } from "@/components/inventory/inventory-notices"
import { Skeleton } from "@/components/ui/skeleton"
import { requireUser } from "@/lib/auth/user"
import {
  getInventorySettings,
  getStockPlaceTree,
  INVENTORY_NOT_READY_MESSAGE,
  InventoryNotReadyError,
} from "@/lib/inventory/queries"

import { PlaceSettingsScreen } from "./_components/place-settings-screen"

export const metadata: Metadata = {
  title: "창고·로케이션 설정",
}

/**
 * "/inventory/settings": 창고·로케이션 설정 — 창고 > 구역 (보관온도) >
 * 위치(선반) and the 재고 설정 (기한 임박 기준일). Add, rename, reorder,
 * 사용/사용중지; delete only while nothing was ever stored there. Every
 * 구역 gets a "기본" 위치 automatically (never deleted). Pickers of the 전표
 * screens open this page in a new tab.
 */
export default function InventorySettingsPage() {
  return (
    <>
      <PageTitle
        title="창고·로케이션 설정"
        description="창고 → 구역(보관온도) → 위치(선반) 순서로 재고를 둘 곳을 만들고, 기한 임박 기준일을 정합니다."
      />
      {/* Reading the places needs the login session, so it streams in here. */}
      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsSection />
      </Suspense>
    </>
  )
}

async function SettingsSection() {
  await requireUser()
  let data: [
    Awaited<ReturnType<typeof getStockPlaceTree>>,
    Awaited<ReturnType<typeof getInventorySettings>>,
  ]
  try {
    data = await Promise.all([getStockPlaceTree(), getInventorySettings()])
  } catch (error) {
    if (error instanceof InventoryNotReadyError) {
      return <InventoryNotReady message={INVENTORY_NOT_READY_MESSAGE} />
    }
    throw error
  }
  const [tree, settings] = data
  return <PlaceSettingsScreen tree={tree} settings={settings} />
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <span className="sr-only">창고·위치를 불러오는 중…</span>
      <Skeleton className="h-20 w-full max-w-xl rounded-sm" />
      <div className="flex gap-1.5">
        <Skeleton className="h-8 w-32 rounded-sm" />
        <Skeleton className="ml-auto h-8 w-40 rounded-sm" />
      </div>
      <div className="flex flex-col gap-px border border-grid-line">
        <Skeleton className="h-9 rounded-none bg-brand-tint-strong" />
        {Array.from({ length: 10 }, (_, index) => (
          <Skeleton key={index} className="h-8 rounded-none" />
        ))}
      </div>
    </div>
  )
}
