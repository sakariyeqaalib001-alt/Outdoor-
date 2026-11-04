import { Suspense, type ReactNode } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { PageTabs } from "@/components/page-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import { can, getAccess } from "@/server/auth/access";

/** Renders the page content only for settings.manage; the database checks again on every change. */
async function Guarded({ children }: { children: ReactNode }) {
  const access = await getAccess();
  if (!can(access, "settings.manage")) return <AccessDenied />;
  return children;
}

/** Header, tabs and permission check shared by every Settings page (SDD §9). */
export function SettingsShell({ children }: { children: ReactNode }) {
  return (
    <>
      <AppHeader title={t("settings.title")} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <PageTabs
          label="nav.settings"
          tabs={[
            { href: "/settings", label: "settings.tabGeneral" },
            { href: "/settings/branches", label: "settings.tabBranches" },
            { href: "/settings/districts", label: "settings.tabDistricts" },
            { href: "/settings/lists", label: "settings.tabLists" },
            { href: "/settings/holidays", label: "settings.tabHolidays" },
            { href: "/settings/readiness", label: "settings.tabReadiness" },
          ]}
        />
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Guarded>{children}</Guarded>
        </Suspense>
      </div>
    </>
  );
}
