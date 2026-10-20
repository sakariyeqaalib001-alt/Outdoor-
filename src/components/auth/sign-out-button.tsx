import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/lib/i18n";
import { signOut } from "@/server/auth/actions";

export function SignOutButton({
  label = "user.signOut",
  variant = "ghost",
  className,
}: {
  label?: MessageKey;
  variant?: "ghost" | "link" | "outline";
  className?: string;
}) {
  return (
    <form action={signOut}>
      <Button type="submit" variant={variant} className={className}>
        <LogOut aria-hidden="true" />
        {t(label)}
      </Button>
    </form>
  );
}
