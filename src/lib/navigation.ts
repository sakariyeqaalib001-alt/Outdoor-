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
  /** Shown only to users holding at least one of these permissions (SDD §7.3 layer 1). Omit = every signed-in user. */
  permission?: string[];
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
      { key: "performance", label: "nav.performance", href: "/performance", icon: Trophy, brd: ["6.13"], phase: 19, permission: ["performance.read"] },
      { key: "targets", label: "nav.targets", href: "/targets", icon: Target, brd: ["6.3"], phase: 14, permission: ["targets.read","targets.manage"] },
      { key: "notifications", label: "nav.notifications", href: "/notifications", icon: Bell, brd: ["6.16"], phase: 8 },
    ],
  },
  {
    label: "nav.salesGroup",
    items: [
      { key: "sales", label: "nav.sales", href: "/sales", icon: ShoppingBag, brd: ["6.4"], phase: 7, permission: ["sales.create","sales.read"] },
      { key: "free-month", label: "nav.freeMonth", href: "/free-month", icon: Gift, brd: ["6.11"], phase: 7, permission: ["sales.create","sales.read"] },
      { key: "customers", label: "nav.customers", href: "/customers", icon: Contact, brd: ["6.7"], phase: 7, permission: ["customers.read"] },
      { key: "approvals", label: "nav.approvals", href: "/approvals", icon: BadgeCheck, brd: ["6.4", "6.5"], phase: 8, permission: ["retention.review","refunds.approve","stock.adjust.approve","leave.review"] },
      { key: "switches", label: "nav.switches", href: "/switches", icon: ArrowLeftRight, brd: ["6.10"], phase: 8, permission: ["switches.create"] },
      { key: "refunds", label: "nav.refunds", href: "/refunds", icon: ReceiptText, brd: ["6.5"], phase: 12, permission: ["refunds.submit","refunds.approve"] },
      { key: "follow-up", label: "nav.followUp", href: "/follow-up", icon: PhoneCall, brd: ["6.7"], phase: 13, permission: ["followup.read","followup.update"] },
    ],
  },
  {
    label: "nav.stockGroup",
    items: [{ key: "stock", label: "nav.stock", href: "/stock", icon: Boxes, brd: ["6.12"], phase: 6, permission: ["stock.read","stock.receive","stock.transfer"] }],
  },
  {
    label: "nav.controlGroup",
    items: [
      { key: "audit", label: "nav.audit", href: "/audit", icon: ShieldAlert, brd: ["6.6"], phase: 9, permission: ["audit.read","audit.manage"] },
      { key: "reports", label: "nav.reports", href: "/reports", icon: FileBarChart, brd: ["6.14", "9.2"], phase: 15, permission: ["reports.read"] },
      { key: "surveys", label: "nav.surveys", href: "/surveys", icon: ClipboardList, brd: ["6.15"], phase: 18, permission: ["reports.read","integrations.manage"] },
    ],
  },
  {
    label: "nav.peopleGroup",
    items: [
      { key: "payroll", label: "nav.payroll", href: "/payroll", icon: Wallet, brd: ["6.9"], phase: 16, permission: ["payroll.read"] },
      { key: "leave", label: "nav.leave", href: "/leave", icon: CalendarDays, brd: ["6.8"], phase: 17, permission: ["leave.request","leave.review","leave.assign"] },
    ],
  },
  {
    label: "nav.adminGroup",
    items: [
      { key: "users", label: "nav.users", href: "/users", icon: UsersRound, brd: ["6.2"], phase: 4, permission: ["users.read","teams.manage","roles.manage"] },
      { key: "products", label: "nav.products", href: "/products", icon: Tags, brd: ["6.3"], phase: 5, permission: ["prices.manage","settings.manage"] },
      { key: "settings", label: "nav.settings", href: "/settings", icon: Settings, brd: ["6.2"], phase: 5, permission: ["settings.manage"] },
      { key: "design-system", label: "nav.designSystem", href: "/design-system", icon: Palette, brd: [], permission: ["settings.manage"] },
    ],
  },
];

/** Highest roadmap phase that has been built (menu items up to this phase are clickable). Update when a phase is built. */
export const COMPLETED_PHASE = 5;

export function isAvailable(item: NavItem): boolean {
  return item.phase === undefined || item.phase <= COMPLETED_PHASE;
}

/** Menu groups and items the user may see (items without a permission are visible to every signed-in user). */
export function visibleNavigation(permissions: string[]): NavGroup[] {
  const held = new Set(permissions);
  return navigation
    .map((group) => ({ ...group, items: group.items.filter((item) => !item.permission || item.permission.some((p) => held.has(p))) }))
    .filter((group) => group.items.length > 0);
}
