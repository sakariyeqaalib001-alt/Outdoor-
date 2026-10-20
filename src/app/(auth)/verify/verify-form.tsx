"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { resendOtp, verifyOtp } from "@/server/auth/actions";

export function VerifyForm() {
  const [state, action, pending] = useActionState(verifyOtp, undefined);
  const [resendState, resendAction, resending] = useActionState(resendOtp, undefined);
  const message = state?.error ? state : resendState;

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="code">{t("auth.code")}</Label>
          <Input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            className="h-12 text-center text-2xl tracking-[0.5em] tabular-nums"
          />
        </div>
        <FormMessage error={message?.error} notice={message?.notice} />
        <Button type="submit" size="lg" className="h-11 w-full text-base" disabled={pending}>
          {pending ? t("auth.verifying") : t("auth.verify")}
        </Button>
      </form>
      <form action={resendAction}>
        <Button type="submit" variant="link" className="w-full" disabled={resending}>
          {t("auth.resend")}
        </Button>
      </form>
    </div>
  );
}
