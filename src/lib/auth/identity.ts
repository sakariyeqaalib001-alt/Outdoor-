import { normalizePhone } from "@/lib/phone";

/**
 * Sign-in identifiers (BRD §6.1, T-16).
 * - Permanent users sign in with their email.
 * - Temporary agents sign in with their phone number. Supabase Auth stores them under an internal
 *   address derived from the E.164 number, so Supabase needs no phone/SMS provider. Agents never see it.
 */
export const AGENT_EMAIL_DOMAIN = "phone.outdoor.sogasho.com";

export type SignInIdentifier =
  | { kind: "email"; key: string; authEmail: string }
  | { kind: "phone"; key: string; authEmail: string };

export function agentAuthEmail(phoneE164: string): string {
  return `agent.${phoneE164.replace(/^\+/, "")}@${AGENT_EMAIL_DOMAIN}`;
}

/** Parse what the user typed in "Phone number or email". `key` is what lockout counts against. */
export function parseIdentifier(input: string): SignInIdentifier | null {
  const value = input.trim();
  if (!value) return null;
  if (value.includes("@")) {
    const email = value.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
    if (email.endsWith(`@${AGENT_EMAIL_DOMAIN}`)) return null; // internal addresses are not typed by users
    return { kind: "email", key: email, authEmail: email };
  }
  const phone = normalizePhone(value);
  if (!phone) return null;
  return { kind: "phone", key: phone, authEmail: agentAuthEmail(phone) };
}
