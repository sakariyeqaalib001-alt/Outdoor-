import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { PageTabs } from "@/components/page-tabs";
import { Badge } from "@/components/ui/badge";
import { ATTEMPT_FIELDS, CASE_BADGE, formatAttemptValue, isRuleCode, type CaseStatus } from "@/lib/audit";
import { formatBusinessDateTime } from "@/lib/dates";
import { t, type MessageKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { EventRow } from "@/server/audit/queries";

export function AuditTabs() {
  return (
    <PageTabs
      label="nav.audit"
      tabs={[
        { href: "/audit", label: "audit.tabCases" },
        { href: "/audit/events", label: "audit.tabEvents" },
        { href: "/audit/rules", label: "audit.tabRules" },
      ]}
    />
  );
}

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  return <StatusBadge status={CASE_BADGE[status]} label={t(`audit.statuses.${status}`)} />;
}

export function ruleName(code: string | null): string {
  if (!code) return t("audit.manualCase");
  return isRuleCode(code) ? t(`audit.rules.${code}.name` as MessageKey) : code;
}

export function ruleExplain(code: string): string {
  return isRuleCode(code) ? t(`audit.rules.${code}.explain` as MessageKey) : "";
}

/** Link chips used as filters (server-rendered, no client code). */
export function FilterChips({ items, active }: { items: { href: string; label: string; key: string }[]; active: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          aria-current={i.key === active ? "page" : undefined}
          className={cn(
            "rounded-full border px-3 py-1 text-sm font-semibold",
            i.key === active ? "border-brand-highlight bg-white text-brand-link" : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          {i.label}
        </Link>
      ))}
    </div>
  );
}

/** One audit event: the rule and why it fired, what was attempted, the matching record, who and when, and its case (FR-AUD-03). */
export function EventCard({ event, showCase = true }: { event: EventRow; showCase?: boolean }) {
  const values = Object.entries(event.attempted_values ?? {}).filter(([k]) => k !== "items");
  const saleId = typeof event.context?.sale_id === "string" ? event.context.sale_id : event.matched_entity_type === "sales" ? event.matched_entity_id : null;
  return (
    <div className="grid gap-2 rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{ruleName(event.rule_code)}</span>
            <Badge variant="outline">{t(`audit.severity.${event.severity}` as MessageKey)}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{ruleExplain(event.rule_code)}</p>
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">{event.actor ?? t("audit.system")}</div>
          <div className="text-muted-foreground">{formatBusinessDateTime(new Date(event.occurred_at))}</div>
        </div>
      </div>
      {values.length ? (
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,10rem)_1fr]">
          {values.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{ATTEMPT_FIELDS[k] ? t(ATTEMPT_FIELDS[k]) : k}</dt>
              <dd className="font-semibold break-words">{formatAttemptValue(v)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        {event.matched_customer ? <span>{t("audit.matchedCustomer", { name: event.matched_customer })}</span> : null}
        {saleId ? <Link className="font-semibold text-brand-link underline" href={`/sales/${saleId}`}>{t("audit.openSale")}</Link> : null}
        {showCase ? (
          event.case_id ? (
            <Link className="inline-flex items-center gap-2 font-semibold text-brand-link underline" href={`/audit/cases/${event.case_id}`}>
              {t("audit.caseNo", { no: String(event.case_no) })}
              {event.case_status ? <CaseStatusBadge status={event.case_status} /> : null}
            </Link>
          ) : (
            <span className="text-muted-foreground">{t("audit.noCase")}</span>
          )
        ) : null}
      </div>
    </div>
  );
}
