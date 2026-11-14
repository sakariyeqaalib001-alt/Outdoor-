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
  // Exactly one allowed device (D-39); preselected when the product allows only one kind.
  const [device, setDevice] = useState<string>(row.allowed.length === 1 ? row.allowed[0] : "");
  const [result, setResult] = useState<ActionResult>();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const run = (approve: boolean) =>
    start(async () => {
      const chosen = approve && device ? [{ item_id: device, quantity: 1 }] : [];
      const r = await decide(row.kind, row.id, approve, chosen, reason);
      setResult(r);
      if (r.ok) setRejecting(false);
    });

  if (result?.ok) {
    return (
      <Card>
        <CardContent><FormMessage notice={`${row.customer_name} — ${result.message}`} /></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">{row.customer_name}</span>
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
        {row.own ? null : row.allowed.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("approvals.noEquipment")}</p>
        ) : (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-xs font-semibold text-muted-foreground">{t("approvals.deviceGiven")}</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {items.filter((i) => row.allowed.includes(i.id)).map((item) => (
                <label key={item.id} className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`device-${row.id}`}
                    value={item.id}
                    checked={device === item.id}
                    disabled={!row.team_id || pending}
                    onChange={() => setDevice(item.id)}
                    className="size-5 accent-[#047B95]"
                  />
                  <span className="font-semibold">{item.name}</span>
                  {row.team_id ? <span className="text-xs text-muted-foreground">{t("approvals.available", { count: available?.[item.id] ?? 0 })}</span> : null}
                </label>
              ))}
            </div>
            {!row.team_id ? <p className="text-xs text-destructive">{t("sales.errors.noTeam")}</p> : null}
          </fieldset>
        )}

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
              <DialogTitle className="brand-title text-lg">{t("approvals.rejectTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-1.5">
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
  if (rows.length === 0) return <p className="rounded-lg border bg-white p-6 text-center text-sm text-muted-foreground">{t("approvals.none")}</p>;
  return (
    <div className="grid gap-3">
      {rows.map((row) => (
        <PendingCard key={`${row.kind}-${row.id}`} row={row} items={items} available={row.team_id ? available[row.team_id] : undefined} />
      ))}
    </div>
  );
}
