import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { DashboardDenied, DashboardError, DashboardFrame, loadDashboard, type Search } from "@/components/dashboard/frame";
import { Empty, formatCount, Section } from "@/components/dashboard/parts";
import { DashboardSkeleton } from "@/components/dashboard/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { percent, PRODUCT_ORDER, type Totals } from "@/lib/dashboard";
import { t, type MessageKey } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";
import { getFigures } from "@/server/dashboard/queries";

export const metadata: Metadata = { title: t("nav.dashboardReports") };

type Row = Totals & { key: string; label: string };

/**
 * Performance Reports: on-screen summaries for the selected period by city, branch, product and agent.
 * Excel / PDF export arrives with Reports in Phase 15.
 */
async function Reports({ searchParams }: { searchParams: Search }) {
  const loaded = await loadDashboard(searchParams);
  if (!loaded) return <DashboardDenied />;
  const { filters } = loaded;
  let figures;
  try {
    figures = await getFigures(filters);
  } catch {
    return <DashboardError />;
  }
  const total = figures.get("period");
  const byUnits = (a: Row, b: Row) => b.units - a.units || b.revenue - a.revenue || a.label.localeCompare(b.label);
  const productOrder = (a: Row, b: Row) => (PRODUCT_ORDER as readonly string[]).indexOf(a.label) - (PRODUCT_ORDER as readonly string[]).indexOf(b.label);

  return (
    <DashboardFrame view="/dashboard/reports" loaded={loaded} description={t("dashboard.reports.description")}>
      <p className="rounded-lg border border-border bg-white p-3 text-sm text-muted-foreground">{t("dashboard.reports.exportLater")}</p>
      <div className="grid gap-4 xl:grid-cols-2">
        <Summary title="dashboard.reports.byCity" first="dashboard.table.city" rows={figures.list("period", "city").sort(byUnits)} total={total} />
        <Summary title="dashboard.reports.byProduct" first="dashboard.table.product" rows={figures.list("period", "product").sort(productOrder)} total={total} />
        <Summary title="dashboard.reports.byBranch" first="dashboard.table.branch" rows={figures.list("period", "branch").sort(byUnits)} total={total} />
        <Summary title="dashboard.reports.byAgent" first="dashboard.table.agent" rows={figures.list("period", "agent").sort(byUnits)} total={total} />
      </div>
    </DashboardFrame>
  );
}

function Summary({ title, first, rows, total }: { title: MessageKey; first: MessageKey; rows: Row[]; total: Totals }) {
  return (
    <Section title={t(title)} description={t("dashboard.reports.periodBody")}>
      {rows.length === 0 ? (
        <Empty text={t("dashboard.noSalesYet")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t(first)}</TableHead>
              <TableHead className="text-right">{t("dashboard.kpi.sales")}</TableHead>
              <TableHead className="text-right">{t("dashboard.table.share")}</TableHead>
              <TableHead className="text-right">{t("dashboard.kpi.revenue")}</TableHead>
              <TableHead className="text-right">{t("dashboard.kpi.new")}</TableHead>
              <TableHead className="text-right">{t("dashboard.kpi.retention")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell className="font-semibold">{r.label}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatCount(r.units)}</TableCell>
                <TableCell className="text-right tabular-nums">{percent(r.units, total.units) ?? 0}%</TableCell>
                <TableCell className="text-right tabular-nums">{formatUSD(r.revenue)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCount(r.newUnits)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCount(r.retentionUnits)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold">{t("dashboard.table.total")}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatCount(total.units)}</TableCell>
              <TableCell className="text-right tabular-nums">{total.units ? "100%" : "—"}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatUSD(total.revenue)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(total.newUnits)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(total.retentionUnits)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </Section>
  );
}

export default function ReportsPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppHeader title={t("dashboard.reports.title")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<DashboardSkeleton />}>
          <Reports searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
