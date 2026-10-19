/**
 * Business date helpers. All business periods use East Africa Time (UTC+3) — D-24.
 * Timestamps are stored in UTC; these helpers only format or bucket them.
 * The sale month always comes from the server time (D-30), never from the device clock.
 */
export const BUSINESS_TIME_ZONE = "Africa/Mogadishu";

function parts(date: Date): Record<string, string> {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(formatted.map((p) => [p.type, p.value]));
}

/** Business month key, e.g. "2026-10", for a UTC instant. */
export function businessMonth(date: Date): string {
  const p = parts(date);
  return `${p.year}-${p.month}`;
}

/** DD/MM/YYYY in business time. */
export function formatBusinessDate(date: Date): string {
  const p = parts(date);
  return `${p.day}/${p.month}/${p.year}`;
}

/** DD/MM/YYYY HH:mm in business time. */
export function formatBusinessDateTime(date: Date): string {
  const p = parts(date);
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

/** Month label for selectors, e.g. "October 2026". */
export function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}
