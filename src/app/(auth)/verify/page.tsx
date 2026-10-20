import type { Metadata } from "next";
import { Suspense } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSessionInfo } from "@/server/auth/session";
import { SmsNotice } from "./sms-notice";
import { VerifyForm } from "./verify-form";

export const metadata: Metadata = { title: t("auth.verify") };

async function VerifyIntro() {
  const supabase = await createSupabaseServerClient();
  const info = supabase ? await getSessionInfo(supabase) : null;
  const text = info?.phone_hint
    ? t("auth.verifyIntro", { phone: info.phone_hint })
    : t("auth.verifyIntroNoPhone");
  return <p className="mt-1 mb-6 text-center text-sm text-muted-foreground">{text}</p>;
}

export default function VerifyPage() {
  return (
    <>
      <h1 className="text-center text-2xl">{t("auth.verifyTitle")}</h1>
      <Suspense fallback={<Skeleton className="mx-auto mt-2 mb-6 h-10 w-full" />}>
        <VerifyIntro />
      </Suspense>
      <Suspense fallback={null}>
        <SmsNotice />
      </Suspense>
      <VerifyForm />
      <div className="mt-4 flex justify-center border-t pt-4">
        <SignOutButton label="auth.useAnotherAccount" variant="link" />
      </div>
    </>
  );
}
