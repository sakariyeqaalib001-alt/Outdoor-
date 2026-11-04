import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { CategoryBars, DonutChart } from "@/components/dashboard/charts";
import { DashboardDenied, DashboardError, DashboardFrame, loadDashboard, type Search } from "@/components/dashboard/frame";
import { formatCount, Insight, Section } from "@/components/dashboard/parts";
import { DashboardSkeleton } from "@/components/dashboard/skeleton";
import { Card } from "@/components/ui/card";
import { palette, productColors } from "@/lib/brand";
import { formatMonthLabel } from "@/lib/dates";
import { filterQuery, monthKey, percent, PRODUCT_ORDER, type Totals } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";
import { getFigures } from "@/server/dashboard/queries";

export const metadata: Metadata = { title: t("nav.dashboardTechnology") };

type ProductRow = { id: string; code: string; color: string; overall: Totals; month: Totals; period: Totals };

/** Technology Sales (owner's dashboard Part Two): FTTA, FTTH, FTTB and LTE, each on its own. */
async function Technology({ searchParams }: { searchParams: Search }) {
  const loaded = await loadDashboard(searchParams);
  if (!loaded) return <DashboardDenied />;
  const { filters, ctx, options } = loaded;
  let figures;
  try {
    figures = await getFigures(filters);
  } catch {
    return <DashboardError />;
  }
  const order = (code: string) => {
    const i = (PRODUCT_ORDER as readonly string[]).indexOf(code);
    return i === -1 ? 99 : i;
  };
  const products: ProductRow[] = options.products
    .filter((p) => !filters.product_id || p.id === filters.product_id)
    .map((p) => ({
      id: p.id,
      code: p.name,
      color: productColors[p.name] ?? palette.gray500,
      overall: figures.get("overall", "product", p.id),
      month: figures.get("month", "product", p.id),
      period: figures.get("period", "product", p.id),
    }))
    .sort((a, b) => order(a.code) - order(b.code));
  const overall = figures.get("overall");
  const month = figures.get("month");
  const monthName = formatMonthLabel(monthKey(ctx.current_month));
  const showPeriod = filters.period !== "month";
  const top = (pick: (p: ProductRow) => number) => [...products].sort((a, b) => pick(b) - pick(a))[0];
  const topUnits = top((p) => p.overall.units);
  const topRevenue = top((p) => p.overall.revenue);
  const topMonth = top((p) => p.month.units);
  const chart = (pick: (p: ProductRow) => number) => products.map((p) => ({ label: p.code, value: pick(p), color: p.color }));

  return (
    <DashboardFrame view="/dashboard/technology" loaded={loaded} description={t("dashboard.technology.description")}>
      <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {products.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            share={percent(p.overall.units, overall.units)}
            showPeriod={showPeriod}
            href={`/dashboard/sales${filterQuery({ ...filters, product_id: p.id }, { bucket: "overall" })}`}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("dashboard.technology.unitsTitle")} description={t("dashboard.technology.overallBody")}>
          <CategoryBars data={chart((p) => p.overall.units)} label={t("dashboard.technology.unitsTitle")} />
        </Section>
        <Section title={t("dashboard.technology.revenueTitle")} description={t("dashboard.technology.overallBody")}>
          <CategoryBars data={chart((p) => p.overall.revenue)} kind="usd" label={t("dashboard.technology.revenueTitle")} />
        </Section>
        <Section title={t("dashboard.technology.monthUnitsTitle")} description={monthName}>
          <CategoryBars data={chart((p) => p.month.units)} label={t("dashboard.technology.monthUnitsTitle")} />
        </Section>
        <Section title={t("dashboard.technology.monthRevenueTitle")} description={monthName}>
          <CategoryBars data={chart((p) => p.month.revenue)} kind="usd" label={t("dashboard.technology.monthRevenueTitle")} />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Section title={t("dashboard.technology.mixTitle")} description={t("dashboard.technology.mixBody")}>
          <DonutChart data={chart((p) => p.overall.units)} center={formatCount(overall.units)} centerLabel={t("dashboard.technology.units")} label={t("dashboard.technology.mixTitle")} />
        </Section>
        <Section title={t("dashboard.technology.insightsTitle")} description={t("dashboard.technology.insightsBody")}>
          <div className="grid gap-5">
            <Insight
              label={t("dashboard.technology.highestUnits")}
              value={topUnits && topUnits.overall.units ? topUnits.code : "—"}
              note={topUnits && topUnits.overall.units ? t("dashboard.technology.shareNote", { pct: percent(topUnits.overall.units, overall.units) ?? 0 }) : t("dashboard.noSalesYet")}
              color={topUnits?.color ?? palette.gray300}
            />
            <Insight
              label={t("dashboard.technology.highestRevenue")}
              value={topRevenue && topRevenue.overall.revenue ? topRevenue.code : "—"}
              note={topRevenue && topRevenue.overall.revenue ? formatUSD(topRevenue.overall.revenue) : t("dashboard.noSalesYet")}
              color={topRevenue?.color ?? palette.gray300}
            />
            <Insight
              label={t("dashboard.technology.topMonth", { month: monthName })}
              value={topMonth && topMonth.month.units ? topMonth.code : "—"}
              note={topMonth && topMonth.month.units ? t("dashboard.technology.monthNote", { n: formatCount(topMonth.month.units), pct: percent(topMonth.month.units, month.units) ?? 0 }) : t("dashboard.noSalesYet")}
              color={topMonth?.color ?? palette.gray300}
            />
          </div>
        </Section>
      </div>
    </DashboardFrame>
  );
}

/** One product: overall units and revenue on top, this month below (owner's Part Two A–D). */
function ProductCard({ product: p, share, showPeriod, href }: { product: ProductRow; share: number | null; showPeriod: boolean; href: string }) {
  const cell = (label: string, value: string, big = false) => (
    <div>
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className={big ? "text-3xl font-semibold text-brand-link tabular-nums" : "text-xl font-semibold tabular-nums"}>{value}</p>
    </div>
  );
  return (
    <Card className="gap-4 p-5 ring-border">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-1 text-base font-semibold text-foreground">
          <span className="size-3 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden="true" />
          {p.code}
        </span>
        <span className="text-xs font-semibold text-muted-foreground">{t("dashboard.technology.shareOfUnits", { pct: share ?? 0 })}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {cell(t("dashboard.technology.overallUnits"), formatCount(p.overall.units), true)}
        {cell(t("dashboard.technology.overallRevenue"), formatUSD(p.overall.revenue), true)}
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
        {cell(t("dashboard.technology.monthUnits"), formatCount(p.month.units))}
        {cell(t("dashboard.technology.monthRevenue"), formatUSD(p.month.revenue))}
      </div>
      {showPeriod ? (
        <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
          {cell(t("dashboard.technology.periodUnits"), formatCount(p.period.units))}
          {cell(t("dashboard.technology.periodRevenue"), formatUSD(p.period.revenue))}
        </div>
      ) : null}
      <Link href={href} className="text-sm font-semibold text-brand-link hover:underline">{t("dashboard.viewSales")}</Link>
    </Card>
  );
}

export default function TechnologyPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppHeader title={t("dashboard.technology.title")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<DashboardSkeleton />}>
          <Technology searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
