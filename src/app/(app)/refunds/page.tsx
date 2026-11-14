import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBusinessDateTime, formatMonthLabel } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, getAccess } from "@/server/auth/access";
import { getSessionId } from "@/server/auth/session";
import { listRefunds, type RefundRow } from "@/server/refunds/queries";
import { DecideRefund, RefundStatusBadge } from "./refund-ui";

export const metadata: Metadata = { title: t("nav.refunds") };

const month = (iso: string) => formatMonthLabel(iso.slice(0, 7));

function Equipment({ row }: { row: RefundRow }) {
  if (row.equipment.length === 0) return <span className="text-muted-foreground">{t("refunds.equipmentNone")}</span>;
  return (
    <>
      {row.equipment.map((e) => (
        <span key={e.item} className="block whitespace-nowrap">
          {t("refunds.equipmentLine", { item: e.item, returned: String(e.returned), given: String(e.given) })}
        </span>
      ))}
    </>
  );
}

function Customer({ row }: { row: RefundRow }) {
  return (
    <>
      <Link href={`/sales/${row.sale_id}`} className="font-semibold text-brand-link underline">{row.customer_name}</Link>
      <span className="block text-xs text-muted-foreground">{`${row.product} · ${row.branch}`}</span>
    </>
  );
}

function Reason({ row }: { row: RefundRow }) {
  return (
    <>
      {t(`refunds.reasons.${row.reason}`)}
      {row.note ? <span className="block text-xs text-muted-foreground">{row.note}</span> : null}
    </>
  );
}

function Amount({ row }: { row: RefundRow }) {
  return (
    <>
      <span className="font-semibold">{formatUSD(row.amount)}</span>
      <span className="block text-xs text-muted-foreground">{`${t("refunds.collected")}: ${formatUSD(row.amount_collected)}`}</span>
    </>
  );
}

async function Refunds() {
  const supabase = await createSupabaseServerClient();
  const [access, ids] = await Promise.all([getAccess(), supabase ? getSessionId(supabase) : null]);
  if (!can(access, ["refunds.submit", "refunds.approve"])) return <AccessDenied />;
  const decides = access.permissions["refunds.approve"] === "all";
  const me = ids?.userId ?? "";
  const { waiting, decided } = await listRefunds();

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4">
      <p className="text-sm text-muted-foreground">{t("refunds.intro")}</p>
      {can(access, "refunds.submit") ? (
        <p className="rounded-lg border bg-white p-4 text-sm">
          {t("refunds.howTo")}{" "}
          <Link href="/sales" className="font-semibold text-brand-link underline">{t("refunds.goToSales")}</Link>
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="brand-title text-lg">{t("refunds.waiting")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("refunds.requested")}</TableHead>
                <TableHead>{t("refunds.customer")}</TableHead>
                <TableHead className="text-right">{t("refunds.amount")}</TableHead>
                <TableHead>{t("refunds.reason")}</TableHead>
                <TableHead>{t("refunds.agent")}</TableHead>
                <TableHead>{t("refunds.requestedBy")}</TableHead>
                <TableHead className="w-48"><span className="sr-only">{t("refunds.decision")}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {waiting.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t("refunds.noneWaiting")}</TableCell>
                </TableRow>
              ) : (
                waiting.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatBusinessDateTime(new Date(r.requested_at))}</TableCell>
                    <TableCell><Customer row={r} /></TableCell>
                    <TableCell className="text-right tabular-nums"><Amount row={r} /></TableCell>
                    <TableCell className="max-w-56"><Reason row={r} /></TableCell>
                    <TableCell>{r.agent}</TableCell>
                    <TableCell>{r.requester}</TableCell>
                    <TableCell>
                      {!decides ? (
                        <RefundStatusBadge status="pending" />
                      ) : r.requested_by === me || r.agent_id === me ? (
                        <span className="block max-w-48 text-right text-xs text-muted-foreground">{t("refunds.ownRequest")}</span>
                      ) : (
                        <DecideRefund id={r.id} />
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="brand-title text-lg">{t("refunds.history")}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("refunds.requested")}</TableHead>
                <TableHead>{t("refunds.customer")}</TableHead>
                <TableHead className="text-right">{t("refunds.amount")}</TableHead>
                <TableHead>{t("refunds.reason")}</TableHead>
                <TableHead>{t("refunds.status")}</TableHead>
                <TableHead>{t("refunds.decision")}</TableHead>
                <TableHead>{t("refunds.equipment")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {decided.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{t("refunds.noneDecided")}</TableCell>
                </TableRow>
              ) : (
                decided.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatBusinessDateTime(new Date(r.requested_at))}
                      <span className="block text-xs text-muted-foreground">{r.requester}</span>
                    </TableCell>
                    <TableCell><Customer row={r} /></TableCell>
                    <TableCell className="text-right tabular-nums"><Amount row={r} /></TableCell>
                    <TableCell className="max-w-56"><Reason row={r} /></TableCell>
                    <TableCell><RefundStatusBadge status={r.status} /></TableCell>
                    <TableCell className="max-w-64">
                      <span className="block">{r.decider ?? "—"}</span>
                      {r.decided_at ? <span className="block text-xs text-muted-foreground tabular-nums">{formatBusinessDateTime(new Date(r.decided_at))}</span> : null}
                      {r.decision_note ? <span className="block text-xs text-muted-foreground">{r.decision_note}</span> : null}
                      {r.counting_month ? (
                        <span className="block text-xs text-muted-foreground">
                          {r.payroll_effect === "adjustment"
                            ? t("refunds.payrollAdjustment", { month: month(r.counting_month) })
                            : t("refunds.payrollExcluded", { month: month(r.counting_month) })}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{r.status === "approved" ? <Equipment row={r} /> : "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function RefundsPage() {
  return (
    <>
      <AppHeader title={t("refunds.title")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<Skeleton className="mx-auto h-96 w-full max-w-6xl" />}>
          <Refunds />
        </Suspense>
      </div>
    </>
  );
}
