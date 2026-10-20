import "server-only";
import { SmsNotConfiguredError, type SmsProvider } from "./types";

/**
 * Telesom SMS (D-20). Credentials come only from environment settings (SDD §17.1) and are never logged.
 *
 * BLOCKED (Phase 3 gate): Telesom's API request format is not public and has not been provided yet
 * (Roadmap R-6). Once Sogasho supplies Telesom's API guide (endpoint, method, parameter names,
 * success/error responses), implement `send` below with a 10-second timeout and no automatic retry.
 * Until then this provider refuses to send, and development uses SMS_PROVIDER=test.
 */
const REQUIRED = ["TELESOM_API_URL", "TELESOM_SENDER"] as const;

export function createTelesomProvider(env: NodeJS.ProcessEnv): SmsProvider {
  return {
    name: "telesom",
    async sendOtp() {
      const missing = REQUIRED.filter((key) => !env[key]);
      if (missing.length > 0) {
        throw new SmsNotConfiguredError(`Telesom SMS is not configured (missing ${missing.join(", ")}).`);
      }
      throw new SmsNotConfiguredError(
        "Telesom SMS request format not implemented yet — waiting for Telesom's API guide (Roadmap R-6)."
      );
    },
  };
}
