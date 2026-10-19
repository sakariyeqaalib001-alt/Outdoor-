"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CircleUserRound } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/layout/brand-logo";
import { navigation, isAvailable } from "@/lib/navigation";
import { t } from "@/lib/i18n";

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <Link href="/" className="flex items-center justify-center group-data-[collapsible=icon]:hidden">
          <BrandLogo variant="primary" height={44} priority />
        </Link>
        <Link href="/" className="hidden items-center justify-center group-data-[collapsible=icon]:flex">
          <BrandLogo variant="mark" height={30} className="!p-0" />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {navigation.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="brand-title">{t(group.label)}</SidebarGroupLabel>
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
                          className="data-[active=true]:font-semibold data-[active=true]:shadow-[inset_3px_0_0_var(--brand-highlight)]"
                        >
                          <Link href={item.href} aria-current={active ? "page" : undefined}>
                            <Icon />
                            <span>{label}</span>
                          </Link>
                        </SidebarMenuButton>
                      ) : (
                        <>
                          <SidebarMenuButton
                            disabled
                            aria-disabled="true"
                            tooltip={t("nav.comingInPhase", { phase: item.phase ?? "" })}
                          >
                            <Icon />
                            <span>{label}</span>
                          </SidebarMenuButton>
                          <SidebarMenuBadge className="text-muted-foreground">P{item.phase}</SidebarMenuBadge>
                        </>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip={t("user.notSignedIn")}>
              <CircleUserRound className="!size-8 text-muted-foreground" />
              <span className="flex flex-col leading-tight">
                <span className="font-semibold">{t("user.notSignedIn")}</span>
                <span className="text-xs text-muted-foreground">{t("user.signInPhase")}</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
