import { describe, expect, it, vi } from "vitest";
import { agentAuthEmail, AGENT_EMAIL_DOMAIN, parseIdentifier } from "@/lib/auth/identity";
import { checkNewPassword } from "@/lib/auth/password-policy";
import { maskPhone, normalizePhone } from "@/lib/phone";
import { getSmsProvider, otpMessage, SmsNotConfiguredError } from "@/server/sms/provider";
import * as script from "../../scripts/create-user.mjs";

describe("phone normalization (D-03)", () => {
  it.each([
    ["0634123456", "+252634123456"],
    ["063 412 3456", "+252634123456"],
    ["634123456", "+252634123456"],
    ["252634123456", "+252634123456"],
    ["+252634123456", "+252634123456"],
    ["00252634123456", "+252634123456"],
    ["+252-63-412-3456", "+252634123456"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "abc", "+44 7700 900123", "0123", "063412345678901", "0034123456"])("rejects %s", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("masks numbers for display", () => {
    expect(maskPhone("+252634123456")).toBe("••••456");
  });
});

describe("sign-in identifier (T-16)", () => {
  it("treats input with @ as a staff email, lower-cased", () => {
    expect(parseIdentifier("  Staff@Sogasho.com ")).toEqual({
      kind: "email",
      key: "staff@sogasho.com",
      authEmail: "staff@sogasho.com",
    });
  });

  it("maps an agent phone to the internal sign-in address", () => {
    expect(parseIdentifier("063 412 3456")).toEqual({
      kind: "phone",
      key: "+252634123456",
      authEmail: `agent.252634123456@${AGENT_EMAIL_DOMAIN}`,
    });
  });

  it("refuses internal addresses typed directly and invalid input", () => {
    expect(parseIdentifier(agentAuthEmail("+252634123456"))).toBeNull();
    expect(parseIdentifier("not an id")).toBeNull();
    expect(parseIdentifier("   ")).toBeNull();
  });

  it("uses the same mapping as the create-user script", () => {
    for (const phone of ["0634123456", "+252651234567", "907123456"]) {
      expect(script.normalizePhone(phone)).toBe(normalizePhone(phone));
      const e164 = normalizePhone(phone)!;
      expect(script.agentAuthEmail(e164)).toBe(agentAuthEmail(e164));
    }
    expect(script.AGENT_EMAIL_DOMAIN).toBe(AGENT_EMAIL_DOMAIN);
  });
});

describe("password policy (T-19)", () => {
  it.each([
    ["short1", "short1", "too_short"],
    ["onlyletters", "onlyletters", "needs_digit"],
    ["12345678", "12345678", "needs_letter"],
    ["goodpass1", "goodpass2", "mismatch"],
    ["goodpass1", "goodpass1", null],
  ])("%s / %s → %s", (password, confirm, expected) => {
    expect(checkNewPassword(password, confirm)).toBe(expected);
  });

  it("generated temporary passwords always satisfy it", () => {
    for (let i = 0; i < 200; i++) {
      const p = script.temporaryPassword();
      expect(p).toHaveLength(12);
      expect(checkNewPassword(p, p)).toBeNull();
    }
  });
});

describe("SMS provider selection (SDD §17.1)", () => {
  it("uses the test provider in development by default", () => {
    expect(getSmsProvider({ NODE_ENV: "development" } as NodeJS.ProcessEnv).name).toBe("test");
  });

  it("refuses the test provider in production", () => {
    expect(() => getSmsProvider({ NODE_ENV: "production", SMS_PROVIDER: "test" } as NodeJS.ProcessEnv)).toThrow(
      SmsNotConfiguredError
    );
  });

  it("defaults to Telesom in production", () => {
    expect(getSmsProvider({ NODE_ENV: "production" } as NodeJS.ProcessEnv).name).toBe("telesom");
  });

  it("Telesom refuses to send without its credentials", async () => {
    const provider = getSmsProvider({ NODE_ENV: "production", SMS_PROVIDER: "telesom" } as NodeJS.ProcessEnv);
    await expect(provider.sendOtp("+252634123456", "123456")).rejects.toThrow(SmsNotConfiguredError);
  });

  it("test provider masks the phone number in its development output", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await getSmsProvider({ NODE_ENV: "development" } as NodeJS.ProcessEnv).sendOtp("+252634123456", "654321");
    expect(info.mock.calls[0][0]).toContain("••••456");
    expect(info.mock.calls[0][0]).not.toContain("634123456");
    info.mockRestore();
  });

  it("OTP message contains only the code — no customer data (FR-NOT-05)", () => {
    expect(otpMessage("123456")).toBe("Your Sogasho Outdoor code is 123456. It expires in 5 minutes. Never share it.");
  });
});
