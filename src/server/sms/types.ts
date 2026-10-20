/** SMS delivery for one-time passwords only (D-23: no customer data is ever sent by SMS). SDD §17.1. */
export interface SmsProvider {
  readonly name: "test" | "telesom";
  sendOtp(phoneE164: string, code: string): Promise<{ providerMessageId: string }>;
}

export class SmsNotConfiguredError extends Error {}

export function otpMessage(code: string): string {
  return `Your Sogasho Outdoor code is ${code}. It expires in 5 minutes. Never share it.`;
}
