# Sogasho (SO!) Brand Assets

Extracted from *SO! Brand Style Guide 2013 v1.1* (`reference/SO-Brand-Style-Guide.pdf`). Everything a stock management system UI needs: logo files, colours, fonts, pattern, usage rules. `brand.json` is the machine-readable manifest.

## Folder map

```
logo/
  svg/  so-mark.svg                     mark only (SO! triangles), transparent
        so-logo-primary.svg             mark + blue tagline, transparent — use on white
        so-logo-primary-on-white.svg    same, with white background baked in
        so-logo-primary-clearspace.svg  primary lockup with the 1.5x isolation area included
        so-logo-reverse.svg             mark + WHITE tagline, transparent — use on black
        so-logo-reverse-on-black.svg    same, with black background baked in
  png/  primary/  so-logo-primary-{64,128,256,512,1024}.png, so-logo-primary-min-30.png
        reverse/  so-logo-reverse-{…}.png (transparent), so-logo-reverse-on-black-{…}.png
        mark/     so-mark-{64,128,256,512,1024}.png
  icons/ so-icon-{16,32,48,64,128,180,192,256,512}.png   favicon / app icon / PWA
  _geometry.json  measured proportions (mark 529.39 × 224.95, x = 54.12, clearspace = 1.5x)
colors/  colors.css  colors.json  _colors.scss  tailwind.colors.js  swatches.png
fonts/   fonts.css  Signika-Variable.ttf  web/signika-{300,400,600,700}.{woff2,woff}  OFL.txt
pattern/ so-triangle-pattern.jpg (600px)  so-triangle-pattern-full.jpg (841×2488)
reference/ SO-Brand-Style-Guide.pdf
```

## Logo rules (from the guide)

- The logotype is 85 triangles forming **S**, **O** and **!**. Always accompany it with the tagline **so gasho!** (Somali). An English tagline version exists in the brand but is not shown in the guide.
- Backgrounds: **white** (primary) or **pure black** (reverse, tagline turns white). No other background colour is permitted.
- Minimum size: 10 mm print, **30 px high on screen**. No maximum.
- Isolation area: **1.5x** on all sides, where x = height of the dot of the exclamation mark (x = 24 % of mark height). Increase where possible.
- Never stretch, rotate, recolour, redraw, add or remove elements, or change the relationship between mark and tagline.
- Tagline colour on white is `#143885` (Signika Bold, lowercase). Do not reuse this blue elsewhere in the UI.

### Suggested placement in the app
- App header / login page: `so-logo-primary.svg` at 40–48 px high on white, or `so-logo-reverse.svg` on a black sidebar.
- Compact navigation / collapsed sidebar: `so-mark.svg` (mark only) at ≥ 30 px.
- Favicon: `icons/so-icon-32.png`; PWA: `so-icon-192.png`, `so-icon-512.png`; Apple touch: `so-icon-180.png`.
- Printed reports / invoices: `so-logo-primary.svg`, ≥ 10 mm high.

## Colour

Six primary families (greens, blues, lavenders, purples, pinks, oranges), four steps each, plus six greys. Tokens are `--so-{family}-{900|700|500|300}` and `--so-gray-{900…100}` in `colors/colors.css`.

Recommended UI mapping (in `colors.css` as semantic tokens):
- primary `#0095A9` (green-500), primary-dark `#00557C`
- accent `#E55E32` (orange-500)
- text `#293033`, muted `#545A60`, border `#CFD8DD`, surface `#E2E8ED`
- success `#03B7B8`, warning `#F3A843`, danger `#D83331`, info `#5051A0`

Note: the source PDF lists `#00557C` for all four lavender swatches and `R18 G2 B192` next to `#B6C0CC` for gray-300. These look like errors in the guide; the hex values are kept as printed. Confirm with the brand owner before relying on the lavender family.

## Typography

**Signika** only (SIL Open Font License).
- Semibold (600): titles, large headings, 14 pt and above. **Titles always lowercase.**
- Light (300): body copy in print at 9/10/12 pt.
- Regular (400): body copy on screen and anywhere Light/Semibold read poorly at small sizes.
- Bold (700): used for the logo tagline.

Load with `fonts/fonts.css` (self-hosted) or the Google Fonts link inside it. Suggested UI scale: body 14–16 px Regular, table cells 14 px, section titles 20–24 px Semibold lowercase, page titles 28–32 px Semibold lowercase.

## Pattern

`pattern/` holds the multicolour triangle pattern used as the guide's side panel. Use sparingly as a decorative strip (login page edge, report cover), never behind the logo or body text.
