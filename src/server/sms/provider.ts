import "server-only";
import { createTelesomProvider } from "./telesom";
import { createTestProvider } from "./test-provider";
import { SmsNotConfiguredError, type SmsProvider } from "./types";

export { SmsNotConfiguredError, otpMessage, type SmsProvider } from "./types";

/**
 * SMS_PROVIDER = "test" | "telesom". The test provider is development-only and is refused in production.
 * Production defaults to Telesom (D-20).
 */
export function getSmsProvider(env: NodeJS.ProcessEnv = process.env): SmsProvider {
  const isProduction = env.NODE_ENV === "production";
  const choice = env.SMS_PROVIDER ?? (isProduction ? "telesom" : "test");
  if (choice === "test") {
    if (isProduction) throw new SmsNotConfiguredError("The test SMS provider cannot be used in production.");
    return createTestProvider();
  }
  if (choice === "telesom") return createTelesomProvider(env);
  throw new SmsNotConfiguredError(`Unknown SMS_PROVIDER "${choice}".`);
}
