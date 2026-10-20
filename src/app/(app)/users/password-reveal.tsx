"use client";

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

/** Shows a one-time temporary password to the Super Admin (FR-AUTH-04). It is never stored or logged. */
export function PasswordReveal({ password, name }: { password: string; name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3 rounded-lg border border-brand-highlight/40 bg-white p-4">
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-brand-highlight" aria-hidden="true" />
        <h3 className="text-lg">{t("users.passwordTitle")}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{t("users.passwordBody", { name })}</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md bg-muted px-3 py-2 font-mono text-lg tracking-wider" aria-label={t("users.passwordTitle")}>
          {password}
        </code>
        <Button
          type="button"
          variant="outline"
          onClick={async () => {
            await navigator.clipboard.writeText(password);
            setCopied(true);
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {t(copied ? "users.copied" : "users.copy")}
        </Button>
      </div>
    </div>
  );
}
