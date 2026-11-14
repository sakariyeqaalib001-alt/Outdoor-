import type { Metadata } from "next";
import { Plus, Undo2 } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBusinessDateTime } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { can, getAccess } from "@/server/auth/access";
import { getSessionId } from "@/server/auth/session";
import { recordRefundReturn } from "@/server/refunds/actions";
import { refundsToCollect, type CollectRow } from "@/server/refunds/queries";
import { decideAdjustment, recordReturn, requestAdjustment } from "@/server/stock/actions";
import { getStockContext, listAdjustments, namesOf, type StockItem } from "@/server/stock/queries";
import { StockShell } from "../stock-shell";
import { ActionButton, ActionDialog } from "../stock-ui";

export const metadata: Metadata = { title: t("stock.tabReturns") };

const REASONS = ["faulty", "refund", "switch", "retention_rejected", "other"] as const;

function ItemSelect({ items }: { items: StockItem[] }) {
  return (
    <div className="space-y-1">
      <Label htmlFor="itemId">{t("stock.item")}</Label>
      <NativeSelect id="itemId" name="itemId" required>
        {items.map((i) => (
          <option key={i.id} value={i.id}>{i.display_name}</option>
        ))}
      </NativeSelect>
    </div>
  );
}

const ADJ_STATUS = {
  requested: { badge: "pending", label: "stock.adjRequested" },
  approved: { badge: "approved", label: "stock.adjApproved" },
  rejected: { badge: "rejected", label: "stock.adjRejected" },
} as const;

/** Approved refunds whose devices have not all come back (FR-REF-08): the Stock Officer records each one here. */
function RefundCollect({ rows }: { rows: CollectRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="brand-title text-lg">{t("refunds.collectTitle")}</CardTitle>
        <CardDescription>{t("refunds.collectIntro")}</CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("refunds.decidedAt")}</TableHead>
              <TableHead>{t("refunds.customer")}</TableHead>
              <TableHead>{t("refunds.team")}</TableHead>
              <TableHead>{t("refunds.item")}</TableHead>
              <TableHead>{t("refunds.equipment")}</TableHead>
              <TableHead className="w-40"><span className="sr-only">{t("refunds.recordReturn")}</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t("refunds.collectNone")}</TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={`${r.refund_id}-${r.item_id}`}>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatBusinessDateTime(new Date(r.decided_at))}</TableCell>
                  <TableCell className="font-semibold">{r.customer_name}<span className="block text-xs font-normal text-muted-foreground">{r.agent ?? "—"}</span></TableCell>
                  <TableCell>{r.team ?? "—"}</TableCell>
                  <TableCell>{r.item}</TableCell>
                  <TableCell className="tabular-nums">{t("refunds.outstanding", { returned: String(r.returned), given: String(r.given) })}</TableCell>
                  <TableCell className="text-right">
                    <ActionDialog
                      title="refunds.returnTitle"
                      description="refunds.collectIntro"
                      action={recordRefundReturn}
                      trigger={<Button size="sm"><Undo2 aria-hidden="true" />{t("refunds.recordReturn")}</Button>}
                    >
                      <input type="hidden" name="refundId" value={r.refund_id} />
                      <input type="hidden" name="itemId" value={r.item_id} />
                      <p className="text-sm"><span className="font-semibold">{r.customer_name}</span> · {r.item}</p>
                      <div className="space-y-1">
                        <Label htmlFor="quantity">{t("refunds.quantity")}</Label>
                        <Input id="quantity" name="quantity" required inputMode="numeric" pattern="\d+" defaultValue={String(r.given - r.returned)} className="h-11 tabular-nums md:h-9" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="note">{t("refunds.returnNote")}</Label>
                        <Input id="note" name="note" maxLength={500} className="h-11 md:h-9" />
                      </div>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" name="faulty" value="true" className="size-4 accent-[#047B95]" />
                        {t("refunds.faulty")}
                      </label>
                    </ActionDialog>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

async function Returns() {
  const supabase = await createSupabaseServerClient();
  const [{ items, locations, teams }, adjustments, access, ids] = await Promise.all([
    getStockContext(),
    listAdjustments(),
    getAccess(),
    supabase ? getSessionId(supabase) : null,
  ]);
  const names = await namesOf(adjustments.map((a) => a.requested_by));
  const canReturn = can(access, "stock.transfer");
  const canRequest = can(access, "stock.adjust.request");
  const canApprove = can(access, "stock.adjust.approve");
  const collect = access.permissions["stock.transfer"] === "all" ? await refundsToCollect() : null;
  const itemName = Object.fromEntries(items.map((i) => [i.id, i.display_name]));
  const locationLabel = Object.fromEntries(locations.map((l) => [l.id, l.label]));

  return (
    <div className="grid gap-4">
      {collect ? <RefundCollect rows={collect} /> : null}
      {canReturn ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="brand-title text-lg">{t("stock.recordReturn")}</CardTitle>
              <CardDescription>{t("stock.returnIntro")}</CardDescription>
            </div>
            <ActionDialog
              title="stock.recordReturn"
              description="stock.returnIntro"
              action={recordReturn}
              trigger={<Button className="h-11 md:h-9"><Undo2 aria-hidden="true" />{t("stock.recordReturn")}</Button>}
            >
              <div className="space-y-1">
                <Label htmlFor="teamId">{t("stock.from")}</Label>
                <NativeSelect id="teamId" name="teamId" required>
                  <option value="customer">{t("stock.fromCustomer")}</option>
                  {teams.map((tm) => (
                    <option key={tm.id} value={tm.id}>{tm.name}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ItemSelect items={items} />
                <div className="space-y-1">
                  <Label htmlFor="quantity">{t("stock.quantity")}</Label>
                  <Input id="quantity" name="quantity" required inputMode="numeric" pattern="\d+" defaultValue="1" className="h-11 tabular-nums md:h-9" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="reason">{t("stock.reason")}</Label>
                <NativeSelect id="reason" name="reason" required>
                  {REASONS.map((r) => (
                    <option key={r} value={r}>{t(`stock.reasons.${r}`)}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label htmlFor="note">{t("stock.note")}</Label>
                <Input id="note" name="note" maxLength={500} className="h-11 md:h-9" aria-describedby="note-hint" />
                <p id="note-hint" className="text-xs text-muted-foreground">{t("stock.returnNoteHint")}</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="faulty" value="true" className="size-4 accent-[#047B95]" />
                {t("stock.markFaulty")}
              </label>
            </ActionDialog>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="brand-title text-lg">{t("stock.adjustments")}</CardTitle>
            <CardDescription>{t("stock.adjustmentsIntro")}</CardDescription>
          </div>
          {canRequest ? (
            <ActionDialog
              title="stock.requestAdjustment"
              description="stock.adjustmentsIntro"
              action={requestAdjustment}
              trigger={<Button className="h-11 md:h-9"><Plus aria-hidden="true" />{t("stock.requestAdjustment")}</Button>}
            >
              <div className="space-y-1">
                <Label htmlFor="locationId">{t("stock.location")}</Label>
                <NativeSelect id="locationId" name="locationId" required>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <ItemSelect items={items} />
                <div className="space-y-1">
                  <Label htmlFor="change">{t("stock.change")}</Label>
                  <Input id="change" name="change" required inputMode="numeric" pattern="-?\d+" className="h-11 tabular-nums md:h-9" aria-describedby="change-hint" />
                  <p id="change-hint" className="text-xs text-muted-foreground">{t("stock.changeHint")}</p>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="reason">{t("stock.reason")}</Label>
                <Input id="reason" name="reason" required minLength={3} maxLength={500} className="h-11 md:h-9" />
              </div>
            </ActionDialog>
          ) : null}
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("stock.requestedAt")}</TableHead>
                <TableHead>{t("stock.location")}</TableHead>
                <TableHead>{t("stock.item")}</TableHead>
                <TableHead className="text-right">{t("stock.change")}</TableHead>
                <TableHead>{t("stock.reason")}</TableHead>
                <TableHead>{t("stock.requestedBy")}</TableHead>
                <TableHead>{t("stock.status")}</TableHead>
                <TableHead className="w-44"><span className="sr-only">{t("stock.approve")}</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">{t("stock.noAdjustments")}</TableCell>
                </TableRow>
              ) : (
                adjustments.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatBusinessDateTime(new Date(a.requested_at))}</TableCell>
                    <TableCell>{locationLabel[a.location_id]}</TableCell>
                    <TableCell>{itemName[a.item_id]}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{a.quantity_change > 0 ? `+${a.quantity_change}` : `−${-a.quantity_change}`}</TableCell>
                    <TableCell className="max-w-56">{a.reason}{a.decision_note ? <span className="block text-xs text-muted-foreground">{a.decision_note}</span> : null}</TableCell>
                    <TableCell>{a.requested_by ? names[a.requested_by] ?? "—" : "—"}</TableCell>
                    <TableCell><StatusBadge status={ADJ_STATUS[a.status].badge} label={t(ADJ_STATUS[a.status].label)} /></TableCell>
                    <TableCell>
                      {canApprove && a.status === "requested" && a.requested_by !== ids?.userId ? (
                        <div className="flex justify-end gap-2">
                          <ActionButton label="stock.approve" ask="stock.decisionNote" run={decideAdjustment.bind(null, a.id, true)} />
                          <ActionButton label="stock.reject" variant="outline" ask="stock.decisionNote" run={decideAdjustment.bind(null, a.id, false)} />
                        </div>
                      ) : null}
                    </TableCell>
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

export default function ReturnsPage() {
  return (
    <StockShell>
      <Returns />
    </StockShell>
  );
}
