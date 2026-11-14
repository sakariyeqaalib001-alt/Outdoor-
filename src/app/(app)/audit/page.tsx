import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CASE_STATUSES, type CaseStatus } from "@/lib/audit";
import { formatBusinessDateTime } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { emailSummary, listCases } from "@/server/audit/queries";
import { can, getAccess } from "@/server/auth/access";
import { AuditTabs, CaseStatusBadge, FilterChips, ruleName } from "./audit-ui";
import { EmailBox, NewCaseButton } from "./case-forms";

export const metadata: Metadata = { title: t("nav.audit") };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Audit cases (FR-AUD-03…07): open and under-review first; Super Admin opens cases by hand and sees the email queue. */
async function Cases({ searchParams }: { searchParams: Search }) {
  const access = await getAccess();
  if (!can(access, "audit.read")) return <AccessDenied />;
  const params = await searchParams;
  const filter = typeof params.status === "string" && (["all", ...CASE_STATUSES] as string[]).includes(params.status) ? params.status : "active";
  const isAdmin = access.permissions["audit.manage"] === "all";
  const [cases, email] = await Promise.all([
    listCases(filter === "all" ? undefined : (filter as CaseStatus | "active")),
    isAdmin ? emailSummary() : Promise.resolve(null),
  ]);
  const chips = [
    { key: "active", href: "/audit", label: t("audit.filterActive") },
    ...CASE_STATUSES.map((s) => ({ key: s, href: `/audit?status=${s}`, label: t(`audit.statuses.${s}`) })),
    { key: "all", href: "/audit?status=all", label: t("audit.filterAll") },
  ];

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t("audit.intro")}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterChips items={chips} active={filter} />
        {isAdmin ? <NewCaseButton /> : null}
      </div>
      {email ? <EmailBox summary={email} /> : null}
      {cases.length === 0 ? (
        <p className="rounded-lg border bg-white p-6 text-center text-sm text-muted-foreground">{t("audit.noCases")}</p>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table className="min-w-[760px] [&_td]:px-4 [&_th]:px-4">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("audit.case")}</TableHead>
                  <TableHead>{t("audit.rule")}</TableHead>
                  <TableHead>{t("audit.status")}</TableHead>
                  <TableHead>{t("audit.assignedTo")}</TableHead>
                  <TableHead className="text-right">{t("audit.eventsCount")}</TableHead>
                  <TableHead>{t("audit.lastEvent")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Link className="font-semibold text-brand-link underline" href={`/audit/cases/${c.id}`}>#{c.case_no}</Link>
                      <span className="block max-w-[16rem] truncate text-xs text-muted-foreground">{c.title}</span>
                    </TableCell>
                    <TableCell>{ruleName(c.rule_code)}</TableCell>
                    <TableCell><CaseStatusBadge status={c.status} /></TableCell>
                    <TableCell>{c.assignee ?? "—"}</TableCell>
                    <TableCell className="text-right">{c.events}</TableCell>
                    <TableCell>{formatBusinessDateTime(new Date(c.last_event_at))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function AuditPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppHeader title={t("audit.title")} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <AuditTabs />
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Cases searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
