"use client";

import { useActionState } from "react";
import { useSearchParams } from "next/navigation";
import { FormMessage } from "@/components/auth/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n";
import { signIn } from "@/server/auth/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, undefined);
  const params = useSearchParams();
  const urlError = params.get("error") === "inactive" ? t("auth.inactive") : undefined;

  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="identifier">{t("auth.identifier")}</Label>
        <Input
          id="identifier"
          name="identifier"
          autoComplete="username"
          inputMode="email"
          required
          className="h-11"
          aria-describedby="identifier-hint"
        />
        <p id="identifier-hint" className="text-xs text-muted-foreground">
          {t("auth.identifierHint")}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("auth.password")}</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-11" />
      </div>
      <FormMessage error={state?.error ?? urlError} />
      <Button type="submit" size="lg" className="h-11 w-full text-base" disabled={pending}>
        {pending ? t("auth.signingIn") : t("auth.signIn")}
      </Button>
    </form>
  );
}
