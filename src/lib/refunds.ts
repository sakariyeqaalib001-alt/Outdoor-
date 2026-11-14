import type { StatusKey } from "@/lib/brand";

/** Refunds (Phase 12, BRD §6.5). The database enforces every rule; this only drives the screens. */
export const REFUND_REASONS = ["out_of_boundary", "technical_delay", "refused", "no_signal", "other"] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export const REFUND_STATUSES = ["pending", "approved", "rejected"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_BADGE: Record<RefundStatus, StatusKey> = { pending: "pending", approved: "approved", rejected: "rejected" };

/** A refund amount: more than 0, not more than the amount collected, whole cents (FR-REF-06). */
export function validRefundAmount(amount: number, collected: number): boolean {
  return Number.isFinite(amount) && amount > 0 && amount <= collected && Math.round(amount * 100) === amount * 100;
}

/** "Other" needs a note of at least 3 characters (FR-REF-02). */
export function reasonComplete(reason: string, note: string): boolean {
  if (!(REFUND_REASONS as readonly string[]).includes(reason)) return false;
  return reason !== "other" || note.trim().length >= 3;
}
