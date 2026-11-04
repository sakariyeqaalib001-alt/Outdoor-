import { connection } from "next/server";

/**
 * Health check for uptime monitoring (Phase 11, SDD §26.3): answers "ok" with the server time when the app is up.
 * Public on purpose and says nothing about users, data or settings.
 */
export async function GET() {
  await connection();
  return Response.json({ status: "ok", time: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
