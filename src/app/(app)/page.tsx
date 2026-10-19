import type { Metadata } from "next";
import { LayoutDashboard } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: t("nav.dashboard") };

export default function DashboardPage() {
  return (
    <>
      <AppHeader title={t("dashboard.title")} />
      <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-hidden="true">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent className="space-y-3">
                <Skeleton className="h-8 w-32" />
                <Skeleton className="h-6 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="flex-1">
          <CardContent className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
            <LayoutDashboard className="size-10 text-brand-highlight" aria-hidden="true" />
            <h2 className="text-xl">{t("dashboard.emptyTitle")}</h2>
            <p className="max-w-md text-muted-foreground">{t("dashboard.emptyBody")}</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
