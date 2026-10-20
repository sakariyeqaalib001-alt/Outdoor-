import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import { can, getAccess } from "@/server/auth/access";
import { getMatrix } from "@/server/users/queries";
import { UsersTabs } from "../users-tabs";
import { RoleMatrix } from "./role-matrix";

export const metadata: Metadata = { title: t("users.tabRoles") };

async function MatrixContent() {
  const access = await getAccess();
  if (!can(access, ["users.read", "roles.manage"])) return <AccessDenied />;
  const data = await getMatrix();
  return <RoleMatrix data={data} canEdit={can(access, "roles.manage")} />;
}

export default function RolesPage() {
  return (
    <>
      <AppHeader title={t("users.rolesTitle")} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <UsersTabs />
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <MatrixContent />
        </Suspense>
      </div>
    </>
  );
}
