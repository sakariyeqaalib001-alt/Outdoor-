import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBusinessDateTime } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { notificationLink, notificationText } from "@/lib/notifications";
import { cn } from "@/lib/utils";
import { markAllRead } from "@/server/approvals/actions";
import { listNotifications } from "@/server/approvals/queries";

export const metadata: Metadata = { title: t("nav.notifications") };

async function Notifications() {
  const rows = await listNotifications();
  const unread = rows.filter((r) => !r.read_at).length;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-3">
      {unread > 0 ? (
        <form action={markAllRead} className="flex justify-end">
          <Button type="submit" variant="outline" className="h-11 md:h-9">{t("notifications.markAll")}</Button>
        </form>
      ) : null}
      {rows.length === 0 ? (
        <p className="rounded-lg border bg-white p-6 text-center text-muted-foreground">{t("notifications.none")}</p>
      ) : (
        <ul className="grid gap-2">
          {rows.map((n) => (
            <li key={n.id}>
              <Link
                href={notificationLink(n.kind, n.entity_id)}
                className={cn("block rounded-lg border bg-white p-4 hover:bg-muted", !n.read_at && "border-l-4 border-l-brand-highlight")}
              >
                <div className={cn("text-sm", !n.read_at && "font-semibold")}>{notificationText(n.kind, n.data)}</div>
                <div className="mt-1 text-xs text-muted-foreground tabular-nums">{formatBusinessDateTime(new Date(n.created_at))}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <>
      <AppHeader title={t("notifications.title")} />
      <div className="p-4 md:p-6">
        <Suspense fallback={<Skeleton className="mx-auto h-64 w-full max-w-3xl" />}>
          <Notifications />
        </Suspense>
      </div>
    </>
  );
}
