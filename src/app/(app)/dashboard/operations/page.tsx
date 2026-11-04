import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlarmClock, ClipboardCheck, Copy, PackageCheck, PackageOpen, ShieldAlert, ShoppingBag } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { DashboardDenied, DashboardError, DashboardFrame, loadDashboard, type Search } from "@/components/dashboard/frame";
import { formatCount, KpiCard, Section } from "@/components/dashboard/parts";
import { DashboardSkeleton } from "@/components/dashboard/skeleton";
import { filterQuery } from "@/lib/dashboard";
import { t } from "@/lib/i18n";
import { can } from "@/server/auth/access";
import { getAuditFigures, getFigures, getStock, type AuditFigures, type StockFigure } from "@/server/dashboard/queries";

export const metadata: Metadata = { title: t("nav.dashboardOperations") };

/**
 * Operations (BRD §9.1 audit and stock items; owner's stock cards, D-42): stock received and issued to customers
 * per device, audit figures and sales waiting for approval. Each part shows only to those allowed to see it.
 */
async function Operations({ searchParams }: { searchParams: Search }) {
  const loaded = await loadDashboard(searchParams, ["dashboard.read", "stock.read", "audit.read"]);
  if (!loaded) return <DashboardDenied />;
  const { access, filters } = loaded;
  const seesStock = can(access, "stock.read") && access.permissions["stock.read"] !== "own";
  const seesAudit = can(access, "audit.read");
  const seesSales = can(access, "dashboard.read");

  let stock: StockFigure[] = [];
  let audit: AuditFigures | null = null;
  let pending = 0;
  let submitted = 0;
  try {
    const [s, a, f] = await Promise.all([
      seesStock ? getStock(filters) : Promise.resolve([]),
      seesAudit ? getAuditFigures(filters) : Promise.resolve(null),
      seesSales ? getFigures(filters) : Promise.resolve(null),
    ]);
    stock = s;
    audit = a;
    pending = f?.get("pending").units ?? 0;
    submitted = f?.get("submitted_period").units ?? 0;
  } catch {
    return <DashboardError />;
  }
  const received = stock.some((s) => s.received !== null);

  return (
    <DashboardFrame view="/dashboard/operations" loaded={loaded} description={t("dashboard.operations.description")}>
      {seesStock ? (
        <Section
          title={t("dashboard.operations.stockTitle")}
          description={t(received ? "dashboard.operations.stockBody" : "dashboard.operations.stockTeamBody")}
          action={<Link href="/stock" className="text-sm font-semibold text-brand-link hover:underline">{t("dashboard.operations.openStock")}</Link>}
        >
          {received ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {stock.map((s) => (
                <KpiCard
                  key={`r-${s.item_id}`}
                  icon={PackageCheck}
                  label={t("dashboard.operations.received", { item: s.name })}
                  value={formatCount(s.received ?? 0)}
                  note={t("dashboard.operations.receivedNote")}
                  basis={null}
                  size="md"
                />
              ))}
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            {stock.map((s) => (
              <KpiCard
                key={`i-${s.item_id}`}
                icon={PackageOpen}
                label={t("dashboard.operations.issued", { item: s.name })}
                value={formatCount(s.issued)}
                note={t("dashboard.operations.issuedNote")}
                basis={null}
                size="md"
              />
            ))}
          </div>
        </Section>
      ) : null}

      {seesAudit && audit ? (
        <Section
          title={t("dashboard.operations.auditTitle")}
          description={t("dashboard.operations.auditBody")}
          action={<Link href="/audit" className="text-sm font-semibold text-brand-link hover:underline">{t("dashboard.operations.openAudit")}</Link>}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard icon={Copy} label={t("dashboard.operations.duplicates")} value={formatCount(audit.duplicate_attempts)} note={t("dashboard.operations.duplicatesNote")} basis={null} size="md" />
            <KpiCard icon={ShieldAlert} label={t("dashboard.operations.openCases")} value={formatCount(audit.open_cases)} note={t("dashboard.operations.openCasesNote")} basis={null} href="/audit" size="md" />
            <KpiCard icon={AlarmClock} label={t("dashboard.operations.oldCases")} value={formatCount(audit.older_than_7_days)} note={t("dashboard.operations.oldCasesNote")} basis={null} href="/audit" size="md" />
          </div>
        </Section>
      ) : null}

      {seesSales ? (
        <Section title={t("dashboard.operations.approvalsTitle")} description={t("dashboard.operations.approvalsBody")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <KpiCard icon={ClipboardCheck} label={t("dashboard.kpi.pending")} value={formatCount(pending)} note={t("dashboard.kpi.pendingNote")} basis="submitted" href={`/dashboard/sales${filterQuery(filters, { bucket: "pending" })}`} size="md" />
            <KpiCard icon={ShoppingBag} label={t("dashboard.operations.submittedPeriod")} value={formatCount(submitted)} note={t("dashboard.definition.submitted")} basis="submitted" href={`/dashboard/sales${filterQuery(filters, { bucket: "submitted_period" })}`} size="md" />
          </div>
        </Section>
      ) : null}
    </DashboardFrame>
  );
}

export default function OperationsPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppHeader title={t("dashboard.operations.title")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<DashboardSkeleton />}>
          <Operations searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
