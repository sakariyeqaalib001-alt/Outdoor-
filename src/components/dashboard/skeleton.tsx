import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

/** Loading state for a dashboard view: tabs, filters, KPI cards and two chart panels. */
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5" role="status" aria-live="polite">
      <span className="sr-only">{t("states.loading")}</span>
      <Skeleton className="h-9 w-full" />
      <div className="flex flex-wrap gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-40" />
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-72 lg:col-span-2" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
