import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { DashboardDenied, DashboardError, loadDashboard, type Search } from "@/components/dashboard/frame";
import { BasisTag, Empty, formatCount } from "@/components/dashboard/parts";
import { DashboardSkeleton } from "@/components/dashboard/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBusinessDate, formatMonthLabel } from "@/lib/dates";
import { BUCKETS, filterQuery, monthKey, type Bucket } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";
import { getSalesList } from "@/server/dashboard/queries";

export const metadata: Metadata = { title: t("dashboard.list.title") };

/** The sales behind a dashboard figure (BRD §9.3): same bucket, filters and scope as the figure. */
async function SalesBehind({ searchParams }: { searchParams: Search }) {
  const params = await searchParams;
  const loaded = await loadDashboard(Promise.resolve(params));
  if (!loaded) return <DashboardDenied />;
  const { filters } = loaded;
  const bucket: Bucket = (BUCKETS as readonly string[]).includes(String(params.bucket)) ? (params.bucket as Bucket) : "month";
  let sales;
  try {
    sales = await getSalesList(filters, bucket);
  } catch {
    return <DashboardError />;
  }
  const eligible = !bucket.startsWith("submitted") && bucket !== "pending";
  const total = sales.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/${filterQuery(filters)}`} className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-brand-link hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("dashboard.list.back")}
      </Link>
      <Card className="gap-3 p-5 ring-border">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base text-foreground">{t(`dashboard.list.bucket.${bucket}`)}</h2>
          <BasisTag basis={eligible ? "eligible" : "submitted"} />
        </div>
        <p className="text-sm text-muted-foreground">
          {t("dashboard.list.summary", { n: formatCount(sales.length), amount: formatUSD(total) })}
          {sales.length >= 500 ? ` ${t("dashboard.list.limit")}` : ""}
        </p>
      </Card>
      {sales.length === 0 ? (
        <Empty text={t("dashboard.noSalesYet")} />
      ) : (
        <Card className="p-0 ring-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("dashboard.list.submitted")}</TableHead>
                <TableHead>{t("dashboard.list.counts")}</TableHead>
                <TableHead>{t("dashboard.table.agent")}</TableHead>
                <TableHead>{t("dashboard.list.customer")}</TableHead>
                <TableHead>{t("dashboard.table.product")}</TableHead>
                <TableHead>{t("dashboard.list.type")}</TableHead>
                <TableHead>{t("dashboard.table.city")}</TableHead>
                <TableHead>{t("dashboard.table.branch")}</TableHead>
                <TableHead className="text-right">{t("dashboard.list.amount")}</TableHead>
                <TableHead>{t("dashboard.list.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.map((s) => (
                <TableRow key={s.sale_id}>
                  <TableCell className="whitespace-nowrap">
                    <Link href={`/sales/${s.sale_id}`} className="font-semibold text-brand-link hover:underline">{formatBusinessDate(new Date(s.submitted_at))}</Link>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{s.counting_month ? formatMonthLabel(monthKey(s.counting_month)) : "—"}</TableCell>
                  <TableCell>{s.agent_name}</TableCell>
                  <TableCell>{s.customer_name}</TableCell>
                  <TableCell>{s.product_code}</TableCell>
                  <TableCell>{t(s.customer_type === "new" ? "dashboard.kpi.new" : "dashboard.kpi.retention")}</TableCell>
                  <TableCell>{s.city_name}</TableCell>
                  <TableCell>{s.branch_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUSD(Number(s.amount))}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      <StatusBadge status={s.status === "pending_approval" ? "pending" : "approved"} />
                      {s.on_hold ? <StatusBadge status="onHold" /> : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

export default function DashboardSalesPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppHeader title={t("dashboard.list.title")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<DashboardSkeleton />}>
          <SalesBehind searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
