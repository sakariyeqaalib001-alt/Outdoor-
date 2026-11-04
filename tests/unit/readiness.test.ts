import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/email/deliver", () => ({ deliverPendingEmails: vi.fn(async () => ({ sent: 2, failed: 0, configured: true })) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

const { GET: sendEmails } = await import("@/app/api/cron/send-emails/route");
const { GET: health } = await import("@/app/api/health/route");
const { deliverPendingEmails } = await import("@/server/email/deliver");
const { environmentChecks } = await import("@/server/readiness/queries");

const SECRET = "a".repeat(40);
const request = (auth?: string) => new Request("http://localhost/api/cron/send-emails", { headers: auth ? { authorization: auth } : {} });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(deliverPendingEmails).mockClear();
});

describe("scheduled email sender (Phase 11, T-25)", () => {
  it("sends only with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const auth of [undefined, "Bearer wrong", `Basic ${SECRET}`, `Bearer ${SECRET}x`]) {
      expect((await sendEmails(request(auth))).status).toBe(401);
    }
    expect(deliverPendingEmails).not.toHaveBeenCalled();
    const ok = await sendEmails(request(`Bearer ${SECRET}`));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ sent: 2, failed: 0, configured: true });
  });

  it("is closed when no secret (or a short one) is set", async () => {
    vi.stubEnv("CRON_SECRET", "short");
    expect((await sendEmails(request("Bearer short"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await sendEmails(request("Bearer "))).status).toBe(401);
    expect(deliverPendingEmails).not.toHaveBeenCalled();
  });

  it("the health route exists", () => {
    expect(typeof health).toBe("function");
  });
});

describe("server settings for production (SDD §26.3)", () => {
  const production = {
    NEXT_PUBLIC_APP_ENVIRONMENT: "",
    SUPABASE_SECRET_KEY: "x",
    SMS_PROVIDER: "telesom",
    TELESOM_USERNAME: "x",
    TELESOM_PASSWORD: "x",
    TELESOM_API_KEY: "x",
    EMAIL_PROVIDER: "brevo",
    EMAIL_PROVIDER_API_KEY: "x",
    EMAIL_FROM: "x@sogasho.com",
    APP_BASE_URL: "https://outdoor.sogasho.com",
    CRON_SECRET: SECRET,
  } as unknown as NodeJS.ProcessEnv;

  it("all pass on a complete production setup", () => {
    expect(environmentChecks(production).every((c) => c.ok)).toBe(true);
  });

  it("flags the training build, test SMS, plain http and a missing secret; email is advice only", () => {
    const bad = environmentChecks({ ...production, NEXT_PUBLIC_APP_ENVIRONMENT: "training", SMS_PROVIDER: "test", APP_BASE_URL: "http://x", CRON_SECRET: "", EMAIL_PROVIDER: "log" });
    expect(bad.filter((c) => !c.ok).map((c) => c.key).sort()).toEqual(["baseUrl", "cronSecret", "email", "notTraining", "sms"]);
    expect(bad.find((c) => c.key === "email")?.required).toBe(false);
  });
});
