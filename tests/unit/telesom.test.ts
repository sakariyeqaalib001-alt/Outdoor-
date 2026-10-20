import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildTelesomRequest,
  createTelesomProvider,
  TELESOM_DEFAULT_URL,
  telesomDate,
  type TelesomConfig,
} from "@/server/sms/telesom";
import { SmsNotConfiguredError } from "@/server/sms/types";

// Made-up test values — never real credentials.
const config: TelesomConfig = {
  url: TELESOM_DEFAULT_URL,
  username: "test_user",
  password: "test_pass",
  apiKey: "test_secret_key",
  sender: "SOGASHO",
};
const env = {
  NODE_ENV: "production",
  SMS_PROVIDER: "telesom",
  TELESOM_USERNAME: config.username,
  TELESOM_PASSWORD: config.password,
  TELESOM_API_KEY: config.apiKey,
  TELESOM_SENDER: config.sender,
} as NodeJS.ProcessEnv;
const NOW = new Date("2026-10-31T21:30:00Z"); // 1 Nov 2026, 00:30 in Hargeisa

function md5Upper(value: string) {
  return createHash("md5").update(value).digest("hex").toUpperCase();
}

function fakeFetch(status: number, reply: unknown) {
  return vi.fn(async () => new Response(typeof reply === "string" ? reply : JSON.stringify(reply), { status }));
}

describe("Telesom gateway request (guide: gist zakaria-ibr/a3e18fe5…)", () => {
  it("uses the business date in East Africa Time as dd/MM/yyyy", () => {
    expect(telesomDate(NOW)).toBe("01/11/2026");
    expect(telesomDate(new Date("2026-05-20T08:00:00Z"))).toBe("20/05/2026");
  });

  it("builds the body and key exactly as the guide specifies", () => {
    const r = buildTelesomRequest(config, "+252634123456", "Your code is 123456.", NOW);
    expect(r.to).toBe("252634123456");
    expect(r.msg).toBe("Your%20code%20is%20123456.");
    expect(r.key).toBe(md5Upper("test_user|test_pass|252634123456|Your%20code%20is%20123456.|SOGASHO|01/11/2026|test_secret_key"));
    expect(r.key).toMatch(/^[0-9A-F]{32}$/);
    expect(r.body).toBe(
      `username=test_user&password=test_pass&to=252634123456&msg=Your%20code%20is%20123456.&from=SOGASHO&date=01/11/2026&key=${r.key}`
    );
  });

  it("POSTs form data to the Telesom address and accepts a success reply", async () => {
    const fetchImpl = fakeFetch(200, { status: "success", msg: "Message delivered" });
    const provider = createTelesomProvider(env, fetchImpl as unknown as typeof fetch, () => NOW);
    const result = await provider.sendOtp("+252634123456", "654321");
    expect(result.providerMessageId).toMatch(/^telesom-/);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sms.mytelesom.com/index.php/Gway/sendsms/");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(String(init.body)).toContain("msg=Your%20Sogasho%20Outdoor%20code%20is%20654321.");
    expect(String(init.body)).toContain("to=252634123456");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("treats an error reply as a failure, with Telesom's reason", async () => {
    const provider = createTelesomProvider(env, fakeFetch(200, { status: "error", msg: "message is required" }) as unknown as typeof fetch, () => NOW);
    await expect(provider.sendOtp("+252634123456", "654321")).rejects.toThrow(/message is required/);
  });

  it("treats a non-JSON or HTTP error reply as a failure", async () => {
    const provider = createTelesomProvider(env, fakeFetch(500, "<html>error</html>") as unknown as typeof fetch, () => NOW);
    await expect(provider.sendOtp("+252634123456", "654321")).rejects.toThrow(/refused \(500\)/);
  });

  it("reports an unreachable gateway without leaking credentials", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const provider = createTelesomProvider(env, failing as unknown as typeof fetch, () => NOW);
    const error = await provider.sendOtp("+252634123456", "654321").catch((e: Error) => e);
    expect(String(error)).toMatch(/could not be reached/);
    expect(String(error)).not.toMatch(/test_pass|test_secret_key|654321/);
  });

  it("refuses to send when a credential is missing", async () => {
    const provider = createTelesomProvider({ ...env, TELESOM_API_KEY: "" }, fakeFetch(200, {}) as unknown as typeof fetch);
    await expect(provider.sendOtp("+252634123456", "654321")).rejects.toThrow(SmsNotConfiguredError);
  });

  it("allows overriding the address via TELESOM_API_URL", async () => {
    const fetchImpl = fakeFetch(200, { status: "success" });
    const provider = createTelesomProvider(
      { ...env, TELESOM_API_URL: "https://example.test/sendsms/" },
      fetchImpl as unknown as typeof fetch,
      () => NOW
    );
    await provider.sendOtp("+252634123456", "111111");
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe("https://example.test/sendsms/");
  });
});
