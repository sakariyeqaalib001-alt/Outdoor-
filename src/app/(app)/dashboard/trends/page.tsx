import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { BarsChart, TrendChart, type Point } from "@/components/dashboard/charts";
import { DashboardDenied, DashboardError, DashboardFrame, loadDashboard, type Search } from "@/components/dashboard/frame";
import { formatCount, Section } from "@/components/dashboard/parts";
import { DashboardSkeleton } from "@/components/dashboard/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cityColors, palette, productColors, segmentColors } from "@/lib/brand";
import { formatMonthLabel } from "@/lib/dates";
import { lastMonths, monthKey, PRODUCT_ORDER } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";
import { getTrend, type TrendRow } from "@/server/dashboard/queries";

export const metadata: Metadata = { title: t("nav.dashboardTrends") };

const MONTHS = 12;

/** Sales Trends (BRD §9.1 monthly trend; owner's §6): last 12 counting months, eligible sales. */
async function Trends({ searchParams }: { searchParams: Search }) {
  const loaded = await loadDashboard(searchParams);
  if (!loaded) return <DashboardDenied />;
  const { filters, ctx, options } = loaded;
  let rows: TrendRow[];
  try {
    rows = await getTrend(filters, MONTHS);
  } catch {
    return <DashboardError />;
  }
  const months = lastMonths(monthKey(ctx.current_month), MONTHS);
  const short = (m: string) => {
    const [y] = m.split("-");
    return `${formatMonthLabel(m).slice(0, 3)} ${y.slice(2)}`;
  };
  const at = (dim: TrendRow["dim"], key: string | null, m: string) =>
    rows.find((r) => r.dim === dim && (dim === "total" || r.key === key) && monthKey(r.month) === m);

  const totals: Point[] = months.map((m) => {
    const r = at("total", null, m);
    return { label: short(m), units: r?.units ?? 0, revenue: Number(r?.revenue ?? 0), new: r?.new_units ?? 0, retention: r?.retention_units ?? 0 };
  });
  const products = options.products
    .filter((p) => !filters.product_id || p.id === filters.product_id)
    .sort((a, b) => (PRODUCT_ORDER as readonly string[]).indexOf(a.name) - (PRODUCT_ORDER as readonly string[]).indexOf(b.name));
  const byProduct: Point[] = months.map((m) => ({ label: short(m), ...Object.fromEntries(products.map((p) => [p.name, at("product", p.id, m)?.units ?? 0])) }));
  const cityIds = new Set(rows.filter((r) => r.dim === "city").map((r) => r.key));
  const cities = options.cities.filter((c) => (ctx.scope === "all" && !filters.city_id) || cityIds.has(c.id) || c.id === filters.city_id);
  const byCity: Point[] = months.map((m) => ({ label: short(m), ...Object.fromEntries(cities.map((c) => [c.id, at("city", c.id, m)?.units ?? 0])) }));

  return (
    <DashboardFrame view="/dashboard/trends" loaded={loaded} description={t("dashboard.trends.description")}>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("dashboard.trends.salesTitle")} description={t("dashboard.trends.monthsBody", { n: MONTHS })}>
          <TrendChart data={totals} series={[{ key: "units", label: t("dashboard.kpi.sales"), color: palette.green700 }]} label={t("dashboard.trends.salesTitle")} />
        </Section>
        <Section title={t("dashboard.trends.revenueTitle")} description={t("dashboard.trends.monthsBody", { n: MONTHS })}>
          <TrendChart data={totals} kind="usd" series={[{ key: "revenue", label: t("dashboard.kpi.revenue"), color: palette.green500 }]} label={t("dashboard.trends.revenueTitle")} />
        </Section>
        <Section title={t("dashboard.trends.mixTitle")} description={t("dashboard.trends.mixBody")}>
          <BarsChart
            data={totals}
            stacked
            series={[
              { key: "new", label: t("dashboard.kpi.new"), color: segmentColors.new },
              { key: "retention", label: t("dashboard.kpi.retention"), color: segmentColors.retention },
            ]}
            label={t("dashboard.trends.mixTitle")}
          />
        </Section>
        <Section title={t("dashboard.trends.productTitle")} description={t("dashboard.trends.productBody")}>
          <TrendChart
            data={byProduct}
            series={products.map((p) => ({ key: p.name, label: p.name, color: productColors[p.name] ?? palette.gray500 }))}
            label={t("dashboard.trends.productTitle")}
          />
        </Section>
        {cities.length > 1 ? (
          <Section title={t("dashboard.trends.cityTitle")} description={t("dashboard.trends.cityBody")} className="lg:col-span-2">
            <TrendChart data={byCity} series={cities.map((c, i) => ({ key: c.id, label: c.name, color: cityColors[i % cityColors.length] }))} label={t("dashboard.trends.cityTitle")} />
          </Section>
        ) : null}
      </div>

      <Section title={t("dashboard.trends.tableTitle")} description={t("dashboard.trends.tableBody")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("dashboard.table.month")}</TableHead>
              <TableHead className="text-right">{t("dashboard.kpi.sales")}</TableHead>
              <TableHead className="text-right">{t("dashboard.kpi.revenue")}</TableHead>
              <TableHead className="text-right">{t("dashboard.kpi.new")}</TableHead>
              <TableHead className="text-right">{t("dashboard.kpi.retention")}</TableHead>
              {products.map((p) => (
                <TableHead key={p.id} className="text-right">{p.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...months].reverse().map((m) => {
              const r = at("total", null, m);
              return (
                <TableRow key={m}>
                  <TableCell className="font-semibold">{formatMonthLabel(m)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatCount(r?.units ?? 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUSD(Number(r?.revenue ?? 0))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCount(r?.new_units ?? 0)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCount(r?.retention_units ?? 0)}</TableCell>
                  {products.map((p) => (
                    <TableCell key={p.id} className="text-right tabular-nums">{formatCount(at("product", p.id, m)?.units ?? 0)}</TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Section>
    </DashboardFrame>
  );
}

export default function TrendsPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppHeader title={t("dashboard.trends.title")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<DashboardSkeleton />}>
          <Trends searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
