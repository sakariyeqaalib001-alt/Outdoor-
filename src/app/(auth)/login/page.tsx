import type { Metadata } from "next";
import { Suspense } from "react";
import { FormMessage } from "@/components/auth/form-message";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: t("auth.signIn") };

export default function LoginPage() {
  const configured = getSupabasePublicEnv() !== null;
  return (
    <>
      <h1 className="text-center text-2xl">{t("auth.signInTitle")}</h1>
      <p className="mt-1 mb-6 text-center text-sm text-muted-foreground">{t("auth.signInIntro")}</p>
      {configured ? (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <LoginForm />
        </Suspense>
      ) : (
        <FormMessage error={t("auth.notConfigured")} />
      )}
    </>
  );
}
