/**
 * Sogasho brand tokens — the single TypeScript source for colours used by the app.
 * Values come only from the brand kit (brand/colors/colors.css, SO! Brand Style Guide 2013 v1.1).
 * `src/app/globals.css` must use exactly these values; tests/unit/brand.test.ts checks both
 * that they match and that every text/background pair meets WCAG 2.1 AA.
 *
 * Lavender family is intentionally absent: the source guide lists #00557C for all four
 * lavender swatches (flagged as an error in brand/README.md).
 */

export const palette = {
  green900: "#00557C",
  green700: "#047B95",
  green500: "#0095A9",
  green300: "#03B7B8",
  blue900: "#3E357C",
  blue700: "#3A4789",
  blue500: "#5051A0",
  blue300: "#6364AA",
  purple900: "#5B398D",
  purple700: "#704098",
  purple500: "#824B94",
  purple300: "#9C6BAD",
  pink900: "#76256A",
  pink700: "#96226E",
  pink500: "#B22662",
  pink300: "#CB5084",
  orange900: "#B81F3A",
  orange700: "#D83331",
  orange500: "#E55E32",
  orange300: "#F3A843",
  gray900: "#293033",
  gray700: "#545A60",
  gray500: "#8D939E",
  gray300: "#B6C0CC",
  gray200: "#CFD8DD",
  gray100: "#E2E8ED",
  white: "#FFFFFF",
  black: "#000000",
} as const;

/** Logo tagline colour — logo only, never used as a UI colour (brand rule). */
export const TAGLINE_BLUE = "#143885";

/**
 * shadcn/ui theme variables (CSS custom properties in globals.css :root).
 * Notes:
 * - `primary` is green-700 (#047B95), not green-500: white text on #0095A9 is only ~3.6:1,
 *   below AA for normal text (SDD §22.2). green-500 stays the brand highlight (ring, charts).
 * - shadcn's `accent` is a hover/selection surface, not the brand accent colour.
 *   The brand accent orange is `brand-accent`.
 */
export const themeTokens = {
  "--background": palette.gray100,
  "--foreground": palette.gray900,
  "--card": palette.white,
  "--card-foreground": palette.gray900,
  "--popover": palette.white,
  "--popover-foreground": palette.gray900,
  "--primary": palette.green700,
  "--primary-foreground": palette.white,
  "--secondary": palette.gray100,
  "--secondary-foreground": palette.gray900,
  "--muted": palette.gray100,
  "--muted-foreground": palette.gray700,
  "--accent": palette.gray100,
  "--accent-foreground": palette.green900,
  "--destructive": palette.orange700,
  "--border": palette.gray200,
  "--input": palette.gray500,
  "--ring": palette.green500,
  "--chart-1": palette.green500,
  "--chart-2": palette.orange500,
  "--chart-3": palette.blue500,
  "--chart-4": palette.pink500,
  "--chart-5": palette.purple500,
  "--sidebar": palette.white,
  "--sidebar-foreground": palette.gray900,
  "--sidebar-primary": palette.green700,
  "--sidebar-primary-foreground": palette.white,
  "--sidebar-accent": palette.gray100,
  "--sidebar-accent-foreground": palette.green900,
  "--sidebar-border": palette.gray200,
  "--sidebar-ring": palette.green500,
  "--brand-highlight": palette.green500,
  "--brand-link": palette.green900,
  "--brand-accent": palette.orange500,
  "--brand-success": palette.green300,
  "--brand-warning": palette.orange300,
  "--brand-info": palette.blue500,
} as const;

export type StatusKey =
  | "pending"
  | "approved"
  | "rejected"
  | "flagged"
  | "reversed"
  | "active"
  | "expire"
  | "onHold";

/**
 * Workflow status badge colours (SDD §22.2). Every pair passes 4.5:1.
 * Adjusted from the SDD draft where the draft colour failed contrast:
 * approved green-500 → green-700, reversed gray-500 → gray-700, on hold orange-500 → blue-700
 * (recorded as T-04 in docs/03-implementation/DECISIONS.md).
 */
export const statusColors: Record<StatusKey, { bg: string; fg: string }> = {
  pending: { bg: palette.orange300, fg: palette.gray900 },
  approved: { bg: palette.green700, fg: palette.white },
  rejected: { bg: palette.orange700, fg: palette.white },
  flagged: { bg: palette.purple500, fg: palette.white },
  reversed: { bg: palette.gray700, fg: palette.white },
  active: { bg: palette.green300, fg: palette.gray900 },
  expire: { bg: palette.pink500, fg: palette.white },
  onHold: { bg: palette.blue700, fg: palette.white },
};

/**
 * Dashboard chart colours (Phase 10). Brand-kit colours only; every series also has a text label,
 * so colour is never the only way to tell them apart.
 */
export const productColors: Record<string, string> = {
  FTTA: palette.green700,
  FTTH: palette.purple500,
  FTTB: palette.orange500,
  LTE: palette.blue500,
};
export const segmentColors = { new: palette.green700, retention: palette.blue500 } as const;
export const cityColors = [palette.green700, palette.purple500, palette.orange500, palette.blue500, palette.pink500, palette.green300];
/** Target achievement bands: met / baseline / under (text labels always shown beside them). */
export const bandColors = { met: palette.green700, baseline: palette.orange300, under: palette.orange700 } as const;
export const chartGrid = palette.gray200;
export const chartAxis = palette.gray700;

/** Text/background pairs used by the UI that must meet WCAG AA (4.5:1). */
export const textPairs: Array<{ name: string; fg: string; bg: string }> = [
  { name: "body text on card", fg: palette.gray900, bg: palette.white },
  { name: "body text on page", fg: palette.gray900, bg: palette.gray100 },
  { name: "muted text on card", fg: palette.gray700, bg: palette.white },
  { name: "muted text on page", fg: palette.gray700, bg: palette.gray100 },
  { name: "link on card", fg: palette.green900, bg: palette.white },
  { name: "link on page", fg: palette.green900, bg: palette.gray100 },
  { name: "primary button", fg: palette.white, bg: palette.green700 },
  { name: "destructive button", fg: palette.white, bg: palette.orange700 },
  { name: "active nav item", fg: palette.green900, bg: palette.gray100 },
  ...Object.entries(statusColors).map(([key, c]) => ({
    name: `status ${key}`,
    fg: c.fg,
    bg: c.bg,
  })),
];

/** Non-text UI pairs (input borders, focus ring) that must meet 3:1 (WCAG 1.4.11). */
export const uiPairs: Array<{ name: string; fg: string; bg: string }> = [
  { name: "input border on card", fg: palette.gray500, bg: palette.white },
  { name: "focus ring on card", fg: palette.green500, bg: palette.white },
];

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}
