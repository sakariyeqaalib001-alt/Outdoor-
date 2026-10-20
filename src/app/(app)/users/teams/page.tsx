import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import { can, getAccess } from "@/server/auth/access";
import { getLookups, listUsers } from "@/server/users/queries";
import { UsersTabs } from "../users-tabs";
import { TeamsView } from "./teams-view";

export const metadata: Metadata = { title: t("users.tabTeams") };

async function TeamsContent() {
  const access = await getAccess();
  if (!can(access, ["users.read", "teams.manage"])) return <AccessDenied />;
  const [lookups, users] = await Promise.all([getLookups(), listUsers()]);
  return <TeamsView lookups={lookups} users={users} canManage={can(access, "teams.manage")} />;
}

export default function TeamsPage() {
  return (
    <>
      <AppHeader title={t("users.teamsTitle")} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <UsersTabs />
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <TeamsContent />
        </Suspense>
      </div>
    </>
  );
}
