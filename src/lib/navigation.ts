import {
  BadgeCheck,
  Boxes,
  CalendarDays,
  FileBarChart,
  LayoutDashboard,
  Palette,
  PhoneCall,
  Settings,
  ShieldAlert,
  ShoppingBag,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { MessageKey } from "@/lib/i18n";

export type NavItem = {
  key: string;
  label: MessageKey;
  href: string;
  icon: LucideIcon;
  /** Roadmap phase that delivers the module; items whose phase is not built yet are shown disabled. */
  phase?: number;
};

export type NavGroup = { label: MessageKey; items: NavItem[] };

/**
 * Sidebar structure. Phase 4 replaces the static list with permission-driven items
 * (hiding a menu item is never a security control — SDD §7.3).
 */
export const navigation: NavGroup[] = [
  {
    label: "nav.main",
    items: [{ key: "dashboard", label: "nav.dashboard", href: "/", icon: LayoutDashboard }],
  },
  {
    label: "nav.operations",
    items: [
      { key: "sales", label: "nav.sales", href: "/sales", icon: ShoppingBag, phase: 7 },
      { key: "approvals", label: "nav.approvals", href: "/approvals", icon: BadgeCheck, phase: 8 },
      { key: "stock", label: "nav.stock", href: "/stock", icon: Boxes, phase: 6 },
      { key: "follow-up", label: "nav.followUp", href: "/follow-up", icon: PhoneCall, phase: 13 },
    ],
  },
  {
    label: "nav.management",
    items: [
      { key: "audit", label: "nav.audit", href: "/audit", icon: ShieldAlert, phase: 9 },
      { key: "reports", label: "nav.reports", href: "/reports", icon: FileBarChart, phase: 15 },
      { key: "payroll", label: "nav.payroll", href: "/payroll", icon: Wallet, phase: 16 },
      { key: "leave", label: "nav.leave", href: "/leave", icon: CalendarDays, phase: 17 },
      { key: "settings", label: "nav.settings", href: "/settings", icon: Settings, phase: 5 },
      { key: "design-system", label: "nav.designSystem", href: "/design-system", icon: Palette },
    ],
  },
];

/** Highest roadmap phase that has been built and accepted. Update at each phase gate. */
export const COMPLETED_PHASE = 1;

export function isAvailable(item: NavItem): boolean {
  return item.phase === undefined || item.phase <= COMPLETED_PHASE;
}
