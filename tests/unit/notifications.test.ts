import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NOTIFICATION_KINDS, notificationLink, notificationText } from "@/lib/notifications";

describe("notifications (SDD §18)", () => {
  it("cover exactly the kinds the database allows", () => {
    const migration = readFileSync(path.resolve(import.meta.dirname, "../../supabase/migrations/20261025090000_approvals_switches.sql"), "utf8");
    const check = migration.match(/kind\s+text not null check \(kind in \(([^)]+)\)\)/);
    const kinds = [...(check?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(kinds).toEqual([...NOTIFICATION_KINDS].sort());
  });

  it("have a readable text and a link for every kind", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const text = notificationText(kind, { agent: "Ayaan", customer: "Hodan", reason: "Wrong name" });
      expect(text, kind).not.toMatch(/^notifications\./);
      expect(text.length).toBeGreaterThan(10);
      expect(notificationLink(kind, "abc")).toMatch(/^\//);
    }
    expect(notificationText("sale_rejected", { customer: "Hodan", reason: "Wrong name" })).toContain("Wrong name");
  });
});
