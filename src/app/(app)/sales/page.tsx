import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { businessMonth } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { monthStart, recentMonths } from "@/lib/sales";
import { can, getAccess } from "@/server/auth/access";
import { listSales, listSellers, sellerNames } from "@/server/sales/queries";
import { MonthFilter } from "./month-filter";
import { SalesTable, SalesTotals } from "./sales-table";

export const metadata: Metadata = { title: t("nav.sales") };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** My Sales (FR-SALE-20): one month selector; past months read-only; Team Leaders / Super Admin pick an agent. */
async function MySales({ searchParams }: { searchParams: Search }) {
  const access = await getAccess();
  if (!can(access, ["sales.read", "sales.create"])) return <AccessDenied />;
  const params = await searchParams;
  const current = businessMonth(new Date());
  const months = recentMonths(current);
  const month = typeof params.month === "string" && months.includes(params.month) ? params.month : current;
  const wide = access.permissions["sales.read"] !== undefined && access.permissions["sales.read"] !== "own";
  const sellers = wide ? await listSellers() : undefined;
  const agent = wide && typeof params.agent === "string" && sellers?.some((s) => s.id === params.agent) ? params.agent : undefined;
  const sales = await listSales(monthStart(month), { agentId: agent });
  const names = sellers ? await sellerNames(sales, sellers) : undefined;
  const isCurrent = month === current;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <MonthFilter months={months} month={month} sellers={sellers} agent={agent} />
        {isCurrent && can(access, "sales.create") && !access.roles.includes("super_admin") ? (
          <Button asChild className="h-11 md:h-9">
            <Link href="/sales/new"><Plus aria-hidden="true" />{t("sales.newSale")}</Link>
          </Button>
        ) : null}
      </div>
      {!isCurrent ? <p className="rounded-lg border bg-white p-3 text-sm text-muted-foreground">{t("sales.pastMonthReadOnly")}</p> : null}
      <SalesTotals sales={sales} />
      <SalesTable sales={sales} agentNames={names} />
    </div>
  );
}

export default function SalesPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppHeader title={t("sales.title")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <MySales searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
