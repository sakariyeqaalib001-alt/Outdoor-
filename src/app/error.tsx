"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    // Phase 20 connects an error-reporting service; never log personal data here.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertTriangle className="size-10 text-destructive" aria-hidden="true" />
      <h2 className="text-2xl">{t("states.errorTitle")}</h2>
      <p className="max-w-md text-muted-foreground">{t("states.errorBody")}</p>
      <Button onClick={() => retry()}>{t("states.retry")}</Button>
    </div>
  );
}
