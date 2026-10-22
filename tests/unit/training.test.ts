import { describe, expect, it } from "vitest";
import { appEnvironment } from "@/lib/environment";
import { t } from "@/lib/i18n";
import { parseEnv, TRAINING_PORT } from "../../scripts/training.mjs";

describe("training site (T-24)", () => {
  it("is switched on only by NEXT_PUBLIC_APP_ENVIRONMENT=training", () => {
    expect(appEnvironment("training")).toBe("training");
    expect(appEnvironment(undefined)).toBe("standard");
    expect(appEnvironment("production")).toBe("standard");
  });

  it("reads .env-style settings (comments, blanks, quotes)", () => {
    const env = parseEnv("# comment\n\nNEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co\nSECRET_NAME=\"quoted value\"\r\nEMPTY=\n");
    expect(env).toEqual({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", SECRET_NAME: "quoted value", EMPTY: "" });
  });

  it("runs next to the normal app and labels itself", () => {
    expect(TRAINING_PORT).not.toBe(3000);
    expect(t("environment.trainingLabel")).toBe("Training site");
  });
});
