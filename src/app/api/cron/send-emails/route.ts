import { timingSafeEqual } from "node:crypto";
import { deliverPendingEmails } from "@/server/email/deliver";

/**
 * Scheduled sender for queued alert emails (Phase 11; D-41, T-25). The host's scheduler calls this every
 * 5 minutes with `Authorization: Bearer <CRON_SECRET>` (Vercel Cron sends exactly this header), so emails go
 * out even when nobody opens a page. Without the right secret it does nothing. Answers with counts only.
 */
function authorised(header: string | null): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 32 || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorised(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }
  const result = await deliverPendingEmails();
  return Response.json(result);
}
