import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio, palette, textPairs, themeTokens, uiPairs } from "@/lib/brand";

const css = readFileSync(path.resolve(import.meta.dirname, "../../src/app/globals.css"), "utf8");
const brandKitCss = readFileSync(
  path.resolve(import.meta.dirname, "../../brand/colors/colors.css"),
  "utf8"
);

const brandKitHexes = new Set(
  [...brandKitCss.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0].toUpperCase())
);
brandKitHexes.add("#FFFFFF");
brandKitHexes.add("#000000");

function rootVariables(source: string): Map<string, string> {
  const root = source.match(/:root\s*\{([\s\S]*?)\}/);
  if (!root) throw new Error(":root block not found in globals.css");
  const vars = new Map<string, string>();
  for (const m of root[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars.set(m[1], m[2].trim());
  return vars;
}

describe("brand palette", () => {
  it("uses only colours from the brand kit", () => {
    for (const [name, hex] of Object.entries(palette)) {
      expect(brandKitHexes.has(hex.toUpperCase()), `${name} ${hex} not in brand kit`).toBe(true);
    }
  });
});

describe("globals.css theme", () => {
  const vars = rootVariables(css);

  it("matches src/lib/brand.ts exactly", () => {
    for (const [name, hex] of Object.entries(themeTokens)) {
      expect(vars.get(name)?.toUpperCase(), name).toBe(hex.toUpperCase());
    }
  });

  it("contains no colour outside the brand kit", () => {
    const hexes = [...css.matchAll(/#[0-9A-Fa-f]{6}\b/g)].map((m) => m[0].toUpperCase());
    for (const hex of hexes) expect(brandKitHexes.has(hex), `${hex} not in brand kit`).toBe(true);
  });

  it("has no dark theme", () => {
    expect(css).not.toMatch(/\.dark\s*\{/);
  });

  it("uses Signika as the only font", () => {
    expect(css).toMatch(/--font-sans:\s*var\(--font-signika\)/);
    expect(css).not.toMatch(/geist/i);
  });
});

describe("WCAG AA contrast", () => {
  it.each(textPairs)("$name passes 4.5:1", ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(uiPairs)("$name passes 3:1", ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it("computes known ratios", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 0);
    expect(contrastRatio("#FFFFFF", "#0095A9")).toBeLessThan(4.5); // why primary is green-700
  });
});
