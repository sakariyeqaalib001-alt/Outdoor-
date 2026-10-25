import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import { listPending } from "@/server/approvals/queries";
import { can, getAccess } from "@/server/auth/access";
import { ApprovalsList } from "./approvals-list";

export const metadata: Metadata = { title: t("nav.approvals") };

/** Sales and switches waiting for the Team Leader / Outdoor Supervisor (Super Admin: all) — D-37, D-38. */
async function Approvals() {
  const access = await getAccess();
  if (!can(access, "retention.review")) return <AccessDenied />;
  const { rows, items, available } = await listPending();
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <p className="text-sm text-muted-foreground">{t("approvals.intro")}</p>
      <ApprovalsList rows={rows} items={items} available={available} />
    </div>
  );
}

export default function ApprovalsPage() {
  return (
    <>
      <AppHeader title={t("approvals.title")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<Skeleton className="mx-auto h-96 w-full max-w-3xl" />}>
          <Approvals />
        </Suspense>
      </div>
    </>
  );
}
