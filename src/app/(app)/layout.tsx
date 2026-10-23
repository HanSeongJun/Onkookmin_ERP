import { AppHeader } from "@/components/app-header"
import { AppSidebar } from "@/components/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"

/**
 * Layout for every signed-in page: brand-colored header bar across the top,
 * the 전체메뉴 sidebar on the left, and the page in a white work area.
 *
 * This layout must not read cookies/headers at the top level (it would block
 * every page and fail the build). The signed-in user is loaded inside a
 * <Suspense> boundary in <AppHeader />.
 * Signed-out visitors are sent to /login by src/proxy.ts and requireUser().
 */
export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <SidebarProvider
      className="flex-col"
      style={
        {
          "--header-height": "3rem",
          "--sidebar-width": "14rem",
        } as React.CSSProperties
      }
    >
      <AppHeader />
      <div className="flex flex-1">
        <AppSidebar />
        {/* min-w-0 lets wide tables scroll inside the page instead of
            stretching it. */}
        <SidebarInset className="min-w-0 bg-canvas p-2 md:p-3">
          <div className="flex flex-1 flex-col gap-3 border border-grid-line bg-background p-3 md:p-4">
            {children}
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
