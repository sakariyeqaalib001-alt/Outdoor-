import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

export default function Loading() {
  return (
    <div className="flex flex-col gap-4 p-4 md:p-6" role="status" aria-live="polite">
      <span className="sr-only">{t("states.loading")}</span>
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </div>
  );
}
