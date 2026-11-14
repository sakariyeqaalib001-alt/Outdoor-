"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { isAvailable, visibleNavigation } from "@/lib/navigation";
import { t } from "@/lib/i18n";

/**
 * Sidebar menu filtered by the signed-in user's permissions (SDD §7.3 layer 1).
 * Display only: pages and the database check permissions again.
 */
export function SidebarNav({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();
  return (
    <>
      {visibleNavigation(permissions).map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel className="brand-title h-7 text-white/70">{t(group.label)}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const available = isAvailable(item);
                const active = available && (item.href === "/" ? pathname === "/" : pathname.startsWith(item.href));
                const label = t(item.label);
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.key}>
                    {available ? (
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={label}
                        className="text-white/85 hover:text-white data-[active=true]:font-semibold data-[active=true]:text-white data-[active=true]:shadow-[inset_3px_0_0_var(--brand-success)]"
                      >
                        <Link href={item.href} aria-current={active ? "page" : undefined}>
                          <Icon />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    ) : (
                      <>
                        <SidebarMenuButton disabled aria-disabled="true" tooltip={t("nav.comingInPhase", { phase: item.phase ?? "" })}>
                          <Icon />
                          <span>{label}</span>
                        </SidebarMenuButton>
                        <SidebarMenuBadge className="text-white/70">P{item.phase}</SidebarMenuBadge>
                      </>
                    )}
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
