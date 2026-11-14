import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Building2, MapPin, ShoppingBag, Target } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { BarsChart } from "@/components/dashboard/charts";
import { DashboardDenied, DashboardError, DashboardFrame, loadDashboard, type Search } from "@/components/dashboard/frame";
import { BandBadge, Empty, formatCount, KpiCard, Section, TargetBar } from "@/components/dashboard/parts";
import { DashboardSkeleton } from "@/components/dashboard/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { palette } from "@/lib/brand";
import { formatMonthLabel } from "@/lib/dates";
import {
  achievement,
  agentRows,

  cityRows,
  filterQuery,
  monthKey,
  monthPace,
  type Bucket,
  type CityRow,
  type Filters,
} from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";
import { getFigures, getPeople } from "@/server/dashboard/queries";

export const metadata: Metadata = { title: t("nav.dashboardBranches") };

/** Branch Performance (owner's dashboard Part One C; BRD §9.1 city / branch / target progress, D-42). */
async function Branches({ searchParams }: { searchParams: Search }) {
  const loaded = await loadDashboard(searchParams);
  if (!loaded) return <DashboardDenied />;
  const { filters, ctx, options } = loaded;
  let data;
  try {
    const [figures, people] = await Promise.all([getFigures(filters), getPeople(filters)]);
    data = { figures, people };
  } catch {
    return <DashboardError />;
  }
  const { figures, people } = data;
  const nationwide = ctx.scope === "all";
  const targetApplies = !filters.branch_id && !filters.product_id;
  const cities = cityRows(figures, people, options.cities, {
    nationwide,
    cityFilter: filters.city_id,
    targetApplies,
    targetUnits: ctx.target_units,
    baselineUnits: ctx.baseline_units,
  });
  const month = figures.get("month");
  const totalTarget = cities.reduce((s, c) => s + c.target, 0);
  const totalActual = cities.reduce((s, c) => s + c.month.units, 0);
  const totalPct = achievement(totalActual, totalTarget);
  const pace = monthPace(ctx.today);
  const monthName = formatMonthLabel(monthKey(ctx.current_month));
  const showPeriod = filters.period !== "month";

  const branchIds = new Set(figures.list("overall", "branch").map((b) => b.key));
  const branches = options.branches
    .filter((b) => (!filters.city_id || b.city_id === filters.city_id) && (!filters.branch_id || b.id === filters.branch_id))
    .filter((b) => nationwide || branchIds.has(b.id))
    .map((b) => ({
      id: b.id,
      name: b.name,
      city: options.cities.find((c) => c.id === b.city_id)?.name ?? "",
      overall: figures.get("overall", "branch", b.id),
      month: figures.get("month", "branch", b.id),
      period: figures.get("period", "branch", b.id),
    }))
    .sort((a, b) => b.month.units - a.month.units || b.overall.units - a.overall.units || a.name.localeCompare(b.name));

  const agentBucket: Bucket = filters.period === "prev_month" ? "period" : "month";
  const agentMonth = filters.period === "prev_month" && ctx.from_month ? formatMonthLabel(monthKey(ctx.from_month)) : monthName;
  const agents = agentRows(figures, agentBucket, people, { targetUnits: ctx.target_units, baselineUnits: ctx.baseline_units });
  const cityName = (id: string | null) => options.cities.find((c) => c.id === id)?.name ?? "—";
  const withCity = (f: Filters, cityId: string) => `/dashboard/sales${filterQuery({ ...f, city_id: cityId }, { bucket: "month" })}`;

  return (
    <DashboardFrame view="/dashboard/branches" loaded={loaded} description={t("dashboard.branches.description")}>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={MapPin} label={t("dashboard.branches.cities")} value={formatCount(cities.length)} note={cities.map((c) => c.name).join(" · ")} basis={null} />
        <KpiCard icon={Building2} label={t("dashboard.branches.branches")} value={formatCount(branches.length)} note={t("dashboard.branches.branchesNote", { n: branches.filter((b) => b.month.units > 0).length })} basis={null} />
        <KpiCard icon={ShoppingBag} label={t("dashboard.kpi.monthSales")} value={formatCount(month.units)} note={`${monthName} · ${formatUSD(month.revenue)}`} href={`/dashboard/sales${filterQuery(filters, { bucket: "month" })}`} />
        <KpiCard
          icon={Target}
          label={t("dashboard.branches.targetAchieved")}
          value={totalPct === null ? "—" : `${totalPct}%`}
          note={targetApplies ? t("dashboard.overview.targetNote", { actual: formatCount(totalActual), target: formatCount(totalTarget) }) : t("dashboard.target.notApplicable")}
        />
      </div>

      {cities.length === 0 ? (
        <Empty text={t("dashboard.noData")} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {cities.map((c) => (
            <CityCard key={c.id} city={c} monthName={monthName} pace={pace.pct} targetApplies={targetApplies} href={withCity(filters, c.id)} targetUnits={ctx.target_units} />
          ))}
        </div>
      )}

      {cities.length > 1 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t("dashboard.branches.comparisonTitle")} description={t("dashboard.branches.comparisonBody", { month: monthName })}>
            <BarsChart
              data={cities.map((c) => ({ label: c.name, actual: c.month.units, target: c.target }))}
              series={[
                { key: "actual", label: t("dashboard.target.actual"), color: palette.green700 },
                ...(targetApplies ? [{ key: "target", label: t("dashboard.target.target"), color: palette.gray300 }] : []),
              ]}
              label={t("dashboard.branches.comparisonTitle")}
            />
          </Section>
          <Section title={t("dashboard.branches.rankingTitle")} description={t("dashboard.branches.rankingBody")}>
            {targetApplies ? (
              <ol className="grid gap-4">
                {[...cities].sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1)).map((c, i) => (
                  <li key={c.id} className="grid grid-cols-[1.5rem_6rem_1fr_3.5rem] items-center gap-3 text-sm">
                    <span className="font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
                    <span className="truncate font-semibold">{c.name}</span>
                    <TargetBar pct={c.pct} band={c.band} pace={pace.pct} label={`${c.name}: ${c.pct ?? 0}%`} />
                    <span className="text-right font-semibold text-foreground tabular-nums">{c.pct === null ? "—" : `${c.pct}%`}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty text={t("dashboard.target.notApplicable")} />
            )}
            <p className="text-xs text-muted-foreground">{t("dashboard.target.paceLegend", { day: pace.day, days: pace.days })}</p>
          </Section>
        </div>
      ) : null}

      <Section title={t("dashboard.branches.branchTitle")} description={t("dashboard.branches.branchBody")}>
        {branches.length === 0 ? (
          <Empty text={t("dashboard.noData")} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>{t("dashboard.table.branch")}</TableHead>
                <TableHead>{t("dashboard.table.city")}</TableHead>
                <TableHead className="text-right">{t("dashboard.kpi.overallSales")}</TableHead>
                <TableHead className="text-right">{t("dashboard.kpi.overallRevenue")}</TableHead>
                <TableHead className="text-right">{t("dashboard.kpi.monthSales")}</TableHead>
                <TableHead className="text-right">{t("dashboard.kpi.monthRevenue")}</TableHead>
                <TableHead className="text-right">{t("dashboard.kpi.overallNew")}</TableHead>
                <TableHead className="text-right">{t("dashboard.kpi.overallRetention")}</TableHead>
                {showPeriod ? <TableHead className="text-right">{t("dashboard.table.period")}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.map((b, i) => (
                <TableRow key={b.id}>
                  <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                  <TableCell className="font-semibold">
                    <Link href={`/dashboard/branches${filterQuery({ ...filters, branch_id: b.id })}`} className="text-brand-link hover:underline">{b.name}</Link>
                  </TableCell>
                  <TableCell>{b.city}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCount(b.overall.units)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUSD(b.overall.revenue)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatCount(b.month.units)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUSD(b.month.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCount(b.overall.newUnits)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCount(b.overall.retentionUnits)}</TableCell>
                  {showPeriod ? <TableCell className="text-right tabular-nums">{formatCount(b.period.units)}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title={t("dashboard.branches.agentsTitle")}
        description={t("dashboard.branches.agentsBody", { month: agentMonth, target: ctx.target_units, baseline: ctx.baseline_units })}
      >
        {agents.length === 0 ? (
          <Empty text={t("dashboard.noData")} />
        ) : (
          <>
          <ul className="flex flex-wrap gap-x-6 gap-y-2" aria-label={t("dashboard.branches.bandCounts")}>
            {(["met", "baseline", "under"] as const).map((band) => (
              <li key={band} className="flex items-center gap-2 text-sm">
                <BandBadge band={band} />
                <span className="font-semibold text-foreground tabular-nums">{agents.filter((a) => a.band === band).length}</span>
              </li>
            ))}
          </ul>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>{t("dashboard.table.agent")}</TableHead>
                <TableHead>{t("dashboard.table.team")}</TableHead>
                <TableHead>{t("dashboard.table.city")}</TableHead>
                <TableHead className="text-right">{t("dashboard.table.units")}</TableHead>
                <TableHead className="text-right">{t("dashboard.target.target")}</TableHead>
                <TableHead className="w-40">{t("dashboard.table.progress")}</TableHead>
                <TableHead>{t("dashboard.table.band")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.map((a, i) => (
                <TableRow key={a.id}>
                  <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
                  <TableCell className="font-semibold">{a.name}</TableCell>
                  <TableCell>{a.team ?? "—"}</TableCell>
                  <TableCell>{cityName(a.cityId)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatCount(a.units)}</TableCell>
                  <TableCell className="text-right tabular-nums">{a.target ?? "—"}</TableCell>
                  <TableCell>
                    {a.target ? (
                      <div className="flex items-center gap-2">
                        <TargetBar pct={a.pct} band={a.band} label={`${a.name}: ${a.pct ?? 0}%`} />
                        <span className="w-10 text-right text-xs font-semibold tabular-nums">{a.pct ?? 0}%</span>
                      </div>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>{a.band ? <BandBadge band={a.band} /> : t("dashboard.target.noTarget")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </>
        )}
      </Section>
    </DashboardFrame>
  );
}

/** The eight city indicators (owner's dashboard Part One C). */
function CityCard({ city, monthName, pace, targetApplies, href, targetUnits }: { city: CityRow; monthName: string; pace: number; targetApplies: boolean; href: string; targetUnits: number }) {
  const cells: [string, string][] = [
    [t("dashboard.kpi.overallSales"), formatCount(city.overall.units)],
    [t("dashboard.kpi.overallRevenue"), formatUSD(city.overall.revenue)],
    [t("dashboard.kpi.monthSales"), formatCount(city.month.units)],
    [t("dashboard.kpi.monthRevenue"), formatUSD(city.month.revenue)],
    [t("dashboard.kpi.overallNew"), formatCount(city.overall.newUnits)],
    [t("dashboard.kpi.overallRetention"), formatCount(city.overall.retentionUnits)],
  ];
  const band = city.band;
  return (
    <Section
      title={city.name}
      description={t("dashboard.branches.cityBody", { month: monthName })}
      action={<Link href={href} className="text-sm font-semibold text-brand-link hover:underline">{t("dashboard.viewSales")}</Link>}
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        {cells.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="text-base font-semibold text-foreground tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="grid gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span>
            <span className="text-muted-foreground">{t("dashboard.target.monthlyTarget")}: </span>
            <span className="font-semibold tabular-nums">{targetApplies ? formatCount(city.target) : "—"}</span>
          </span>
          <span>
            <span className="text-muted-foreground">{t("dashboard.target.actual")}: </span>
            <span className="font-semibold tabular-nums">{formatCount(city.month.units)}</span>
            <span className="ml-2 font-semibold text-foreground tabular-nums">{city.pct === null ? "—" : `${city.pct}%`}</span>
          </span>
        </div>
        <TargetBar pct={city.pct} band={band} pace={pace} label={`${city.name}: ${city.pct ?? 0}%`} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{targetApplies ? t("dashboard.target.people", { n: city.people, units: targetUnits }) : t("dashboard.target.notApplicable")}</span>
          {band && targetApplies ? <BandBadge band={band} /> : null}
        </div>
      </div>
    </Section>
  );
}

export default function BranchesPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppHeader title={t("dashboard.branches.title")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<DashboardSkeleton />}>
          <Branches searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
