import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import { listRules } from "@/server/audit/queries";
import { can, getAccess } from "@/server/auth/access";
import { AuditTabs } from "../audit-ui";
import { RulesEditor } from "./rules-editor";

export const metadata: Metadata = { title: t("audit.tabRules") };

/** Audit rules: on/off and thresholds (SDD §11.2). Super Admin changes them; every change is logged. */
async function Rules() {
  const access = await getAccess();
  if (!can(access, ["audit.read", "settings.manage"])) return <AccessDenied />;
  const rules = await listRules();
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t("audit.rulesIntro")}</p>
      <RulesEditor rules={rules} canEdit={can(access, "settings.manage")} />
    </div>
  );
}

export default function RulesPage() {
  return (
    <>
      <AppHeader title={t("audit.title")} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <AuditTabs />
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Rules />
        </Suspense>
      </div>
    </>
  );
}
