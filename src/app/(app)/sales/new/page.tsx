import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { Skeleton } from "@/components/ui/skeleton";
import { businessMonth } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { can, getAccess } from "@/server/auth/access";
import { getSaleFormData } from "@/server/sales/queries";
import { SaleFormLoader } from "./sale-form-loader";

export const metadata: Metadata = { title: t("sales.newSale") };

async function NewSale() {
  const access = await getAccess();
  if (!can(access, "sales.create")) return <AccessDenied />;
  // D-38: Super Admins do not register sales (nobody could approve them).
  if (access.roles.includes("super_admin")) return <p className="mx-auto max-w-2xl rounded-lg border bg-white p-6 text-center text-muted-foreground">{t("sales.errors.superAdmin")}</p>;
  const data = await getSaleFormData(can(access, "sales.override_city"));
  return <SaleFormLoader data={data} currentMonth={businessMonth(new Date())} />;
}

export default function NewSalePage() {
  return (
    <>
      <AppHeader title={t("sales.newTitle")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<Skeleton className="mx-auto h-[640px] w-full max-w-2xl" />}>
          <NewSale />
        </Suspense>
      </div>
    </>
  );
}
