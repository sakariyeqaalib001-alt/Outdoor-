import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { Skeleton } from "@/components/ui/skeleton";
import { businessToday } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { can, getAccess } from "@/server/auth/access";
import { listProducts } from "@/server/settings/queries";
import { ProductsView } from "./products-view";

export const metadata: Metadata = { title: t("nav.products") };

async function ProductsContent() {
  const access = await getAccess();
  if (!can(access, ["prices.manage", "settings.manage"])) return <AccessDenied />;
  const { products, plans, prices } = await listProducts();
  return (
    <ProductsView
      products={products}
      plans={plans}
      prices={prices}
      today={businessToday()}
      canManage={can(access, "prices.manage")}
    />
  );
}

export default function ProductsPage() {
  return (
    <>
      <AppHeader title={t("products.title")} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <ProductsContent />
        </Suspense>
      </div>
    </>
  );
}
