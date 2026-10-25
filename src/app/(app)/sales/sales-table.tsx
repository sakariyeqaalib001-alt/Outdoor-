import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { StatusKey } from "@/lib/brand";
import { formatBusinessDateTime } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";
import type { SaleStatus } from "@/lib/sales";
import type { SaleRow } from "@/server/sales/queries";

export const STATUS_BADGE: Record<SaleStatus, StatusKey> = {
  approved: "approved",
  pending_approval: "pending",
  rejected: "rejected",
  reversed: "reversed",
};

export function SaleStatusBadge({ status }: { status: SaleStatus }) {
  return <StatusBadge status={STATUS_BADGE[status]} label={t(`sales.statuses.${status}`)} />;
}

/** Month totals: approved units and revenue (eligibility rules arrive with audit/refunds in Phases 9 and 12). */
export function SalesTotals({ sales }: { sales: SaleRow[] }) {
  const approved = sales.filter((s) => s.status === "approved");
  const cards = [
    { label: t("sales.units"), value: String(approved.length) },
    { label: t("sales.pending"), value: String(sales.filter((s) => s.status === "pending_approval").length) },
    { label: t("sales.revenue"), value: formatUSD(approved.reduce((sum, s) => sum + s.amount_collected, 0)) },
    { label: t("sales.freeMonths"), value: String(sales.filter((s) => s.free_month && s.status !== "rejected").length) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="pt-5">
            <div className="text-sm text-muted-foreground">{c.label}</div>
            <div className="text-2xl font-semibold tabular-nums">{c.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function SalesTable({ sales, agentNames }: { sales: SaleRow[]; agentNames?: Record<string, string> }) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("sales.when")}</TableHead>
            <TableHead>{t("sales.customer")}</TableHead>
            <TableHead>{t("sales.index")}</TableHead>
            <TableHead>{t("sales.plan")}</TableHead>
            <TableHead>{t("sales.type")}</TableHead>
            <TableHead>{t("sales.branch")}</TableHead>
            {agentNames ? <TableHead>{t("sales.agent")}</TableHead> : null}
            <TableHead className="text-right">{t("sales.amount")}</TableHead>
            <TableHead>{t("sales.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sales.length === 0 ? (
            <TableRow>
              <TableCell colSpan={agentNames ? 9 : 8} className="py-10 text-center text-muted-foreground">{t("sales.noSales")}</TableCell>
            </TableRow>
          ) : (
            sales.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="whitespace-nowrap tabular-nums">
                  <Link href={`/sales/${s.id}`} className="font-semibold text-brand-link underline-offset-2 hover:underline">
                    {formatBusinessDateTime(new Date(s.submitted_at))}
                  </Link>
                </TableCell>
                <TableCell>{s.customer_name}</TableCell>
                <TableCell className="font-mono text-sm tabular-nums">{s.index ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {s.product} · {s.plan}
                  {s.free_month ? <Badge variant="secondary" className="ml-2">{t("sales.freeMonthBadge")}</Badge> : null}
                </TableCell>
                <TableCell>{t(`sales.types.${s.customer_type}`)}</TableCell>
                <TableCell>{s.branch}</TableCell>
                {agentNames ? <TableCell>{agentNames[s.agent_id] ?? "—"}</TableCell> : null}
                <TableCell className="text-right tabular-nums">{formatUSD(s.amount_collected)}</TableCell>
                <TableCell><SaleStatusBadge status={s.status} /></TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
