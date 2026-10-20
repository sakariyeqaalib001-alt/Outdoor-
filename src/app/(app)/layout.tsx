import { Suspense } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { PermittedNav } from "@/components/layout/permitted-nav";
import { UserCard } from "@/components/layout/user-card";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar
        nav={
          <Suspense fallback={<div className="space-y-2 p-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>}>
            <PermittedNav />
          </Suspense>
        }
        footer={
          <Suspense fallback={<Skeleton className="h-12 w-full" />}>
            <UserCard />
          </Suspense>
        }
      />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  );
}
