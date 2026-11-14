import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { businessToday, formatBusinessDateTime, formatDateOnly } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { linesText } from "@/lib/stock";
import {
  getReport,
  getStockContext,
  listMovements,
  listMovementsBetween,
  listTransfersBetween,
  namesOf,
  type StockItem,
} from "@/server/stock/queries";
import { StockShell } from "../stock-shell";

export const metadata: Metadata = { title: t("stock.tabHistory") };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** "3 WiFi Router · 2 PDCOM" — per-item totals shown above a list. */
function Totals({ items, totals }: { items: StockItem[]; totals: Record<string, number> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <span key={i.id} className="rounded-md border bg-white px-3 py-1.5 text-sm">
          <span className="text-base font-semibold tabular-nums">{totals[i.id] ?? 0}</span> {i.display_name}
        </span>
      ))}
    </div>
  );
}

async function History({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const today = businessToday();
  const from = typeof params.from === "string" && DATE.test(params.from) ? params.from : `${today.slice(0, 8)}01`;
  const to = typeof params.to === "string" && DATE.test(params.to) && params.to >= from ? params.to : today;

  const [{ items, locations }, report, receivedRows, issuedRows, movements] = await Promise.all([
    getStockContext(),
    getReport(from, to),
    listMovementsBetween(from, to, ["receipt", "return"]),
    listTransfersBetween(from, to),
    listMovements(),
  ]);
  const names = await namesOf([...movements, ...receivedRows].map((m) => m.actor_id));
  const itemName = Object.fromEntries(items.map((i) => [i.id, i.display_name]));
  const locationById = Object.fromEntries(locations.map((l) => [l.id, l]));
  const label = (id: string | null) => (id ? locationById[id]?.label ?? "—" : "—");

  // Totals per item for the chosen dates.
  const perItem = (pick: (itemId: string) => number) => Object.fromEntries(items.map((i) => [i.id, pick(i.id)]));
  const fromSupplier = perItem((id) => sum(receivedRows.filter((m) => m.movement_type === "receipt" && m.item_id === id).map((m) => m.quantity)));
  const returned = perItem((id) => sum(receivedRows.filter((m) => m.movement_type === "return" && m.item_id === id).map((m) => m.quantity)));
  const receivedTotal = perItem((id) => fromSupplier[id] + returned[id]);
  const liveIssues = issuedRows.filter((tr) => tr.status !== "cancelled");
  const issuedTotal = perItem((id) => sum(liveIssues.flatMap((tr) => tr.lines).filter((l) => l.item_id === id).map((l) => l.quantity)));
  const usedOnSales = perItem((id) => sum(report.filter((r) => r.item_id === id).map((r) => r.issued)));
  const adjusted = perItem((id) => sum(report.filter((r) => r.item_id === id).map((r) => r.adjusted)));
  // Whole-company totals: moves between our own stores (issues to Supervisors, team returns) cancel out,
  // so end = start + from supplier + returned by customers − given to customers ± adjustments.
  const fromCustomers = perItem((id) =>
    sum(receivedRows.filter((m) => m.movement_type === "return" && !m.from_location_id && m.item_id === id).map((m) => m.quantity))
  );
  const startStock = perItem((id) => sum(report.filter((r) => r.item_id === id).map((r) => r.opening)));
  const endStock = perItem((id) => sum(report.filter((r) => r.item_id === id).map((r) => r.closing)));
  const faultyEnd = perItem((id) =>
    sum(report.filter((r) => r.item_id === id && locationById[r.location_id]?.kind === "faulty").map((r) => r.closing))
  );
  const showAdjusted = items.some((i) => adjusted[i.id] !== 0);
  const showFaulty = items.some((i) => faultyEnd[i.id] !== 0);

  const summary: { key: string; label: string; values: Record<string, number>; strong?: boolean; muted?: boolean }[] = [
    { key: "start", label: t("stock.sumStart", { date: formatDateOnly(from) }), values: startStock, strong: true },
    { key: "supplier", label: t("stock.sumFromSupplier"), values: fromSupplier },
    { key: "returned", label: t("stock.sumReturned"), values: fromCustomers },
    { key: "used", label: t("stock.sumUsed"), values: usedOnSales },
    ...(showAdjusted ? [{ key: "adjusted", label: t("stock.sumAdjusted"), values: adjusted }] : []),
    { key: "end", label: t("stock.sumEnd", { date: formatDateOnly(to) }), values: endStock, strong: true },
    ...(showFaulty ? [{ key: "faulty", label: t("stock.sumFaulty"), values: faultyEnd, muted: true }] : []),
    { key: "issued", label: t("stock.sumIssued"), values: issuedTotal, muted: true },
  ];

  const shownLocations = locations.filter((l) => report.some((r) => r.location_id === l.id && (r.closing !== 0 || r.in_transit !== 0)));
  const cell = (loc: string, item: string) => report.find((r) => r.location_id === loc && r.item_id === item);

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="brand-title text-base">{t("stock.report")}</CardTitle>
          <CardDescription>{t("stock.reportIntro", { from: formatDateOnly(from), to: formatDateOnly(to) })}</CardDescription>
          <form className="flex flex-wrap items-end gap-3 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="from">{t("stock.dateFrom")}</Label>
              <Input id="from" name="from" type="date" defaultValue={from} className="h-11 md:h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="to">{t("stock.dateTo")}</Label>
              <Input id="to" name="to" type="date" defaultValue={to} className="h-11 md:h-9" />
            </div>
            <Button type="submit" variant="outline" className="h-11 md:h-9">{t("stock.show")}</Button>
          </form>
        </CardHeader>
        <CardContent className="-mb-4 overflow-x-auto border-t px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                {items.map((i) => (
                  <TableHead key={i.id} className="text-right">{i.display_name}</TableHead>
                ))}
                <TableHead className="text-right">{t("stock.total")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.map((row) => (
                <TableRow key={row.key} className={row.strong ? "bg-muted/50" : undefined}>
                  <TableCell className={row.strong ? "font-semibold" : row.muted ? "text-muted-foreground" : undefined}>{row.label}</TableCell>
                  {items.map((i) => (
                    <TableCell key={i.id} className={`text-right tabular-nums ${row.strong ? "text-base font-semibold" : ""}`}>{row.values[i.id]}</TableCell>
                  ))}
                  <TableCell className="text-right font-semibold tabular-nums">{sum(items.map((i) => row.values[i.id]))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="brand-title text-base">{t("stock.receivedTitle")}</CardTitle>
            <CardDescription>{t("stock.receivedIntro")}</CardDescription>
            <Totals items={items} totals={receivedTotal} />
          </CardHeader>
          <CardContent className="-mb-4 overflow-x-auto border-t px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("stock.when")}</TableHead>
                  <TableHead>{t("stock.item")}</TableHead>
                  <TableHead className="text-right">{t("stock.quantity")}</TableHead>
                  <TableHead>{t("stock.from")}</TableHead>
                  <TableHead>{t("stock.into")}</TableHead>
                  <TableHead>{t("stock.by")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {receivedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("stock.noneReceived")}</TableCell>
                  </TableRow>
                ) : (
                  receivedRows.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap tabular-nums">{formatBusinessDateTime(new Date(m.occurred_at))}</TableCell>
                      <TableCell>{itemName[m.item_id] ?? "—"}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{m.quantity}</TableCell>
                      <TableCell>
                        {m.movement_type === "receipt" ? t("stock.supplier") : m.from_location_id ? label(m.from_location_id) : t("stock.fromCustomer")}
                        {m.reason ? <span className="block max-w-48 text-xs text-muted-foreground">{m.reason}</span> : null}
                      </TableCell>
                      <TableCell>{label(m.to_location_id)}</TableCell>
                      <TableCell>{m.actor_id ? names[m.actor_id] ?? "—" : "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="brand-title text-base">{t("stock.issuedTitle")}</CardTitle>
            <CardDescription>{t("stock.issuedIntro")}</CardDescription>
            <Totals items={items} totals={issuedTotal} />
          </CardHeader>
          <CardContent className="-mb-4 overflow-x-auto border-t px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("stock.sentAt")}</TableHead>
                  <TableHead>{t("stock.supervisor")}</TableHead>
                  <TableHead>{t("stock.items")}</TableHead>
                  <TableHead>{t("stock.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {issuedRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">{t("stock.noneIssued")}</TableCell>
                  </TableRow>
                ) : (
                  issuedRows.map((tr) => (
                    <TableRow key={tr.id} className={tr.status === "cancelled" ? "text-muted-foreground line-through" : undefined}>
                      <TableCell className="whitespace-nowrap tabular-nums">{formatBusinessDateTime(new Date(tr.sent_at))}</TableCell>
                      <TableCell className="font-semibold">{label(tr.to_location_id)}</TableCell>
                      <TableCell>{linesText(tr.lines, itemName)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {tr.status === "sent" ? t("stock.statusSent") : tr.status === "accepted" ? t("stock.statusAccepted") : t("stock.statusCancelled")}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {issuedRows.some((tr) => tr.status === "cancelled") ? (
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={4} className="text-xs font-normal text-muted-foreground">{t("stock.cancelledNotCounted")}</TableCell>
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="brand-title text-base">{t("stock.byLocation")}</CardTitle>
          <CardDescription>{t("stock.byLocationIntro", { date: formatDateOnly(to) })}</CardDescription>
        </CardHeader>
        <CardContent className="-mb-4 overflow-x-auto border-t px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("stock.location")}</TableHead>
                {items.map((i) => (
                  <TableHead key={i.id} className="text-right">{i.display_name}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownLocations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={items.length + 1} className="py-8 text-center text-muted-foreground">{t("stock.noStock")}</TableCell>
                </TableRow>
              ) : (
                shownLocations.map((loc) => (
                  <TableRow key={loc.id}>
                    <TableCell className="font-semibold">{loc.label}</TableCell>
                    {items.map((i) => {
                      const c = cell(loc.id, i.id);
                      return (
                        <TableCell key={i.id} className="text-right tabular-nums">
                          <span className="font-semibold">{c?.closing ?? 0}</span>
                          {c && c.in_transit > 0 ? <span className="block text-xs text-muted-foreground">+{c.in_transit} {t("stock.inTransit")}</span> : null}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <details>
          <summary className="cursor-pointer list-none p-6">
            <span className="brand-title text-base font-semibold">{t("stock.history")}</span>
            <span className="block text-sm text-muted-foreground">{t("stock.historyIntro")}</span>
          </summary>
          <CardContent className="-mb-4 overflow-x-auto border-t px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("stock.when")}</TableHead>
                  <TableHead>{t("stock.type")}</TableHead>
                  <TableHead>{t("stock.item")}</TableHead>
                  <TableHead className="text-right">{t("stock.quantity")}</TableHead>
                  <TableHead>{t("stock.from")}</TableHead>
                  <TableHead>{t("stock.into")}</TableHead>
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
                      <TableCell>{label(m.from_location_id)}</TableCell>
                      <TableCell>{label(m.to_location_id)}</TableCell>
                      <TableCell className="max-w-56 text-muted-foreground">{m.reason}</TableCell>
                      <TableCell>{m.actor_id ? names[m.actor_id] ?? "—" : "—"}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </details>
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
