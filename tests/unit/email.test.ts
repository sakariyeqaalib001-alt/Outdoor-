import { describe, expect, it, vi } from "vitest";
import { appLink, EmailNotConfiguredError, emailText, getEmailProvider } from "@/server/email/provider";

const message = { to: "admin@example.test", subject: "Audit alert: Duplicate phone number (case #7)", text: "body" };

function fakeFetch(status = 201) {
  return vi.fn<typeof fetch>(async () => new Response("{}", { status }));
}

describe("email provider (SDD §17.3, T-25)", () => {
  it("is off until EMAIL_PROVIDER is set, and needs a key and sender", () => {
    expect(() => getEmailProvider({} as NodeJS.ProcessEnv)).toThrow(EmailNotConfiguredError);
    expect(() => getEmailProvider({ EMAIL_PROVIDER: "brevo" } as unknown as NodeJS.ProcessEnv)).toThrow(EmailNotConfiguredError);
    expect(() => getEmailProvider({ EMAIL_PROVIDER: "other", EMAIL_PROVIDER_API_KEY: "k", EMAIL_FROM: "a@b.c" } as unknown as NodeJS.ProcessEnv)).toThrow(/Unknown/);
  });

  it("refuses the log provider in production", () => {
    expect(() => getEmailProvider({ EMAIL_PROVIDER: "log", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toThrow(EmailNotConfiguredError);
  });

  it("sends through Brevo with the key in a header, never in the body", async () => {
    const f = fakeFetch();
    const p = getEmailProvider({ EMAIL_PROVIDER: "brevo", EMAIL_PROVIDER_API_KEY: "secret-key", EMAIL_FROM: "alerts@example.test" } as unknown as NodeJS.ProcessEnv, f as unknown as typeof fetch);
    await p.send(message);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((init!.headers as Record<string, string>)["api-key"]).toBe("secret-key");
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({ sender: { email: "alerts@example.test" }, to: [{ email: "admin@example.test" }], subject: message.subject });
    expect(String(init!.body)).not.toContain("secret-key");
  });

  it("sends through Resend with a bearer token", async () => {
    const f = fakeFetch(200);
    const p = getEmailProvider({ EMAIL_PROVIDER: "resend", EMAIL_PROVIDER_API_KEY: "re_x", EMAIL_FROM: "alerts@example.test" } as unknown as NodeJS.ProcessEnv, f as unknown as typeof fetch);
    await p.send(message);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init!.headers as Record<string, string>).authorization).toBe("Bearer re_x");
  });

  it("reports a failure as the HTTP status only", async () => {
    const f = vi.fn(async () => new Response("{\"message\":\"details with admin@example.test\"}", { status: 401 }));
    const p = getEmailProvider({ EMAIL_PROVIDER: "brevo", EMAIL_PROVIDER_API_KEY: "k", EMAIL_FROM: "a@example.test" } as unknown as NodeJS.ProcessEnv, f as unknown as typeof fetch);
    await expect(p.send(message)).rejects.toThrow(/^Email provider answered HTTP 401$/);
  });

  it("builds absolute links and a footer with no customer identifiers", () => {
    expect(appLink("/audit/cases/1", { APP_BASE_URL: "https://outdoor.example.test/" } as unknown as NodeJS.ProcessEnv)).toBe("https://outdoor.example.test/audit/cases/1");
    expect(appLink("/audit", { PORT: "3001" } as unknown as NodeJS.ProcessEnv)).toBe("http://localhost:3001/audit");
    expect(emailText("Body", "http://x/a")).toContain("Open: http://x/a");
  });
});
