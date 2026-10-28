import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { FormMessage } from "@/components/auth/form-message";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBusinessDateTime, formatMonthLabel } from "@/lib/dates";
import { t, type MessageKey } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";
import { monthKeyOf } from "@/lib/sales";
import { listDecisions } from "@/server/approvals/queries";
import { saleAuditCases } from "@/server/audit/queries";
import { can, getAccess } from "@/server/auth/access";
import { CaseStatusBadge } from "../../audit/audit-ui";
import { NewCaseButton } from "../../audit/case-forms";
import { getSale } from "@/server/sales/queries";
import { SaleStatusBadge } from "../sales-table";

export const metadata: Metadata = { title: t("sales.detailTitle") };

const SAVED: Record<string, MessageKey> = { approved: "sales.saved", pending: "sales.savedPending", existing: "sales.alreadySaved" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr] gap-3 border-b py-2 text-sm last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}

async function Detail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const sale = UUID.test(id) ? await getSale(id) : null;
  if (!sale) return <p className="rounded-lg border bg-white p-6 text-center text-muted-foreground">{t("sales.notFound")}</p>;
  const saved = typeof query.saved === "string" ? SAVED[query.saved] : undefined;
  const [decisions, access] = await Promise.all([listDecisions("sales", sale.id), getAccess()]);
  // Audit cases about this sale (Phase 9): visible to audit.read holders only (RLS); Super Admin may open one.
  const auditCases = can(access, "audit.read") ? await saleAuditCases(sale.id) : [];
  const canOpenCase = access.permissions["audit.manage"] === "all";

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-4">
      {saved ? <FormMessage notice={t(saved)} /> : null}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-xl">{sale.customer_name}</CardTitle>
          <div className="flex flex-wrap gap-2">
            {sale.free_month ? <Badge variant="secondary">{t("sales.freeMonthBadge")}</Badge> : null}
            <SaleStatusBadge status={sale.status} />
          </div>
        </CardHeader>
        <CardContent>
          <dl>
            <Row label={t("sales.type")}>{t(`sales.types.${sale.customer_type}`)}</Row>
            <Row label={t("sales.phone")}>{sale.phone ?? "—"}</Row>
            <Row label={t("sales.index")}>{sale.index ?? "—"}</Row>
            <Row label={t("sales.plan")}>{sale.product} · {sale.plan}</Row>
            <Row label={t("sales.recharge")}>{formatUSD(sale.unit_price)}</Row>
            <Row label={t("sales.months")}>{sale.months_paid}</Row>
            <Row label={t("sales.installation")}>{formatUSD(sale.installation_fee)}</Row>
            <Row label={t("sales.amountCollected")}>{formatUSD(sale.amount_collected)}</Row>
            <Row label={t("sales.location")}>{`${sale.city} · ${sale.district} · ${sale.area_text}`}</Row>
            <Row label={t("sales.branch")}>{sale.branch}</Row>
            <Row label={t("sales.items")}>{sale.items.length ? sale.items.map((i) => `${i.quantity} × ${i.name}`).join(", ") : t("sales.noItems")}</Row>
            <Row label={t("sales.agent")}>{sale.agent ?? "—"}</Row>
            <Row label={t("sales.submittedAt")}>{formatBusinessDateTime(new Date(sale.submitted_at))}</Row>
            <Row label={t("sales.saleMonth")}>{formatMonthLabel(monthKeyOf(sale.sale_month))}</Row>
            {sale.approved_at ? <Row label={t("sales.approvedAt")}>{formatBusinessDateTime(new Date(sale.approved_at))}</Row> : null}
            {decisions.length ? (
              <Row label={t("sales.decisions")}>
                {decisions.map((d) => (
                  <span key={d.decided_at} className="block">
                    {d.decision === "approved" ? t("sales.decisionApproved", { by: d.by ?? "—" }) : t("sales.decisionRejected", { by: d.by ?? "—", reason: d.reason ?? "" })}
                    <span className="block text-xs font-normal text-muted-foreground">{formatBusinessDateTime(new Date(d.decided_at))}</span>
                  </span>
                ))}
              </Row>
            ) : null}
            {auditCases.length ? (
              <Row label={t("audit.saleCases")}>
                {auditCases.map((c) => (
                  <Link key={c.id} href={`/audit/cases/${c.id}`} className="mr-3 inline-flex items-center gap-2 text-brand-link underline">
                    {t("audit.caseNo", { no: String(c.case_no) })}
                    <CaseStatusBadge status={c.outcome && c.status === "resolved" ? c.outcome : c.status} />
                  </Link>
                ))}
              </Row>
            ) : null}
          </dl>
        </CardContent>
      </Card>
      {canOpenCase ? <NewCaseButton saleId={sale.id} label={t("audit.openCaseForSale")} /> : null}
      <Button asChild variant="outline" className="h-11 justify-self-start">
        <Link href={`/sales?month=${monthKeyOf(sale.sale_month)}`}><ArrowLeft aria-hidden="true" />{t("sales.back")}</Link>
      </Button>
    </div>
  );
}

export default function SaleDetailPage(props: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <>
      <AppHeader title={t("sales.detailTitle")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<Skeleton className="mx-auto h-96 w-full max-w-2xl" />}>
          <Detail params={props.params} searchParams={props.searchParams} />
        </Suspense>
      </div>
    </>
  );
}
