"use client";

import { useSearchParams } from "next/navigation";
import { FormMessage } from "@/components/auth/form-message";
import { t, type MessageKey } from "@/lib/i18n";

const MESSAGES: Record<string, MessageKey> = {
  failed: "auth.smsFailed",
  not_configured: "auth.smsNotConfigured",
  no_phone: "auth.smsNoPhone",
  rate_limited: "auth.otpRateLimited",
};

/** Shown when the automatic SMS after sign-in could not be sent (the user can press "Send a new code"). */
export function SmsNotice() {
  const key = MESSAGES[useSearchParams().get("sms") ?? ""];
  if (!key) return null;
  return (
    <div className="mb-4">
      <FormMessage error={t(key)} />
    </div>
  );
}
