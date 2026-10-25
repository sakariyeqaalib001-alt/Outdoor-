"use client";

import { useState, useTransition } from "react";
import { FormMessage } from "@/components/auth/form-message";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBusinessDateTime } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";
import { decide, type ActionResult } from "@/server/approvals/actions";
import type { PendingRow, StockItem } from "@/server/approvals/queries";

/** One pending sale or switch: equipment boxes + Approve, or Reject with a reason (D-37, D-38). */
function PendingCard({ row, items, available }: { row: PendingRow; items: StockItem[]; available: Record<string, number> | undefined }) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [result, setResult] = useState<ActionResult>();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const run = (approve: boolean) =>
    start(async () => {
      const chosen = items
        .map((i) => ({ item_id: i.id, quantity: Number(quantities[i.id] || 0) }))
        .filter((i) => Number.isInteger(i.quantity) && i.quantity > 0);
      const r = await decide(row.kind, row.id, approve, chosen, reason);
      setResult(r);
      if (r.ok) setRejecting(false);
    });

  if (result?.ok) {
    return (
      <Card>
        <CardContent className="pt-6"><FormMessage notice={`${row.customer_name} — ${result.message}`} /></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="grid gap-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">{row.customer_name}</span>
              <Badge variant="secondary">{t(row.kind === "sale" ? "approvals.sale" : "approvals.switch")}</Badge>
              {row.customer_type ? <Badge variant="outline">{t(`sales.types.${row.customer_type}`)}</Badge> : null}
            </div>
            <div className="text-sm text-muted-foreground">
              {row.detail}
              {row.amount !== null ? ` · ${formatUSD(row.amount)}` : ""}
            </div>
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold">{row.agent}</div>
            <div className="text-muted-foreground">{row.team ?? t("approvals.noTeam")} · {formatBusinessDateTime(new Date(row.submitted_at))}</div>
          </div>
        </div>

        {row.own ? <p className="text-sm text-muted-foreground">{t("approvals.ownOnlyReject")}</p> : null}
        <fieldset className="grid gap-3 sm:grid-cols-3" hidden={row.own}>
          <legend className="mb-1 text-sm font-semibold">{t("approvals.equipment")}</legend>
          {items.map((item) => {
            const id = `q-${row.id}-${item.id}`;
            return (
              <div key={item.id} className="space-y-1">
                <Label htmlFor={id}>{item.name}</Label>
                <Input
                  id={id}
                  inputMode="numeric"
                  placeholder="0"
                  disabled={!row.team_id || pending}
                  value={quantities[item.id] ?? ""}
                  onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                  className="h-11 tabular-nums md:h-9"
                />
                {row.team_id ? <p className="text-xs text-muted-foreground">{t("approvals.available", { count: available?.[item.id] ?? 0 })}</p> : null}
              </div>
            );
          })}
        </fieldset>

        <FormMessage error={result?.error} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={() => setRejecting(true)} className="h-11 md:h-9">{t("approvals.reject")}</Button>
          {row.own ? null : (
            <Button type="button" disabled={pending} onClick={() => run(true)} className="h-11 md:h-9">{t("approvals.approve")}</Button>
          )}
        </div>
      </CardContent>

      {rejecting ? (
        <Dialog open onOpenChange={(o) => !o && setRejecting(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="brand-title text-xl">{t("approvals.rejectTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-1">
              <Label htmlFor={`reason-${row.id}`}>{t("approvals.reason")}</Label>
              <Input id={`reason-${row.id}`} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className="h-11 md:h-9" />
            </div>
            <FormMessage error={result?.error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRejecting(false)}>{t("approvals.cancel")}</Button>
              <Button type="button" disabled={pending} onClick={() => run(false)}>{t("approvals.confirm")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}

export function ApprovalsList({ rows, items, available }: { rows: PendingRow[]; items: StockItem[]; available: Record<string, Record<string, number>> }) {
  if (rows.length === 0) return <p className="rounded-lg border bg-white p-6 text-center text-muted-foreground">{t("approvals.none")}</p>;
  return (
    <div className="grid gap-3">
      {rows.map((row) => (
        <PendingCard key={`${row.kind}-${row.id}`} row={row} items={items} available={row.team_id ? available[row.team_id] : undefined} />
      ))}
    </div>
  );
}
