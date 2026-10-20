import type { Metadata } from "next";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { t } from "@/lib/i18n";
import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: t("auth.savePassword") };

export default function ChangePasswordPage() {
  return (
    <>
      <h1 className="text-center text-2xl">{t("auth.changePasswordTitle")}</h1>
      <p className="mt-1 mb-6 text-center text-sm text-muted-foreground">{t("auth.changePasswordIntro")}</p>
      <ChangePasswordForm />
      <div className="mt-4 flex justify-center border-t pt-4">
        <SignOutButton label="auth.useAnotherAccount" variant="link" />
      </div>
    </>
  );
}
