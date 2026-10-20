import "server-only";
import { randomUUID } from "node:crypto";
import { maskPhone } from "@/lib/phone";
import type { SmsProvider } from "./types";

/**
 * Development-only stand-in for Telesom: prints the code in the terminal running `npm run dev`
 * on the owner's computer. Never used in production (getSmsProvider refuses it), so OTPs never
 * reach production logs.
 */
export function createTestProvider(): SmsProvider {
  return {
    name: "test",
    async sendOtp(phoneE164, code) {
      console.info(`[DEV SMS — not sent] OTP for ${maskPhone(phoneE164)}: ${code}`);
      return { providerMessageId: `test-${randomUUID()}` };
    },
  };
}
