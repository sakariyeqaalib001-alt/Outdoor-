import "server-only";
import { appEnvironment } from "@/lib/environment";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Pilot readiness (Phase 11). The database works out every check (public.readiness_report); nothing is decided here. */

async function client() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Supabase is not configured");
  return supabase;
}

export type ReadinessCheck = { check_key: string; required: boolean; ok: boolean; n: number; detail: string[] };

export async function getReadiness(cityId: string): Promise<ReadinessCheck[]> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("readiness_report", { p_city: cityId });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReadinessCheck[];
}

export type OpeningStockRow = {
  item_id: string;
  code: string;
  name: string;
  received: number;
  adjusted: number;
  central: number;
  faulty: number;
  teams: number;
  in_transit: number;
  issued: number;
  removed: number;
  difference: number;
};

export async function getOpeningStock(): Promise<OpeningStockRow[]> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("opening_stock_summary");
  if (error) throw new Error(error.message);
  return (data ?? []) as OpeningStockRow[];
}

export type EnvCheck = { key: string; ok: boolean; required: boolean };

/**
 * Server settings needed in production (SDD §26.3). Only says whether each is set correctly — never shows a value.
 * On staging or the training site several of these are expected to fail; they must all pass on production.
 */
export function environmentChecks(env: NodeJS.ProcessEnv = process.env): EnvCheck[] {
  const set = (name: string) => Boolean(env[name]?.trim());
  const email = env.EMAIL_PROVIDER?.trim();
  return [
    { key: "notTraining", required: true, ok: appEnvironment(env.NEXT_PUBLIC_APP_ENVIRONMENT) !== "training" },
    { key: "secretKey", required: true, ok: set("SUPABASE_SECRET_KEY") },
    {
      key: "sms",
      required: true,
      ok: env.SMS_PROVIDER === "telesom" && set("TELESOM_USERNAME") && set("TELESOM_PASSWORD") && set("TELESOM_API_KEY"),
    },
    { key: "email", required: false, ok: (email === "brevo" || email === "resend") && set("EMAIL_PROVIDER_API_KEY") && set("EMAIL_FROM") },
    { key: "baseUrl", required: true, ok: /^https:\/\//.test(env.APP_BASE_URL ?? "") },
    { key: "cronSecret", required: true, ok: (env.CRON_SECRET?.length ?? 0) >= 32 },
  ];
}
