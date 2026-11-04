import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { bandColors } from "@/lib/brand";
import { BAND_LABEL, VIEWS, type Band } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Building blocks of the dashboard views (Phase 10). Server components; charts live in charts.tsx. */

const numberFormat = new Intl.NumberFormat("en-US");
export const formatCount = (n: number) => numberFormat.format(n);

/** Which figures a number is: Eligible (BRD §8.2) or Submitted (everything not rejected). Always labelled (BRD §9.1). */
export function BasisTag({ basis }: { basis: "eligible" | "submitted" }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-semibold",
        basis === "eligible" ? "border-brand-highlight/40 text-brand-link" : "border-border text-muted-foreground"
      )}
      title={t(basis === "eligible" ? "dashboard.definition.eligible" : "dashboard.definition.submitted")}
    >
      {t(basis === "eligible" ? "dashboard.basis.eligible" : "dashboard.basis.submitted")}
    </span>
  );
}

/** A KPI card: icon, label, big figure, one line of context. The whole card links to the sales behind it. */
export function KpiCard({
  icon: Icon,
  label,
  value,
  note,
  href,
  basis = "eligible",
  size = "lg",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  note?: React.ReactNode;
  href?: string;
  basis?: "eligible" | "submitted" | null;
  size?: "lg" | "md";
}) {
  const body = (
    <Card className="h-full gap-3 p-5 ring-border transition-shadow group-hover/kpi:shadow-md group-hover/kpi:ring-brand-highlight/60">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-brand-link" aria-hidden="true">
          <Icon className="size-4.5" />
        </span>
        <p className="min-w-0 flex-1 pt-1.5 text-sm font-semibold text-muted-foreground">{label}</p>
        {basis ? <BasisTag basis={basis} /> : null}
      </div>
      <p className={cn("font-semibold tracking-tight text-brand-link tabular-nums", size === "lg" ? "text-3xl" : "text-2xl")}>{value}</p>
      {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
    </Card>
  );
  if (!href) return body;
  return (
    <Link href={href} className="group/kpi block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none" aria-label={`${label}: ${value}`}>
      {body}
    </Link>
  );
}

/** A titled card section (lowercase brand title, short description, optional action at the right). */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("gap-4 p-5 ring-border", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg text-brand-link">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function BandBadge({ band }: { band: Band }) {
  const color = bandColors[band];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {t(BAND_LABEL[band])}
    </span>
  );
}

/** Target progress bar with the band colour and a marker for how far through the month we are. */
export function TargetBar({ pct, band, pace, label }: { pct: number | null; band: Band | null; pace?: number; label: string }) {
  const width = Math.min(pct ?? 0, 100);
  return (
    <div className="relative h-2.5 w-full rounded-full bg-muted" role="img" aria-label={label}>
      <div
        className="h-full rounded-full"
        style={{ width: `${width}%`, backgroundColor: band ? bandColors[band] : undefined }}
      />
      {pace !== undefined ? (
        <span
          className="absolute -top-1 h-4.5 w-0.5 rounded bg-foreground/70"
          style={{ left: `calc(${Math.min(pace, 100)}% - 1px)` }}
          title={t("dashboard.target.paceHint", { pct: pace })}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

/** Tabs between the dashboard views; links keep the current filters. */
export function DashboardTabs({ active, query, salesViews = true }: { active: string; query: string; salesViews?: boolean }) {
  return (
    <nav aria-label={t("dashboard.views")} className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 md:mx-0 md:px-0">
      {VIEWS.filter((v) => salesViews || v.href === "/dashboard/operations").map((v) => {
        const on = v.href === active;
        return (
          <Link
            key={v.href}
            href={`${v.href}${query}`}
            aria-current={on ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-semibold",
              on ? "border-brand-highlight text-brand-link" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t(v.label)}
          </Link>
        );
      })}
    </nav>
  );
}

/** Empty state for a section with nothing to show yet. */
export function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{text}</p>;
}

/** A label + value line used in insight panels. */
export function Insight({ label, value, note, color }: { label: string; value: string; note?: string; color: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
        </div>
        <p className="shrink-0 text-right font-semibold text-brand-link">{value}</p>
      </div>
    </div>
  );
}
