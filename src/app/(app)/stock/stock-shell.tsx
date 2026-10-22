import { Suspense, type ReactNode } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { PageTabs } from "@/components/page-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import { can, getAccess } from "@/server/auth/access";

async function Guarded({ children }: { children: ReactNode }) {
  const access = await getAccess();
  if (!can(access, ["stock.read", "stock.receive", "stock.transfer"])) return <AccessDenied />;
  return children;
}

/** Header, tabs and the stock.read check shared by every Stock page; the database checks every action again. */
export function StockShell({ children }: { children: ReactNode }) {
  return (
    <>
      <AppHeader title={t("stock.title")} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <PageTabs
          label="nav.stock"
          tabs={[
            { href: "/stock", label: "stock.tabOverview" },
            { href: "/stock/deliveries", label: "stock.tabDeliveries" },
            { href: "/stock/returns", label: "stock.tabReturns" },
            { href: "/stock/history", label: "stock.tabHistory" },
          ]}
        />
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Guarded>{children}</Guarded>
        </Suspense>
      </div>
    </>
  );
}
