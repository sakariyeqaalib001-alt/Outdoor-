"use client";

import { useActionState, useState } from "react";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { t } from "@/lib/i18n";
import { changeIdentifier } from "@/server/sales/actions";

/** Super Admin: change a customer's phone or Index with a reason (FR-SALE-16). */
export function IdentityDialog({ customerId, name }: { customerId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => { setKey(Date.now()); setOpen(true); }} aria-label={`${t("customers.change")}: ${name}`}>
        {t("customers.change")}
      </Button>
      {open ? <Body key={key} customerId={customerId} name={name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function Body({ customerId, name, onClose }: { customerId: string; name: string; onClose: () => void }) {
  const [state, action, pending] = useActionState(changeIdentifier, undefined);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="brand-title text-lg">{t("customers.changeTitle")}</DialogTitle>
          <DialogDescription>{`${name} — ${t("customers.changeIntro")}`}</DialogDescription>
        </DialogHeader>
        <form action={action} className="space-y-4">
          <input type="hidden" name="customerId" value={customerId} />
          <div className="space-y-1.5">
            <Label htmlFor="kind">{t("customers.kind")}</Label>
            <NativeSelect id="kind" name="kind">
              <option value="phone">{t("customers.phone")}</option>
              <option value="index">{t("customers.index")}</option>
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="value">{t("customers.newValue")}</Label>
            <Input id="value" name="value" required inputMode="numeric" maxLength={25} className="h-11 md:h-9" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason">{t("customers.reason")}</Label>
            <Input id="reason" name="reason" required minLength={3} maxLength={500} className="h-11 md:h-9" />
          </div>
          <FormMessage error={state?.error} notice={state?.ok ? state.message : undefined} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t("customers.close")}</Button>
            <Button type="submit" disabled={pending}>{pending ? t("customers.saving") : t("customers.save")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
