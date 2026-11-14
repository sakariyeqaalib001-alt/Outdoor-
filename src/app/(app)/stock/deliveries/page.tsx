import type { Metadata } from "next";
import { PackagePlus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBusinessDateTime } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { linesText } from "@/lib/stock";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, getAccess } from "@/server/auth/access";
import { getSessionId } from "@/server/auth/session";
import { acceptTransfer, cancelTransfer, receiveStock, sendStock } from "@/server/stock/actions";
import { getStockContext, listTransfers } from "@/server/stock/queries";
import { StockShell } from "../stock-shell";
import { ActionButton, ActionDialog, QuantityFields, TransferStatus } from "../stock-ui";

export const metadata: Metadata = { title: t("stock.tabDeliveries") };

function NoteField() {
  return (
    <div className="space-y-1.5">
      <Label htmlFor="note">{t("stock.note")}</Label>
      <Input id="note" name="note" maxLength={500} placeholder={t("stock.noteHint")} className="h-11 md:h-9" />
    </div>
  );
}

async function Deliveries() {
  const supabase = await createSupabaseServerClient();
  const [{ items, locations, supervisors }, transfers, access, ids] = await Promise.all([
    getStockContext(),
    listTransfers(),
    getAccess(),
    supabase ? getSessionId(supabase) : null,
  ]);
  const canReceive = can(access, "stock.receive");
  const canSend = can(access, "stock.transfer");
  const isSuperAdmin = access.roles.includes("super_admin");
  const itemName = Object.fromEntries(items.map((i) => [i.id, i.display_name]));
  const locationById = Object.fromEntries(locations.map((l) => [l.id, l]));

  return (
    <div className="grid gap-4">
      {canReceive || canSend ? (
        <div className="flex flex-wrap justify-end gap-2">
          {canReceive ? (
            <ActionDialog
              title="stock.receive"
              description="stock.receiveIntro"
              action={receiveStock}
              trigger={<Button className="h-11 md:h-9"><PackagePlus aria-hidden="true" />{t("stock.receive")}</Button>}
            >
              <QuantityFields items={items} />
              <NoteField />
            </ActionDialog>
          ) : null}
          {canSend ? (
            <ActionDialog
              title="stock.send"
              description="stock.sendIntro"
              action={sendStock}
              trigger={<Button className="h-11 md:h-9"><Send aria-hidden="true" />{t("stock.send")}</Button>}
            >
              <div className="space-y-1.5">
                <Label htmlFor="teamId">{t("stock.supervisor")}</Label>
                <NativeSelect id="teamId" name="teamId" required>
                  {supervisors.map((tm) => (
                    <option key={tm.id} value={tm.id}>{tm.name}</option>
                  ))}
                </NativeSelect>
                {supervisors.length === 0 ? <p className="text-xs text-muted-foreground">{t("stock.noSupervisor")}</p> : null}
              </div>
              <QuantityFields items={items} />
              <NoteField />
            </ActionDialog>
          ) : null}
        </div>
      ) : null}

      <Card>
        <CardContent className="-my-4 overflow-x-auto px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("stock.sentAt")}</TableHead>
                <TableHead>{t("stock.supervisor")}</TableHead>
                <TableHead>{t("stock.items")}</TableHead>
                <TableHead>{t("stock.status")}</TableHead>
                <TableHead>{t("stock.note")}</TableHead>
                <TableHead className="w-40"><span className="sr-only">{t("stock.accept")}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">{t("stock.noDeliveries")}</TableCell>
                </TableRow>
              ) : (
                transfers.map((tr) => {
                  const mayAccept = tr.status === "sent" && (isSuperAdmin || (ids && locationById[tr.to_location_id]?.leader_id === ids.userId));
                  return (
                    <TableRow key={tr.id}>
                      <TableCell className="whitespace-nowrap tabular-nums">{formatBusinessDateTime(new Date(tr.sent_at))}</TableCell>
                      <TableCell className="font-semibold">{locationById[tr.to_location_id]?.label}</TableCell>
                      <TableCell>{linesText(tr.lines, itemName)}</TableCell>
                      <TableCell><TransferStatus status={tr.status} /></TableCell>
                      <TableCell className="max-w-48 truncate text-muted-foreground">{tr.note}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          {mayAccept ? <ActionButton label="stock.accept" run={acceptTransfer.bind(null, tr.id)} /> : null}
                          {canSend && tr.status === "sent" ? (
                            <ActionButton label="stock.cancel" variant="outline" ask="stock.cancelReason" run={cancelTransfer.bind(null, tr.id)} />
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DeliveriesPage() {
  return (
    <StockShell>
      <Deliveries />
    </StockShell>
  );
}
