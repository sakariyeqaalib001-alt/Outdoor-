"use client";

import { useActionState, useState, useTransition, type ReactNode } from "react";
import { FormMessage } from "@/components/auth/form-message";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t, type MessageKey } from "@/lib/i18n";
import type { StockResult } from "@/server/stock/actions";
import type { StockItem, TransferRow } from "@/server/stock/queries";

/** One whole-number quantity box per item (form fields "qty_<itemId>"). */
export function QuantityFields({ items }: { items: StockItem[] }) {
  return (
    <fieldset className="grid gap-3 sm:grid-cols-3">
      <legend className="mb-2 text-xs font-semibold text-muted-foreground">{t("stock.items")}</legend>
      {items.map((item) => (
        <div key={item.id} className="space-y-1.5">
          <Label htmlFor={`qty_${item.id}`}>{item.display_name}</Label>
          <Input id={`qty_${item.id}`} name={`qty_${item.id}`} inputMode="numeric" pattern="\d*" placeholder="0" className="h-11 tabular-nums md:h-9" />
        </div>
      ))}
    </fieldset>
  );
}

/** A dialog holding a server-action form; shows the result and keeps the dialog open to read it. */
export function ActionDialog({
  title,
  description,
  trigger,
  action,
  children,
}: {
  title: MessageKey;
  description?: MessageKey;
  trigger: ReactNode;
  action: (prev: StockResult, formData: FormData) => Promise<StockResult>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <span onClick={() => { setKey(Date.now()); setOpen(true); }}>{trigger}</span>
      {open ? <ActionDialogBody key={key} title={title} description={description} action={action} onClose={() => setOpen(false)}>{children}</ActionDialogBody> : null}
    </>
  );
}

function ActionDialogBody({
  title,
  description,
  action,
  onClose,
  children,
}: {
  title: MessageKey;
  description?: MessageKey;
  action: (prev: StockResult, formData: FormData) => Promise<StockResult>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="brand-title text-lg">{t(title)}</DialogTitle>
          {description ? <DialogDescription>{t(description)}</DialogDescription> : null}
        </DialogHeader>
        <form action={formAction} className="space-y-4">
          {children}
          <FormMessage error={state?.error} notice={state?.ok ? state.message : undefined} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("stock.close")}</Button>
            <Button type="submit" disabled={pending}>{pending ? t("stock.saving") : t("stock.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A button that runs a stock action, optionally asking for a short text first (reason / note). */
export function ActionButton({
  label,
  run,
  ask,
  variant = "default",
}: {
  label: MessageKey;
  run: (text: string) => Promise<StockResult>;
  ask?: MessageKey;
  variant?: "default" | "outline";
}) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<StockResult>();
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState("");
  const go = (value: string) => start(async () => { setResult(await run(value)); setAsking(false); });
  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant={variant} disabled={pending} onClick={() => (ask ? setAsking(true) : go(""))}>{t(label)}</Button>
      {result?.error ? <span className="max-w-56 text-right text-xs text-destructive" role="alert">{result.error}</span> : null}
      {asking && ask ? (
        <Dialog open onOpenChange={(o) => !o && setAsking(false)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="brand-title text-lg">{t(label)}</DialogTitle>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="ask-text">{t(ask)}</Label>
              <Input id="ask-text" value={text} maxLength={500} onChange={(e) => setText(e.target.value)} className="h-11 md:h-9" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAsking(false)}>{t("stock.close")}</Button>
              <Button type="button" disabled={pending} onClick={() => go(text)}>{t("stock.confirm")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

export function TransferStatus({ status }: { status: TransferRow["status"] }) {
  const map = {
    sent: { badge: "pending", label: "stock.statusSent" },
    accepted: { badge: "approved", label: "stock.statusAccepted" },
    cancelled: { badge: "reversed", label: "stock.statusCancelled" },
  } as const;
  return <StatusBadge status={map[status].badge} label={t(map[status].label)} />;
}
