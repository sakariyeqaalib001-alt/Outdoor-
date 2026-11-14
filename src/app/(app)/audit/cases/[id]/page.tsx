import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBusinessDateTime, formatMonthLabel } from "@/lib/dates";
import { t, type MessageKey } from "@/lib/i18n";
import { monthKeyOf, type SaleStatus } from "@/lib/sales";
import { assignableUsers, getCase } from "@/server/audit/queries";
import { can, getAccess } from "@/server/auth/access";
import { getSessionId } from "@/server/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SaleStatusBadge } from "../../../sales/sales-table";
import { CaseStatusBadge, EventCard, ruleName } from "../../audit-ui";
import { CaseActions } from "../../case-forms";

export const metadata: Metadata = { title: t("audit.caseTitlePage") };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 border-b py-2 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

function historyText(h: { action: string; from_status: string | null; to_status: string | null; assignee: string | null }): string {
  if (h.action === "status") return t("audit.history.status", { from: t(`audit.statuses.${h.from_status}` as MessageKey), to: t(`audit.statuses.${h.to_status}` as MessageKey) });
  if (h.action === "assigned") return h.assignee ? t("audit.history.assigned", { name: h.assignee }) : t("audit.history.unassigned");
  return t(`audit.history.${h.action}` as MessageKey);
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const access = await getAccess();
  if (!can(access, "audit.read")) return <AccessDenied />;
  const { id } = await params;
  const c = UUID.test(id) ? await getCase(id) : null;
  if (!c) return <p className="rounded-lg border bg-white p-6 text-center text-sm text-muted-foreground">{t("audit.errors.notFound")}</p>;
  const isAdmin = access.permissions["audit.manage"] === "all";
  const supabase = await createSupabaseServerClient();
  const me = supabase ? (await getSessionId(supabase))?.userId : undefined;
  // Display only — the database decides (Super Admin, or the Auditor assigned to this case).
  const canAct = isAdmin || (access.permissions["audit.manage"] === "own" && c.assigned_to === me);
  const assignees = isAdmin ? await assignableUsers() : [];

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-xl">{t("audit.caseNo", { no: String(c.case_no) })} · {c.title}</CardTitle>
            <p className="text-sm text-muted-foreground">{ruleName(c.rule_code)}</p>
          </div>
          <CaseStatusBadge status={c.status} />
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl>
            <Row label={t("audit.assignedTo")}>{c.assignee ?? t("audit.unassigned")}</Row>
            <Row label={t("audit.openedAt")}>{formatBusinessDateTime(new Date(c.opened_at))}</Row>
            <Row label={t("audit.lastEvent")}>{formatBusinessDateTime(new Date(c.last_event_at))}</Row>
            {c.outcome ? <Row label={t("audit.outcome")}><CaseStatusBadge status={c.outcome} /></Row> : null}
            <Row label={t("audit.effect")}>{t(`audit.effects.${c.outcome === "confirmed_issue" ? "confirmed" : c.outcome === "false_positive" ? "none" : "hold"}`)}</Row>
          </dl>
          <CaseActions caseId={c.id} status={c.status} assignedTo={c.assigned_to} canAct={canAct} canAssign={isAdmin} assignees={assignees} />
        </CardContent>
      </Card>

      {c.agents.length || c.customers.length ? (
        <Card>
          <CardHeader><CardTitle className="brand-title text-base">{t("audit.linkedTitle")}</CardTitle></CardHeader>
          <CardContent>
            <dl>
              {c.agents.length ? (
                <Row label={t("audit.agents")}>
                  {c.agents.map((a) => (
                    <span key={a.id} className="mr-3 inline-flex items-center gap-2">
                      {a.name}
                      {a.onHold ? <StatusBadge status="onHold" label={t("audit.onHold")} /> : null}
                    </span>
                  ))}
                </Row>
              ) : null}
              {c.customers.length ? <Row label={t("audit.customers")}>{c.customers.map((x) => x.name).join(", ")}</Row> : null}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {c.sales.length ? (
        <Card>
          <CardHeader><CardTitle className="brand-title text-base">{t("audit.salesTitle")}</CardTitle></CardHeader>
          <CardContent className="grid gap-2">
            {c.sales.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2 text-sm last:border-b-0">
                <Link className="font-semibold text-brand-link underline" href={`/sales/${s.id}`}>{s.customer_name}</Link>
                <span className="text-muted-foreground">{s.agent ?? "—"} · {formatMonthLabel(monthKeyOf(s.sale_month))}</span>
                <span className="flex gap-2">
                  <SaleStatusBadge status={s.status as SaleStatus} />
                  {s.audit === "confirmed_issue" ? <StatusBadge status="rejected" label={t("audit.ineligible")} /> : null}
                  {s.audit === "on_hold" ? <StatusBadge status="onHold" label={t("audit.onHold")} /> : null}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {c.events.length ? (
        <section className="grid gap-2">
          <h2 className="text-lg font-semibold">{t("audit.eventsTitle")}</h2>
          {c.events.map((e) => <EventCard key={e.id} event={e} showCase={false} />)}
        </section>
      ) : null}

      <Card>
        <CardHeader><CardTitle className="brand-title text-base">{t("audit.historyTitle")}</CardTitle></CardHeader>
        <CardContent>
          <ol className="grid gap-3">
            {c.history.map((h, i) => (
              <li key={i} className="border-l-2 border-border pl-3 text-sm">
                <div className="font-semibold">{historyText(h)}</div>
                <div className="whitespace-pre-wrap">{h.note}</div>
                <div className="text-xs text-muted-foreground">{h.actor ?? t("audit.system")} · {formatBusinessDateTime(new Date(h.at))}</div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Button asChild variant="outline" className="h-11 justify-self-start md:h-9">
        <Link href="/audit"><ArrowLeft aria-hidden="true" />{t("audit.back")}</Link>
      </Button>
    </div>
  );
}

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <>
      <AppHeader title={t("audit.caseTitlePage")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<Skeleton className="mx-auto h-96 w-full max-w-3xl" />}>
          <Detail params={params} />
        </Suspense>
      </div>
    </>
  );
}
