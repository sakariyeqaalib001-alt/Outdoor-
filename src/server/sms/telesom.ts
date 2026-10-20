import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { otpMessage, SmsNotConfiguredError, type SmsProvider } from "./types";

/**
 * Telesom SMS gateway (D-20), per the "Telesom SMS Gateway Integration Guide" supplied by Sogasho
 * (gist zakaria-ibr/a3e18fe5911671875c836c1d0ea53a72), with the message encoding CONFIRMED against the
 * live gateway on 20 Oct 2026 (T-20):
 *
 *   POST https://sms.mytelesom.com/index.php/Gway/sendsms/   (application/x-www-form-urlencoded)
 *   username, password, to (252XXXXXXXXX), msg, from (sender ID), date (dd/MM/yyyy, EAT), key
 *   key = UPPERCASE( MD5( username|password|to|msg|from|date|<secret API key> ) )
 *   msg is the plain text (normal spaces) — in the key AND in the request. The request body is standard
 *   form encoding, so Telesom receives exactly the text the key was computed on. (Pre-encoding spaces
 *   as %20 makes Telesom answer "Wrong Hashkey".)
 *   reply: {"status":"success","msg":"…"} or {"status":"error","msg":"…"}
 *
 * Credentials come only from environment settings (SDD §17.1) and are never logged.
 * 10-second timeout, no automatic retry (the user can ask for a new code).
 */
export const TELESOM_DEFAULT_URL = "https://sms.mytelesom.com/index.php/Gway/sendsms/";
const TIMEOUT_MS = 10_000;

export type TelesomConfig = {
  url: string;
  username: string;
  password: string;
  apiKey: string;
  sender: string;
};

export function telesomConfigFromEnv(env: NodeJS.ProcessEnv): TelesomConfig {
  const config = {
    url: env.TELESOM_API_URL || TELESOM_DEFAULT_URL,
    username: env.TELESOM_USERNAME ?? "",
    password: env.TELESOM_PASSWORD ?? "",
    apiKey: env.TELESOM_API_KEY ?? "",
    sender: env.TELESOM_SENDER ?? "",
  };
  const missing = (["username", "password", "apiKey", "sender"] as const).filter((k) => !config[k]);
  if (missing.length > 0) {
    const names = { username: "TELESOM_USERNAME", password: "TELESOM_PASSWORD", apiKey: "TELESOM_API_KEY", sender: "TELESOM_SENDER" };
    throw new SmsNotConfiguredError(`Telesom SMS is not configured (missing ${missing.map((k) => names[k]).join(", ")}).`);
  }
  return config;
}

/** dd/MM/yyyy in East Africa Time (Telesom's local date). */
export function telesomDate(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Mogadishu", day: "2-digit", month: "2-digit", year: "numeric" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return `${parts.day}/${parts.month}/${parts.year}`;
}

/** Build the form body the gateway expects (format confirmed live, T-20). */
export function buildTelesomRequest(config: TelesomConfig, phoneE164: string, text: string, now: Date) {
  const to = phoneE164.replace(/^\+/, "");
  const msg = text;
  const date = telesomDate(now);
  const key = createHash("md5")
    .update(`${config.username}|${config.password}|${to}|${msg}|${config.sender}|${date}|${config.apiKey}`)
    .digest("hex")
    .toUpperCase();
  const body = new URLSearchParams({
    username: config.username,
    password: config.password,
    to,
    msg,
    from: config.sender,
    date,
    key,
  }).toString();
  return { to, msg, date, key, body };
}

export function createTelesomProvider(
  env: NodeJS.ProcessEnv,
  fetchImpl: typeof fetch = fetch,
  clock: () => Date = () => new Date()
): SmsProvider {
  return {
    name: "telesom",
    async sendOtp(phoneE164, code) {
      const config = telesomConfigFromEnv(env);
      const text = otpMessage(code);
      const { body } = buildTelesomRequest(config, phoneE164, text, clock());

      let response: Response;
      try {
        response = await fetchImpl(config.url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new Error("Telesom SMS gateway could not be reached.");
      }

      let reply: { status?: string; msg?: string } | null = null;
      try {
        reply = (await response.json()) as { status?: string; msg?: string };
      } catch {
        reply = null;
      }
      if (!response.ok || reply?.status !== "success") {
        // Safe to report: Telesom's reply text never contains the code or credentials.
        throw new Error(`Telesom SMS refused (${response.status}${reply?.msg ? `: ${reply.msg}` : ""}).`);
      }
      return { providerMessageId: `telesom-${randomUUID()}` };
    },
  };
}
