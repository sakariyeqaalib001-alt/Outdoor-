import {
  ArrowLeftRight,
  BadgeCheck,
  Boxes,
  CalendarDays,
  ClipboardList,
  Contact,
  FileBarChart,
  LayoutDashboard,
  Palette,
  PhoneCall,
  ReceiptText,
  Settings,
  ShieldAlert,
  ShoppingBag,
  Target,
  Trophy,
  UsersRound,
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
 * Sidebar structure — every BRD module (§6). Phase 4 replaces the static list with
 * permission-driven items (hiding a menu item is never a security control — SDD §7.3).
 * Free-month compensation is part of Sales (FR-FREE-01), not a separate menu item.
 */
export const navigation: NavGroup[] = [
  {
    label: "nav.main",
    items: [
      { key: "dashboard", label: "nav.dashboard", href: "/", icon: LayoutDashboard },
      { key: "performance", label: "nav.performance", href: "/performance", icon: Trophy, phase: 19 },
      { key: "targets", label: "nav.targets", href: "/targets", icon: Target, phase: 14 },
    ],
  },
  {
    label: "nav.salesGroup",
    items: [
      { key: "sales", label: "nav.sales", href: "/sales", icon: ShoppingBag, phase: 7 },
      { key: "customers", label: "nav.customers", href: "/customers", icon: Contact, phase: 7 },
      { key: "approvals", label: "nav.approvals", href: "/approvals", icon: BadgeCheck, phase: 8 },
      { key: "switches", label: "nav.switches", href: "/switches", icon: ArrowLeftRight, phase: 8 },
      { key: "refunds", label: "nav.refunds", href: "/refunds", icon: ReceiptText, phase: 12 },
      { key: "follow-up", label: "nav.followUp", href: "/follow-up", icon: PhoneCall, phase: 13 },
    ],
  },
  {
    label: "nav.stockGroup",
    items: [{ key: "stock", label: "nav.stock", href: "/stock", icon: Boxes, phase: 6 }],
  },
  {
    label: "nav.controlGroup",
    items: [
      { key: "audit", label: "nav.audit", href: "/audit", icon: ShieldAlert, phase: 9 },
      { key: "reports", label: "nav.reports", href: "/reports", icon: FileBarChart, phase: 15 },
      { key: "surveys", label: "nav.surveys", href: "/surveys", icon: ClipboardList, phase: 18 },
    ],
  },
  {
    label: "nav.peopleGroup",
    items: [
      { key: "payroll", label: "nav.payroll", href: "/payroll", icon: Wallet, phase: 16 },
      { key: "leave", label: "nav.leave", href: "/leave", icon: CalendarDays, phase: 17 },
    ],
  },
  {
    label: "nav.adminGroup",
    items: [
      { key: "users", label: "nav.users", href: "/users", icon: UsersRound, phase: 4 },
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
