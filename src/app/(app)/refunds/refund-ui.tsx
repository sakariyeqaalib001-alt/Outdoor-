"use client";

import { useState, useTransition } from "react";
import { ReceiptText } from "lucide-react";
import { FormMessage } from "@/components/auth/form-message";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { t } from "@/lib/i18n";
import { formatUSD } from "@/lib/money";
import { REFUND_BADGE, REFUND_REASONS, reasonComplete, validRefundAmount, type RefundReason, type RefundStatus } from "@/lib/refunds";
import { decideRefund, submitRefund, type ActionResult } from "@/server/refunds/actions";

export function RefundStatusBadge({ status }: { status: RefundStatus }) {
  return <StatusBadge status={REFUND_BADGE[status]} label={t(`refunds.statuses.${status}`)} />;
}

/** Agent / Team Leader: ask for a refund of an approved sale (FR-REF-01, 02, 06). */
export function RequestRefundButton({ saleId, collected }: { saleId: string; collected: number }) {
  const [open, setOpen] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [amount, setAmount] = useState(String(collected));
  const [reason, setReason] = useState<RefundReason>("no_signal");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActionResult>();
  const [pending, start] = useTransition();
  const value = Number(amount);
  const ready = validRefundAmount(value, collected) && reasonComplete(reason, note);

  const openDialog = () => {
    setRequestId(crypto.randomUUID()); // one id per request: a retry never creates a second refund
    setResult(undefined);
    setOpen(true);
  };
  const send = () =>
    start(async () => {
      const r = await submitRefund({ client_request_id: requestId, sale_id: saleId, amount: value, reason, note });
      setResult(r);
      if (r.ok) setOpen(false);
    });

  return (
    <div className="grid gap-2">
      <Button variant="outline" className="h-11 justify-self-start md:h-9" onClick={openDialog}>
        <ReceiptText aria-hidden="true" />
        {t("refunds.request")}
      </Button>
      {result?.ok ? <FormMessage notice={result.message} /> : null}
      {open ? (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="brand-title text-lg">{t("refunds.requestTitle")}</DialogTitle>
              <DialogDescription>{t("refunds.requestIntro")}</DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="refund-amount">{t("refunds.amountLabel")}</Label>
                <Input id="refund-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11 tabular-nums md:h-9" aria-describedby="refund-amount-hint" />
                <p id="refund-amount-hint" className="text-xs text-muted-foreground">{t("refunds.amountHint", { amount: formatUSD(collected) })}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="refund-reason">{t("refunds.reason")}</Label>
                <NativeSelect id="refund-reason" value={reason} onChange={(e) => setReason(e.target.value as RefundReason)}>
                  {REFUND_REASONS.map((r) => (
                    <option key={r} value={r}>{t(`refunds.reasons.${r}`)}</option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="refund-note">{t("refunds.noteLabel")}</Label>
                <Input id="refund-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="h-11 md:h-9" aria-describedby="refund-note-hint" />
                <p id="refund-note-hint" className="text-xs text-muted-foreground">{t("refunds.noteHint")}</p>
              </div>
              {result?.error ? <FormMessage error={result.error} /> : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>{t("refunds.cancel")}</Button>
              <Button type="button" disabled={pending || !ready} onClick={send}>{pending ? t("refunds.submitting") : t("refunds.submit")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

/** Super Admin: approve or reject a waiting refund (BR-03). */
export function DecideRefund({ id }: { id: string }) {
  const [mode, setMode] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<ActionResult>();
  const [pending, start] = useTransition();
  const go = () =>
    start(async () => {
      const r = await decideRefund(id, mode === "approve", note);
      setResult(r);
      if (r.ok) setMode(null);
    });

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={() => { setNote(""); setResult(undefined); setMode("approve"); }}>{t("refunds.approve")}</Button>
        <Button size="sm" variant="outline" onClick={() => { setNote(""); setResult(undefined); setMode("reject"); }}>{t("refunds.reject")}</Button>
      </div>
      {result?.error && !mode ? <span className="max-w-56 text-right text-xs text-destructive" role="alert">{result.error}</span> : null}
      {mode ? (
        <Dialog open onOpenChange={(o) => !o && setMode(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="brand-title text-lg">{t(mode === "approve" ? "refunds.approveTitle" : "refunds.rejectTitle")}</DialogTitle>
              {mode === "approve" ? <DialogDescription>{t("refunds.approveText")}</DialogDescription> : null}
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor={`refund-note-${id}`}>{t(mode === "approve" ? "refunds.note" : "refunds.rejectReason")}</Label>
              <Input id={`refund-note-${id}`} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} className="h-11 md:h-9" />
            </div>
            {result?.error ? <FormMessage error={result.error} /> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMode(null)}>{t("refunds.cancel")}</Button>
              <Button type="button" disabled={pending || (mode === "reject" && note.trim().length < 3)} onClick={go}>
                {t(mode === "approve" ? "refunds.confirmApprove" : "refunds.confirmReject")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
