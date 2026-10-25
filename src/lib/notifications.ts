import { t, type MessageKey } from "@/lib/i18n";

/** In-app notifications (SDD §18): text and link for each kind. */
export const NOTIFICATION_KINDS = [
  "sale_pending",
  "sale_approved",
  "sale_rejected",
  "switch_pending",
  "switch_approved",
  "switch_rejected",
  "stock_to_accept",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export function notificationText(kind: string, data: Record<string, string>): string {
  if (!(NOTIFICATION_KINDS as readonly string[]).includes(kind)) return kind;
  return t(`notifications.kinds.${kind}` as MessageKey, { agent: data.agent ?? "—", customer: data.customer ?? "—", reason: data.reason ?? "" });
}

export function notificationLink(kind: string, entityId: string): string {
  if (kind === "sale_pending" || kind === "switch_pending") return "/approvals";
  if (kind === "sale_approved" || kind === "sale_rejected") return `/sales/${entityId}`;
  if (kind === "switch_approved" || kind === "switch_rejected") return "/switches";
  if (kind === "stock_to_accept") return "/stock";
  return "/";
}
