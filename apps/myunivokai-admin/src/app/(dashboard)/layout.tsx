import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { BreadcrumbHeader } from "@/components/layout/breadcrumb-header";
import { ContentTransition } from "@/components/layout/content-transition";

// Deliberately reads no cookies()/headers() here (it used to, for the
// account summary — AppSidebar now reads that cookie itself, client-side).
// Any dynamic API call in a layout marks its whole route subtree dynamic,
// which stops Next from prefetching a route's loading.tsx shell ahead of a
// click — every navigation then has to wait on a live server round trip
// before even the loading skeleton can appear, which read as the page
// waiting on its data fetch before it would move at all. Keeping this
// layout static is what lets that prefetch, and therefore an instant-feeling
// click, actually happen.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="glass-panel relative sticky top-0 z-10 flex h-14 items-center gap-3 overflow-hidden px-4">
          <div className="header-glow" aria-hidden="true" />
          <SidebarTrigger />
          <BreadcrumbHeader />
        </header>
        <div className="scroll-edge-fade" aria-hidden="true" />
        <main className="flex-1 p-4 sm:p-6">
          <ContentTransition>{children}</ContentTransition>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
