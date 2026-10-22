"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { t, type MessageKey } from "@/lib/i18n";

/** Underlined tab links between the sub-pages of one screen (Users, Settings). */
export function PageTabs({ label, tabs }: { label: MessageKey; tabs: { href: string; label: MessageKey }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={t(label)} className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-semibold",
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
