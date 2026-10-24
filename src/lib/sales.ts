import type { MessageKey } from "@/lib/i18n";

/** Shared by the sales form (browser) and the sales server code (Phase 7). */

export type CustomerType = "new" | "retention";
export type SaleStatus = "approved" | "pending_approval" | "rejected" | "reversed";

export const MONTHS_PAID_MAX = 12;

/** Database error codes from public.create_sale / change_customer_identifier → message keys. */
export const SALE_ERRORS: Record<string, MessageKey> = {
  "not allowed": "users.errors.notAllowed",
  INVALID_REQUEST: "sales.errors.request",
  CUSTOMER_TYPE: "sales.errors.customerType",
  NAME_REQUIRED: "sales.errors.name",
  INVALID_PHONE: "sales.errors.phone",
  PHONE_PREFIX: "sales.errors.phonePrefix",
  INVALID_INDEX: "sales.errors.index",
  CITY_REQUIRED: "sales.errors.city",
  CITY_OVERRIDE: "sales.errors.cityOverride",
  DISTRICT_REQUIRED: "sales.errors.district",
  AREA_REQUIRED: "sales.errors.area",
  BRANCH_REQUIRED: "sales.errors.branch",
  PLAN_REQUIRED: "sales.errors.plan",
  NO_PRICE: "sales.errors.noPrice",
  MONTHS_PAID: "sales.errors.months",
  FREE_MONTH_NOT_QUALIFIED: "sales.errors.freeMonth",
  INVALID_LINES: "stock.errors.quantity",
  INVALID_QUANTITY: "stock.errors.quantity",
  DUPLICATE_ITEM: "stock.errors.duplicate",
  UNKNOWN_ITEM: "stock.errors.unknownItem",
  INSUFFICIENT_STOCK: "sales.errors.stock",
  NO_TEAM_STOCK: "sales.errors.noTeam",
  REASON_REQUIRED: "stock.errors.reason",
  IDENTIFIER_TAKEN: "sales.errors.identifierTaken",
  NOT_FOUND: "users.errors.genericError",
};

/** Duplicate results (status "duplicate") → message keys, by rule and field. */
export function duplicateMessage(rule: string, field: string): MessageKey {
  if (rule === "DUP_PHONE") return field === "phone_and_index" ? "sales.dup.both" : "sales.dup.phone";
  if (rule === "DUP_INDEX") return "sales.dup.index";
  if (rule === "SAME_MONTH") return "sales.dup.sameMonth";
  if (field === "name") return "sales.dup.name";
  if (field === "former_number") return "sales.dup.former";
  return "sales.dup.conflict";
}

/** Amount collected = recharge × months + installation fee (D-36). Free month = 2 months. */
export function amountCollected(recharge: number, installation: number, months: number, freeMonth: boolean): number {
  const m = freeMonth ? 2 : months;
  return Math.round((recharge * m + installation) * 100) / 100;
}

/** Free month needs 2 months of the plan to reach the setting (default $50). */
export function freeMonthQualifies(recharge: number, freeMonthAmount: number): boolean {
  return recharge * 2 >= freeMonthAmount;
}

/** "2026-10" → "2026-10-01" (database sale_month) and back. */
export const monthStart = (monthKey: string) => `${monthKey}-01`;
export const monthKeyOf = (date: string) => date.slice(0, 7);

/** The current month and the previous `count` months, newest first ("2026-10", "2026-09", …). */
export function recentMonths(current: string, count = 12): string[] {
  const [y, m] = current.split("-").map(Number);
  return Array.from({ length: count + 1 }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

/** Index Number check used by the form before sending (the database checks again). */
export const isValidIndex = (value: string) => /^[0-9]{8}$/.test(value.trim());
