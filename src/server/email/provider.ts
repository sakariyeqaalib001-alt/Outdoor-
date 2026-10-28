/**
 * Email delivery for audit alerts (D-23, SDD §17.3). Messages never contain a phone number or Index Number —
 * only the rule, the case number and a link to the signed-in case page.
 *
 * EMAIL_PROVIDER = "brevo" | "resend" | "log". Unset = email switched off (alerts wait in the queue).
 *   brevo  — https://api.brevo.com/v3/smtp/email; EMAIL_FROM can be a single verified sender address (no DNS change).
 *   resend — https://api.resend.com/emails; EMAIL_FROM must be on a domain verified with Resend.
 *   log    — development only: prints the subject in the terminal instead of sending.
 * EMAIL_PROVIDER_API_KEY comes only from environment settings and is never logged.
 */
export type EmailMessage = { to: string; subject: string; text: string };

export interface EmailProvider {
  readonly name: "brevo" | "resend" | "log";
  send(message: EmailMessage): Promise<void>;
}

export class EmailNotConfiguredError extends Error {}

const TIMEOUT_MS = 10_000;

/** A safe, short error summary: HTTP status only, never the provider's response body. */
export class EmailSendError extends Error {}

async function post(url: string, headers: Record<string, string>, body: unknown, fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new EmailSendError(`Email provider answered HTTP ${response.status}`);
}

export function getEmailProvider(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): EmailProvider {
  const choice = env.EMAIL_PROVIDER?.trim();
  if (!choice) throw new EmailNotConfiguredError("Email is switched off (EMAIL_PROVIDER is not set).");
  if (choice === "log") {
    if (env.NODE_ENV === "production" && env.NEXT_PUBLIC_APP_ENVIRONMENT !== "training") {
      throw new EmailNotConfiguredError("The log email provider cannot be used in production.");
    }
    return { name: "log", send: async (m) => console.info(`[email:log] ${m.subject}`) };
  }
  const key = env.EMAIL_PROVIDER_API_KEY ?? "";
  const from = env.EMAIL_FROM ?? "";
  if (!key || !from) throw new EmailNotConfiguredError("EMAIL_PROVIDER_API_KEY and EMAIL_FROM are required.");
  const fromName = env.EMAIL_FROM_NAME || "Sogasho Outdoor";
  if (choice === "brevo") {
    return {
      name: "brevo",
      send: (m) => post("https://api.brevo.com/v3/smtp/email", { "api-key": key },
        { sender: { email: from, name: fromName }, to: [{ email: m.to }], subject: m.subject, textContent: m.text }, fetchImpl),
    };
  }
  if (choice === "resend") {
    return {
      name: "resend",
      send: (m) => post("https://api.resend.com/emails", { authorization: `Bearer ${key}` },
        { from: `${fromName} <${from}>`, to: [m.to], subject: m.subject, text: m.text }, fetchImpl),
    };
  }
  throw new EmailNotConfiguredError(`Unknown EMAIL_PROVIDER "${choice}".`);
}

/** Absolute link to a page of this app (APP_BASE_URL, else the local port). */
export function appLink(path: string, env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.APP_BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/+$/, "");
  return `${base}${path}`;
}

export function emailText(body: string, link: string): string {
  return `${body}\n\nOpen: ${link}\n\nThis is an automatic message from Sogasho Outdoor. It never contains customer phone numbers or Index Numbers.`;
}
