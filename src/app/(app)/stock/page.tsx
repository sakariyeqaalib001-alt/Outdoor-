import type { Metadata } from "next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { businessToday, formatBusinessDateTime } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { linesText } from "@/lib/stock";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { acceptTransfer } from "@/server/stock/actions";
import { getAccess } from "@/server/auth/access";
import { getSessionId } from "@/server/auth/session";
import { getReport, getStockContext, listTransfers } from "@/server/stock/queries";
import { StockShell } from "./stock-shell";
import { ActionButton } from "./stock-ui";

export const metadata: Metadata = { title: t("nav.stock") };

async function Overview() {
  const today = businessToday();
  const supabase = await createSupabaseServerClient();
  const [{ items, locations }, report, transfers, access, ids] = await Promise.all([
    getStockContext(),
    getReport(today, today),
    listTransfers(),
    getAccess(),
    supabase ? getSessionId(supabase) : null,
  ]);
  const isSuperAdmin = access.roles.includes("super_admin");
  const itemName = Object.fromEntries(items.map((i) => [i.id, i.display_name]));
  const locationById = Object.fromEntries(locations.map((l) => [l.id, l]));
  const shownLocations = locations.filter((l) => report.some((r) => r.location_id === l.id));
  const cell = (loc: string, item: string) => report.find((r) => r.location_id === loc && r.item_id === item);
  const toAccept = transfers.filter(
    (tr) => tr.status === "sent" && (isSuperAdmin || (ids && locationById[tr.to_location_id]?.leader_id === ids.userId))
  );

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t("stock.overviewIntro")}</p>

      {toAccept.length > 0 ? (
        <Card className="border-brand-highlight">
          <CardHeader>
            <CardTitle className="brand-title text-base">{t("stock.toAccept")}</CardTitle>
            <CardDescription>{t("stock.toAcceptIntro")}</CardDescription>
          </CardHeader>
          <CardContent className="-mb-4 overflow-x-auto border-t px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("stock.sentAt")}</TableHead>
                  <TableHead>{t("stock.supervisor")}</TableHead>
                  <TableHead>{t("stock.items")}</TableHead>
                  <TableHead className="w-28"><span className="sr-only">{t("stock.accept")}</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {toAccept.map((tr) => (
                  <TableRow key={tr.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatBusinessDateTime(new Date(tr.sent_at))}</TableCell>
                    <TableCell className="font-semibold">{locationById[tr.to_location_id]?.label}</TableCell>
                    <TableCell>{linesText(tr.lines, itemName)}</TableCell>
                    <TableCell>
                      <ActionButton label="stock.accept" run={acceptTransfer.bind(null, tr.id)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="-my-4 overflow-x-auto px-0">
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
                  <TableCell colSpan={items.length + 1} className="py-10 text-center text-muted-foreground">{t("stock.noStock")}</TableCell>
                </TableRow>
              ) : (
                shownLocations.map((loc) => (
                  <TableRow key={loc.id}>
                    <TableCell className="font-semibold">{loc.label}</TableCell>
                    {items.map((i) => {
                      const c = cell(loc.id, i.id);
                      return (
                        <TableCell key={i.id} className="text-right tabular-nums">
                          <span className="text-base font-semibold">{c?.closing ?? 0}</span>
                          {c && c.in_transit > 0 ? (
                            <span className="block text-xs text-muted-foreground">+{c.in_transit} {t("stock.inTransit")}</span>
                          ) : null}
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
    </div>
  );
}

export default function StockPage() {
  return (
    <StockShell>
      <Overview />
    </StockShell>
  );
}
