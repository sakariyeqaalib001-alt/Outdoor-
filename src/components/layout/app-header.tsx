import { Suspense } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { t } from "@/lib/i18n";
import { NotificationBell } from "./notification-bell";

/** Top bar: brand pattern strip (decorative, never behind text or logo) + navigation toggle + page title + bell. */
export function AppHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-10 bg-white">
      <div
        aria-hidden="true"
        className="h-1 w-full bg-[url('/brand/pattern/so-triangle-pattern.jpg')] bg-cover bg-center"
      />
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" aria-label={t("nav.toggleSidebar")} />
        <Separator orientation="vertical" className="mr-1 !h-5" />
        <h1 className="text-xl text-foreground">{title}</h1>
        <div className="ml-auto flex items-center gap-2">
          {actions}
          <Suspense fallback={null}>
            <NotificationBell />
          </Suspense>
        </div>
      </div>
    </header>
  );
}
