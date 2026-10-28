import Link from "next/link";
import { after } from "next/server";
import { Bell } from "lucide-react";
import { t } from "@/lib/i18n";
import { unreadCount } from "@/server/approvals/queries";
import { deliverPendingEmails } from "@/server/email/deliver";

/** Bell with the unread count, in the top bar (SDD §18). Rendered inside a Suspense boundary. */
export async function NotificationBell() {
  let count = 0;
  try {
    count = await unreadCount();
  } catch {
    return null;
  }
  // Waiting alert emails also go out whenever anyone opens a page (the in-app bell is the main alert, D-41).
  after(() => deliverPendingEmails().catch(() => undefined));
  const label = count > 0 ? `${t("notifications.bell")} — ${t("notifications.unread", { count })}` : t("notifications.bell");
  return (
    <Link href="/notifications" aria-label={label} className="relative inline-flex size-9 items-center justify-center rounded-md hover:bg-muted">
      <Bell aria-hidden="true" className="size-5" />
      {count > 0 ? (
        <span className="absolute -top-0.5 -right-0.5 min-w-5 rounded-full bg-primary px-1 text-center text-xs font-semibold leading-5 text-primary-foreground tabular-nums">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
