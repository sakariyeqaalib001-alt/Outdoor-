import { ShieldOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { t } from "@/lib/i18n";

/** Shown when the signed-in role lacks the page's permission. The database denies the data anyway (RLS). */
export function AccessDenied() {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <ShieldOff className="size-10 text-muted-foreground" aria-hidden="true" />
        <h2 className="text-xl">{t("access.deniedTitle")}</h2>
        <p className="max-w-md text-muted-foreground">{t("access.deniedBody")}</p>
      </CardContent>
    </Card>
  );
}
