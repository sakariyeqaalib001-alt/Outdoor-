import {
  ArrowLeftRight,
  BadgeCheck,
  Bell,
  Boxes,
  CalendarDays,
  ClipboardList,
  Contact,
  FileBarChart,
  Gift,
  LayoutDashboard,
  Palette,
  PhoneCall,
  ReceiptText,
  Settings,
  ShieldAlert,
  ShoppingBag,
  Tags,
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
  /** BRD sections this item delivers (e.g. "6.11"). tests/unit/navigation.test.ts checks every BRD module is covered. */
  brd: string[];
  /** Roadmap phase that delivers the module; items whose phase is not built yet are shown disabled. */
  phase?: number;
};

export type NavGroup = { label: MessageKey; items: NavItem[] };

/**
 * Sidebar structure — one entry per BRD module (§6.2–6.16, §9). §6.1 Login is the sign-in page, not a menu item;
 * §6.17 is retired. Phase 4 makes the list permission-driven (hiding a menu item is never a security control — SDD §7.3).
 */
export const navigation: NavGroup[] = [
  {
    label: "nav.main",
    items: [
      { key: "dashboard", label: "nav.dashboard", href: "/", icon: LayoutDashboard, brd: ["9.1"] },
      { key: "performance", label: "nav.performance", href: "/performance", icon: Trophy, brd: ["6.13"], phase: 19 },
      { key: "targets", label: "nav.targets", href: "/targets", icon: Target, brd: ["6.3"], phase: 14 },
      { key: "notifications", label: "nav.notifications", href: "/notifications", icon: Bell, brd: ["6.16"], phase: 8 },
    ],
  },
  {
    label: "nav.salesGroup",
    items: [
      { key: "sales", label: "nav.sales", href: "/sales", icon: ShoppingBag, brd: ["6.4"], phase: 7 },
      { key: "free-month", label: "nav.freeMonth", href: "/free-month", icon: Gift, brd: ["6.11"], phase: 7 },
      { key: "customers", label: "nav.customers", href: "/customers", icon: Contact, brd: ["6.7"], phase: 7 },
      { key: "approvals", label: "nav.approvals", href: "/approvals", icon: BadgeCheck, brd: ["6.4", "6.5"], phase: 8 },
      { key: "switches", label: "nav.switches", href: "/switches", icon: ArrowLeftRight, brd: ["6.10"], phase: 8 },
      { key: "refunds", label: "nav.refunds", href: "/refunds", icon: ReceiptText, brd: ["6.5"], phase: 12 },
      { key: "follow-up", label: "nav.followUp", href: "/follow-up", icon: PhoneCall, brd: ["6.7"], phase: 13 },
    ],
  },
  {
    label: "nav.stockGroup",
    items: [{ key: "stock", label: "nav.stock", href: "/stock", icon: Boxes, brd: ["6.12"], phase: 6 }],
  },
  {
    label: "nav.controlGroup",
    items: [
      { key: "audit", label: "nav.audit", href: "/audit", icon: ShieldAlert, brd: ["6.6"], phase: 9 },
      { key: "reports", label: "nav.reports", href: "/reports", icon: FileBarChart, brd: ["6.14", "9.2"], phase: 15 },
      { key: "surveys", label: "nav.surveys", href: "/surveys", icon: ClipboardList, brd: ["6.15"], phase: 18 },
    ],
  },
  {
    label: "nav.peopleGroup",
    items: [
      { key: "payroll", label: "nav.payroll", href: "/payroll", icon: Wallet, brd: ["6.9"], phase: 16 },
      { key: "leave", label: "nav.leave", href: "/leave", icon: CalendarDays, brd: ["6.8"], phase: 17 },
    ],
  },
  {
    label: "nav.adminGroup",
    items: [
      { key: "users", label: "nav.users", href: "/users", icon: UsersRound, brd: ["6.2"], phase: 4 },
      { key: "products", label: "nav.products", href: "/products", icon: Tags, brd: ["6.3"], phase: 5 },
      { key: "settings", label: "nav.settings", href: "/settings", icon: Settings, brd: ["6.2"], phase: 5 },
      { key: "design-system", label: "nav.designSystem", href: "/design-system", icon: Palette, brd: [] },
    ],
  },
];

/** Highest roadmap phase that has been built and accepted. Update at each phase gate. */
export const COMPLETED_PHASE = 1;

export function isAvailable(item: NavItem): boolean {
  return item.phase === undefined || item.phase <= COMPLETED_PHASE;
}
