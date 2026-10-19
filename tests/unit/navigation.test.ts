import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { navigation } from "@/lib/navigation";
import { t } from "@/lib/i18n";

const brdDir = path.resolve(import.meta.dirname, "../../docs/01-business");
const brdFile = readdirSync(brdDir).find((f) => /_BRD_v[\d.]+\.md$/.test(f));
if (!brdFile) throw new Error("BRD not found in docs/01-business");
const brd = readFileSync(path.join(brdDir, brdFile), "utf8");

/** BRD §6 modules that are screens (6.1 Login is the sign-in page; retired sections are excluded). */
const moduleSections = [...brd.matchAll(/^## (6\.\d+) (.+)$/gm)]
  .map((m) => ({ section: m[1], title: m[2].trim() }))
  .filter((m) => m.section !== "6.1" && !/retired/i.test(m.title));

const items = navigation.flatMap((g) => g.items);

describe("sidebar covers every BRD module", () => {
  it("finds the BRD modules", () => {
    expect(moduleSections.length).toBeGreaterThanOrEqual(15);
  });

  it.each(moduleSections)("§$section $title has a sidebar item", ({ section }) => {
    expect(items.some((i) => i.brd.includes(section))).toBe(true);
  });

  it("has the dashboard (§9.1) and reports (§9.2)", () => {
    expect(items.some((i) => i.brd.includes("9.1"))).toBe(true);
    expect(items.some((i) => i.brd.includes("9.2"))).toBe(true);
  });

  it("uses unique keys and routes, and every label is translated", () => {
    expect(new Set(items.map((i) => i.key)).size).toBe(items.length);
    expect(new Set(items.map((i) => i.href)).size).toBe(items.length);
    for (const i of items) expect(t(i.label)).not.toBe(i.label);
  });
});
