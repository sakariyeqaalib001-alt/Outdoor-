import { AlertTriangle, Info } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { Card, CardContent } from "@/components/ui/card";
import { formatBusinessDateTime, formatDateOnly, formatMonthLabel } from "@/lib/dates";
import { filterQuery, monthKey, parseFilters, PERIOD_LABEL, type Context, type Filters } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { can, getAccess, type Access } from "@/server/auth/access";
import { cleanFilters, getContext, getFilterOptions, type FilterOptions } from "@/server/dashboard/queries";
import { DashboardTabs } from "./parts";
import { FilterBar } from "./filter-bar";

export type Search = Promise<Record<string, string | string[] | undefined>>;
export type Loaded = { access: Access; filters: Filters; ctx: Context; options: FilterOptions; query: string };

/**
 * Loads what every dashboard view needs: access, filters (checked against the user's own lists), the period
 * and settings. Returns null when the user may not see the view.
 */
export async function loadDashboard(searchParams: Search, permission: string | string[] = "dashboard.read"): Promise<Loaded | null> {
  const access = await getAccess();
  if (!can(access, permission)) return null;
  const options = await getFilterOptions(can(access, "dashboard.read"));
  const filters = cleanFilters(parseFilters(await searchParams), options);
  const ctx = await getContext(filters);
  return { access, filters, ctx, options, query: filterQuery(filters) };
}

function periodText(ctx: Context, filters: Filters): string {
  if (ctx.basis === "month" && ctx.from_month && ctx.to_month) {
    const from = formatMonthLabel(monthKey(ctx.from_month));
    const to = formatMonthLabel(monthKey(ctx.to_month));
    return from === to ? from : `${from} – ${to}`;
  }
  const from = formatDateOnly(ctx.from_date);
  const to = formatDateOnly(ctx.to_date);
  return `${t(PERIOD_LABEL[filters.period])}: ${from === to ? from : `${from} – ${to}`}`;
}

/** Tabs, filters and the "what am I looking at" line shared by every dashboard view. */
export function DashboardFrame({
  view,
  loaded,
  description,
  children,
  hideAgentFilter,
}: {
  view: string;
  loaded: Loaded;
  description: string;
  children: React.ReactNode;
  hideAgentFilter?: boolean;
}) {
  const { filters, ctx, options, query } = loaded;
  const scopeKey = ctx.scope === "all" ? "all" : ctx.scope === "team" ? "team" : ctx.scope === "own" ? "own" : "none";
  return (
    <div className="flex flex-col gap-5">
      <DashboardTabs active={view} query={query} salesViews={can(loaded.access, "dashboard.read")} />
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground">{description}</p>
        <FilterBar
          path={view}
          filters={filters}
          cities={options.cities}
          branches={options.branches}
          products={options.products}
          agents={options.agents}
          showAgents={!hideAgentFilter && ctx.scope !== "own" && options.agents.length > 0}
          today={ctx.today}
        />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <span>{t(`dashboard.scope.${scopeKey}`)}</span>
          <span aria-hidden="true">•</span>
          <span>{periodText(ctx, filters)}</span>
          <span aria-hidden="true">•</span>
          <span>{t("dashboard.updated", { time: formatBusinessDateTime(new Date(ctx.generated_at)) })}</span>
        </div>
        <details className="group rounded-lg border border-border bg-white px-4 py-2 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold text-brand-link">
            <Info className="size-4" aria-hidden="true" />
            {t("dashboard.definition.title")}
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
            <li>{t("dashboard.definition.eligibleLong", { day: ctx.cutoff_day })}</li>
            <li>{t("dashboard.definition.submitted")}</li>
            <li>{t("dashboard.definition.revenue")}</li>
            <li>{t("dashboard.definition.periods")}</li>
            <li>{t("dashboard.definition.target", { units: ctx.target_units })}</li>
            <li>{t("dashboard.definition.branch")}</li>
          </ul>
        </details>
      </div>
      {children}
    </div>
  );
}

export function DashboardDenied() {
  return <AccessDenied />;
}

/** Shown when the figures could not be loaded (the message is safe: database codes only). */
export function DashboardError() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <AlertTriangle className="size-10 text-brand-accent" aria-hidden="true" />
        <h2 className="text-xl">{t("dashboard.errorTitle")}</h2>
        <p className="max-w-md text-muted-foreground">{t("dashboard.errorBody")}</p>
      </CardContent>
    </Card>
  );
}
