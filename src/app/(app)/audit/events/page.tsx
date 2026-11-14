import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessDenied } from "@/components/access-denied";
import { AppHeader } from "@/components/layout/app-header";
import { Skeleton } from "@/components/ui/skeleton";
import { isRuleCode, RULE_CODES } from "@/lib/audit";
import { t } from "@/lib/i18n";
import { listEvents } from "@/server/audit/queries";
import { can, getAccess } from "@/server/auth/access";
import { AuditTabs, EventCard, FilterChips, ruleName } from "../audit-ui";

export const metadata: Metadata = { title: t("audit.tabEvents") };

type Search = Promise<Record<string, string | string[] | undefined>>;

/** Every rule hit, newest first (FR-AUD-03). Events are never edited or deleted. */
async function Events({ searchParams }: { searchParams: Search }) {
  const access = await getAccess();
  if (!can(access, "audit.read")) return <AccessDenied />;
  const params = await searchParams;
  const rule = typeof params.rule === "string" && isRuleCode(params.rule) ? params.rule : undefined;
  const events = await listEvents(rule);
  const chips = [{ key: "all", href: "/audit/events", label: t("audit.filterAll") }, ...RULE_CODES.map((c) => ({ key: c, href: `/audit/events?rule=${c}`, label: ruleName(c) }))];
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t("audit.eventsIntro")}</p>
      <FilterChips items={chips} active={rule ?? "all"} />
      {events.length === 0 ? (
        <p className="rounded-lg border bg-white p-6 text-center text-sm text-muted-foreground">{t("audit.noEvents")}</p>
      ) : (
        <div className="grid gap-3">{events.map((e) => <EventCard key={e.id} event={e} />)}</div>
      )}
    </div>
  );
}

export default function EventsPage({ searchParams }: { searchParams: Search }) {
  return (
    <>
      <AppHeader title={t("audit.title")} />
      <div className="flex flex-col gap-4 p-4 md:p-6">
        <AuditTabs />
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <Events searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
