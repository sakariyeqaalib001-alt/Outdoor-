"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { changePassword } from "@/server/auth/actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="password">{t("auth.newPassword")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          className="h-11"
          aria-describedby="password-rules"
        />
        <p id="password-rules" className="text-xs text-muted-foreground">
          {t("auth.passwordRules")}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">{t("auth.confirmPassword")}</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="h-11" />
      </div>
      <FormMessage error={state?.error} />
      <Button type="submit" size="lg" className="h-11 w-full text-base" disabled={pending}>
        {pending ? t("auth.saving") : t("auth.savePassword")}
      </Button>
    </form>
  );
}
