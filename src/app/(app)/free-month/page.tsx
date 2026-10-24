import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { Skeleton } from "@/components/ui/skeleton";
import { businessMonth } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { monthStart, recentMonths } from "@/lib/sales";
import { can, getAccess } from "@/server/auth/access";
import { listSales, listSellers } from "@/server/sales/queries";
import { MonthFilter } from "../sales/month-filter";
import { SalesTable, SalesTotals } from "../sales/sales-table";

export const metadata: Metadata = { title: t("nav.freeMonth") };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Free-month sales, reported separately (FR-FREE-03). Same scope as My Sales. */
async function FreeMonth({ searchParams }: { searchParams: Search }) {
  const access = await getAccess();
  if (!can(access, ["sales.read", "sales.create"])) return <AccessDenied />;
  const params = await searchParams;
  const current = businessMonth(new Date());
  const months = recentMonths(current);
  const month = typeof params.month === "string" && months.includes(params.month) ? params.month : current;
  const wide = access.permissions["sales.read"] !== undefined && access.permissions["sales.read"] !== "own";
  const sellers = wide ? await listSellers() : undefined;
  const sales = await listSales(monthStart(month), { freeMonthOnly: true });
  return (
    <div className="grid gap-4">
      <MonthFilter months={months} month={month} />
      <SalesTotals sales={sales} />
      <SalesTable sales={sales} agentNames={sellers ? Object.fromEntries(sellers.map((s) => [s.id, s.name])) : undefined} />
    </div>
  );
}

export default function FreeMonthPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppHeader title={t("sales.freeMonthTitle")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <FreeMonth searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
