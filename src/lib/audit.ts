import type { StatusKey } from "@/lib/brand";
import type { MessageKey } from "@/lib/i18n";

/** Audit cases (Phase 9, SDD §11.3, D-13). The database enforces every transition; this only drives the screens. */
export const CASE_STATUSES = ["open", "under_review", "confirmed_issue", "false_positive", "resolved"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const CASE_BADGE: Record<CaseStatus, StatusKey> = {
  open: "pending",
  under_review: "flagged",
  confirmed_issue: "rejected",
  false_positive: "reversed",
  resolved: "approved",
};

/** Next states allowed from each state (mirrors public.audit_case_set_status). */
export const NEXT_STATUS: Record<CaseStatus, CaseStatus[]> = {
  open: ["under_review"],
  under_review: ["confirmed_issue", "false_positive"],
  confirmed_issue: ["resolved"],
  false_positive: ["resolved"],
  resolved: [],
};

export const RULE_CODES = [
  "DUP_PHONE",
  "DUP_INDEX",
  "IDENTITY_CONFLICT",
  "SAME_MONTH",
  "SWITCH_MISMATCH",
  "MULTI_AGENT_ATTEMPT",
  "BURST",
  "POST_APPROVAL_EDIT",
  "IDENTITY_CORRECTED",
  "SELF_APPROVED",
  "HIGH_REFUND_RATE",
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

export function isRuleCode(code: string): code is RuleCode {
  return (RULE_CODES as readonly string[]).includes(code);
}

/** Rule thresholds that Super Admin may change, with the database's limits. */
export const RULE_THRESHOLDS: Partial<Record<RuleCode, { key: string; label: MessageKey; min: number; max: number }[]>> = {
  MULTI_AGENT_ATTEMPT: [
    { key: "agents", label: "audit.threshold.agents", min: 2, max: 10 },
    { key: "days", label: "audit.threshold.days", min: 1, max: 90 },
  ],
  BURST: [
    { key: "sales", label: "audit.threshold.sales", min: 2, max: 50 },
    { key: "minutes", label: "audit.threshold.minutes", min: 5, max: 1440 },
  ],
  HIGH_REFUND_RATE: [
    { key: "percent", label: "audit.threshold.percent", min: 1, max: 100 },
    { key: "refunds", label: "audit.threshold.refunds", min: 1, max: 50 },
    { key: "days", label: "audit.threshold.days", min: 1, max: 365 },
  ],
};

/** Labels for the values an event records (what was attempted). Unknown keys are shown as they are. */
export const ATTEMPT_FIELDS: Record<string, MessageKey> = {
  full_name: "audit.fields.full_name",
  phone: "audit.fields.phone",
  index: "audit.fields.index",
  customer_type: "audit.fields.customer_type",
  from_product: "audit.fields.from_product",
  to_product: "audit.fields.to_product",
  field: "audit.fields.field",
  old_value: "audit.fields.old_value",
  new_value: "audit.fields.new_value",
  reason: "audit.fields.reason",
  agents: "audit.fields.agents",
  agent_names: "audit.fields.agent_names",
  days: "audit.fields.days",
  sales: "audit.fields.sales",
  minutes: "audit.fields.minutes",
  changed: "audit.fields.changed",
};

export function formatAttemptValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Database error codes → messages. */
export const AUDIT_ERRORS: Record<string, MessageKey> = {
  NOTE_REQUIRED: "audit.errors.note",
  INVALID_TRANSITION: "audit.errors.transition",
  CASE_RESOLVED: "audit.errors.resolved",
  ASSIGNEE_INVALID: "audit.errors.assignee",
  TITLE_REQUIRED: "audit.errors.title",
  RULE_REQUIRED: "audit.errors.ruleRequired",
  THRESHOLD_INVALID: "audit.errors.threshold",
  NOT_FOUND: "audit.errors.notFound",
  "not allowed": "audit.errors.forbidden",
};
