"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { t, type MessageKey } from "@/lib/i18n";

const TABS: { href: string; label: MessageKey }[] = [
  { href: "/users", label: "users.tabUsers" },
  { href: "/users/teams", label: "users.tabTeams" },
  { href: "/users/roles", label: "users.tabRoles" },
];

export function UsersTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label={t("nav.users")} className="flex gap-1 border-b border-border">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-semibold",
              active ? "border-brand-highlight text-brand-link" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t(tab.label)}
          </Link>
        );
      })}
    </nav>
  );
}
