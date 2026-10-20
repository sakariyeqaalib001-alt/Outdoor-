import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import { can, getAccess } from "@/server/auth/access";
import { getLookups, listUsers } from "@/server/users/queries";
import { UsersTable } from "./users-table";
import { UsersTabs } from "./users-tabs";

export const metadata: Metadata = { title: t("nav.users") };

async function UsersContent() {
  const access = await getAccess();
  if (!can(access, "users.read")) return <AccessDenied />;
  const [users, lookups] = await Promise.all([listUsers(), getLookups()]);
  return (
    <UsersTable
      users={users}
      lookups={lookups}
      canManage={can(access, "users.manage")}
      canDisable={can(access, "users.disable")}
    />
  );
}

export default function UsersPage() {
  return (
    <>
      <AppHeader title={t("users.title")} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <UsersTabs />
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <UsersContent />
        </Suspense>
      </div>
    </>
  );
}
