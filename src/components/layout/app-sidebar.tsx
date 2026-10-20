"use client";

import Link from "next/link";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarRail } from "@/components/ui/sidebar";
import { BrandLogo } from "@/components/layout/brand-logo";

export function AppSidebar({ nav, footer }: { nav: React.ReactNode; footer: React.ReactNode }) {
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

      <SidebarContent>{nav}</SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">{footer}</SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
