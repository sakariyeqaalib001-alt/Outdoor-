import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { businessToday, formatBusinessDateTime } from "@/lib/dates";
import { t, type MessageKey } from "@/lib/i18n";
import { getReport, getStockContext, listMovements, namesOf } from "@/server/stock/queries";
import { StockShell } from "../stock-shell";

export const metadata: Metadata = { title: t("stock.tabHistory") };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const COLUMNS: [keyof Awaited<ReturnType<typeof getReport>>[number], MessageKey][] = [
  ["opening", "stock.opening"],
  ["received", "stock.received"],
  ["transferred_in", "stock.transferredIn"],
  ["transferred_out", "stock.transferredOut"],
  ["issued", "stock.issued"],
  ["returned_in", "stock.returnedIn"],
  ["returned_out", "stock.returnedOut"],
  ["adjusted", "stock.adjusted"],
  ["closing", "stock.closing"],
];

async function History({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const today = businessToday();
  const from = typeof params.from === "string" && DATE.test(params.from) ? params.from : `${today.slice(0, 8)}01`;
  const to = typeof params.to === "string" && DATE.test(params.to) && params.to >= from ? params.to : today;

  const [{ items, locations }, report, movements] = await Promise.all([getStockContext(), getReport(from, to), listMovements()]);
  const names = await namesOf(movements.map((m) => m.actor_id));
  const itemName = Object.fromEntries(items.map((i) => [i.id, i.display_name]));
  const locationLabel = Object.fromEntries(locations.map((l) => [l.id, l.label]));
  const order = Object.fromEntries(locations.map((l, i) => [l.id, i]));
  const rows = [...report].sort((a, b) => (order[a.location_id] ?? 99) - (order[b.location_id] ?? 99) || (itemName[a.item_id] ?? "").localeCompare(itemName[b.item_id] ?? ""));

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="brand-title text-lg">{t("stock.report")}</CardTitle>
          <CardDescription>{t("stock.reportIntro")}</CardDescription>
          <form className="flex flex-wrap items-end gap-3 pt-2">
            <div className="space-y-1">
              <Label htmlFor="from">{t("stock.dateFrom")}</Label>
              <Input id="from" name="from" type="date" defaultValue={from} className="h-11 md:h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to">{t("stock.dateTo")}</Label>
              <Input id="to" name="to" type="date" defaultValue={to} className="h-11 md:h-9" />
            </div>
            <Button type="submit" variant="outline" className="h-11 md:h-9">{t("stock.show")}</Button>
          </form>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("stock.location")}</TableHead>
                <TableHead>{t("stock.item")}</TableHead>
                {COLUMNS.map(([key, label]) => (
                  <TableHead key={key} className="text-right">{t(label)}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length + 2} className="py-10 text-center text-muted-foreground">{t("stock.noStock")}</TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={`${r.location_id}-${r.item_id}`}>
                    <TableCell className="font-semibold">{locationLabel[r.location_id]}</TableCell>
                    <TableCell>{itemName[r.item_id]}</TableCell>
                    {COLUMNS.map(([key]) => (
                      <TableCell key={key} className={`text-right tabular-nums ${key === "closing" ? "font-semibold" : ""}`}>{r[key]}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="brand-title text-lg">{t("stock.history")}</CardTitle>
          <CardDescription>{t("stock.historyIntro")}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("stock.when")}</TableHead>
                <TableHead>{t("stock.type")}</TableHead>
                <TableHead>{t("stock.item")}</TableHead>
                <TableHead className="text-right">{t("stock.quantity")}</TableHead>
                <TableHead>{t("stock.from")}</TableHead>
                <TableHead>{t("stock.location")}</TableHead>
                <TableHead>{t("stock.reason")}</TableHead>
                <TableHead>{t("stock.by")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">{t("stock.noMovements")}</TableCell>
                </TableRow>
              ) : (
                movements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatBusinessDateTime(new Date(m.occurred_at))}</TableCell>
                    <TableCell>{t(`stock.types.${m.movement_type as "receipt"}`)}</TableCell>
                    <TableCell>{itemName[m.item_id] ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{m.quantity}</TableCell>
                    <TableCell>{m.from_location_id ? locationLabel[m.from_location_id] : "—"}</TableCell>
                    <TableCell>{m.to_location_id ? locationLabel[m.to_location_id] : "—"}</TableCell>
                    <TableCell className="max-w-56 text-muted-foreground">{m.reason}</TableCell>
                    <TableCell>{m.actor_id ? names[m.actor_id] ?? "—" : "—"}</TableCell>
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

export default function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return (
    <StockShell>
      <History searchParams={searchParams} />
    </StockShell>
  );
}
