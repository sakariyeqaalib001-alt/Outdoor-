import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BarChart3, DollarSign, Repeat, ShoppingBag, UserPlus, Wallet } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { DonutChart, TrendChart } from "@/components/dashboard/charts";
import { DashboardDenied, DashboardError, DashboardFrame, loadDashboard, type Search } from "@/components/dashboard/frame";
import { formatCount, Insight, KpiCard, Section } from "@/components/dashboard/parts";
import { DashboardSkeleton } from "@/components/dashboard/skeleton";
import { bandColors, palette, segmentColors } from "@/lib/brand";
import { formatMonthLabel } from "@/lib/dates";
import { achievement, bandOfPercent, filterQuery, lastMonths, monthKey, percent, type Bucket, type Totals } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";
import { can, getAccess } from "@/server/auth/access";
import { getFigures, getPeople, getTrend } from "@/server/dashboard/queries";

export const metadata: Metadata = { title: t("nav.dashboardOverview") };

/** Sales Overview (BRD §9.1, owner's dashboard Part One A–B). */
async function Overview({ searchParams }: { searchParams: Search }) {
  const access = await getAccess();
  if (!can(access, "dashboard.read")) {
    // Stock Officers see only the stock part (D-42); everyone else without the dashboard gets the notice.
    if (can(access, "stock.read") && access.permissions["stock.read"] !== "own") redirect("/dashboard/operations");
    return <DashboardDenied />;
  }
  const loaded = await loadDashboard(searchParams);
  if (!loaded) return <DashboardDenied />;
  const { filters, ctx } = loaded;
  let data;
  try {
    const [figures, trend, people] = await Promise.all([getFigures(filters), getTrend(filters, 12), getPeople(filters)]);
    data = { figures, trend, people };
  } catch {
    return <DashboardError />;
  }
  const { figures, trend, people } = data;
  const link = (bucket: Bucket) => `/dashboard/sales${filterQuery(filters, { bucket })}`;
  const overall = figures.get("overall");
  const month = figures.get("month");
  const last = figures.get("last_month");
  const period = figures.get("period");
  const showPeriod = filters.period !== "month";
  const monthName = formatMonthLabel(monthKey(ctx.current_month));

  // Target: people with a target in view × target units; not meaningful with a branch or product filter (D-42).
  const target = filters.branch_id || filters.product_id ? 0 : people.length * ctx.target_units;
  const pct = achievement(month.units, target);
  const band = bandOfPercent(pct, ctx.target_units, ctx.baseline_units);
  const topBranch = figures.list("month", "branch").sort((a, b) => b.units - a.units || b.revenue - a.revenue)[0];
  const topProduct = figures.list("month", "product").sort((a, b) => b.units - a.units || b.revenue - a.revenue)[0];

  const months = lastMonths(monthKey(ctx.current_month), 12);
  const totalsByMonth = new Map(trend.filter((r) => r.dim === "total").map((r) => [monthKey(r.month), r]));
  const trendData = months.map((m) => ({ label: formatMonthLabel(m).slice(0, 3), units: totalsByMonth.get(m)?.units ?? 0 }));

  const lastNote = t("dashboard.kpi.lastMonth", { value: formatCount(last.units) });
  const share = (part: number, whole: Totals) => t("dashboard.kpi.shareOfMonth", { pct: percent(part, whole.units) ?? 0 });

  return (
    <DashboardFrame view="/" loaded={loaded} description={t("dashboard.overview.description")}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={ShoppingBag} label={t("dashboard.kpi.overallSales")} value={formatCount(overall.units)} note={t("dashboard.kpi.sinceStart")} href={link("overall")} />
        <KpiCard icon={DollarSign} label={t("dashboard.kpi.overallRevenue")} value={formatUSD(overall.revenue)} note={t("dashboard.kpi.sinceStart")} href={link("overall")} />
        <KpiCard icon={BarChart3} label={t("dashboard.kpi.monthSales")} value={formatCount(month.units)} note={`${monthName} · ${lastNote}`} href={link("month")} />
        <KpiCard
          icon={Wallet}
          label={t("dashboard.kpi.monthRevenue")}
          value={formatUSD(month.revenue)}
          note={`${monthName} · ${t("dashboard.kpi.lastMonth", { value: formatUSD(last.revenue) })}`}
          href={link("month")}
        />
        <KpiCard icon={UserPlus} label={t("dashboard.kpi.overallNew")} value={formatCount(overall.newUnits)} note={t("dashboard.kpi.shareOfAll", { pct: percent(overall.newUnits, overall.units) ?? 0 })} href={link("overall")} size="md" />
        <KpiCard icon={Repeat} label={t("dashboard.kpi.overallRetention")} value={formatCount(overall.retentionUnits)} note={t("dashboard.kpi.shareOfAll", { pct: percent(overall.retentionUnits, overall.units) ?? 0 })} href={link("overall")} size="md" />
        <KpiCard icon={UserPlus} label={t("dashboard.kpi.monthNew")} value={formatCount(month.newUnits)} note={share(month.newUnits, month)} href={link("month")} size="md" />
        <KpiCard icon={Repeat} label={t("dashboard.kpi.monthRetention")} value={formatCount(month.retentionUnits)} note={share(month.retentionUnits, month)} href={link("month")} size="md" />
      </div>

      {showPeriod ? (
        <Section title={t("dashboard.overview.periodTitle")} description={t("dashboard.overview.periodBody")}>
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              [t("dashboard.kpi.sales"), formatCount(period.units)],
              [t("dashboard.kpi.revenue"), formatUSD(period.revenue)],
              [t("dashboard.kpi.new"), formatCount(period.newUnits)],
              [t("dashboard.kpi.retention"), formatCount(period.retentionUnits)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-sm text-muted-foreground">{k}</dt>
                <dd className="text-2xl font-semibold text-brand-link tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <a href={link("period")} className="text-sm font-semibold text-brand-link underline-offset-4 hover:underline">{t("dashboard.viewSales")}</a>
        </Section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.2fr)]">
        <Section title={t("dashboard.overview.trendTitle")} description={t("dashboard.overview.trendBody")}>
          <TrendChart data={trendData} series={[{ key: "units", label: t("dashboard.kpi.sales"), color: palette.green700 }]} label={t("dashboard.overview.trendTitle")} />
        </Section>
        <Section title={t("dashboard.overview.compositionTitle")} description={t("dashboard.overview.compositionBody")}>
          <DonutChart
            data={[
              { label: t("dashboard.kpi.new"), value: overall.newUnits, color: segmentColors.new },
              { label: t("dashboard.kpi.retention"), value: overall.retentionUnits, color: segmentColors.retention },
            ]}
            center={formatCount(overall.units)}
            centerLabel={t("dashboard.overview.total")}
            label={t("dashboard.overview.compositionTitle")}
          />
        </Section>
        <Section title={t("dashboard.overview.insightsTitle")} description={t("dashboard.overview.insightsBody", { month: monthName })}>
          <div className="grid gap-5">
            <Insight
              label={t("dashboard.overview.topBranch")}
              value={topBranch?.label ?? "—"}
              note={topBranch ? t("dashboard.unitsCount", { n: formatCount(topBranch.units) }) : t("dashboard.noSalesYet")}
              color={palette.green700}
            />
            <Insight
              label={t("dashboard.overview.topProduct")}
              value={topProduct?.label ?? "—"}
              note={topProduct ? t("dashboard.unitsCount", { n: formatCount(topProduct.units) }) : t("dashboard.noSalesYet")}
              color={palette.green500}
            />
            <Insight
              label={t("dashboard.overview.targetProgress")}
              value={pct === null ? "—" : `${pct}%`}
              note={target ? t("dashboard.overview.targetNote", { actual: formatCount(month.units), target: formatCount(target) }) : t("dashboard.target.notApplicable")}
              color={band ? bandColors[band] : palette.gray300}
            />
          </div>
        </Section>
      </div>

      <SubmittedStrip submitted={figures.get("submitted_month").units} pending={figures.get("pending").units} onHold={month.onHoldUnits} pendingHref={link("pending")} />
    </DashboardFrame>
  );
}

/** Submitted vs Eligible, side by side (BRD §9.1 — every figure says which it is). */
function SubmittedStrip({ submitted, pending, onHold, pendingHref }: { submitted: number; pending: number; onHold: number; pendingHref: string }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <KpiCard icon={ShoppingBag} label={t("dashboard.kpi.submittedMonth")} value={formatCount(submitted)} note={t("dashboard.definition.submitted")} basis="submitted" size="md" />
      <KpiCard icon={ShoppingBag} label={t("dashboard.kpi.pending")} value={formatCount(pending)} note={t("dashboard.kpi.pendingNote")} basis="submitted" href={pendingHref} size="md" />
      <KpiCard icon={ShoppingBag} label={t("dashboard.kpi.onHold")} value={formatCount(onHold)} note={t("dashboard.kpi.onHoldNote")} size="md" />
    </div>
  );
}

export default function DashboardPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppHeader title={t("dashboard.overview.title")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<DashboardSkeleton />}>
          <Overview searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
