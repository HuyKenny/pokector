# Pokector — Brand & Visual Identity

Last updated: 2026-07-17 (redesign: "Pokémon nod × trading platform", owner-approved)

## Design direction

Premium collector dashboard with a trading-platform feel: dark navy canvas,
crimson primary accent, financial data presented like a portfolio. **Dark mode is
the default experience** — a first-time visitor with no stored preference gets
dark; light stays available in Settings ("system" follows the OS).

### Owner-approved deviations from SPEC §5 (2026-07-17)

docs/SPEC.md §5 _suggests_ a mint-accent/coral-secondary palette. The owner
approved replacing it with **crimson-on-dark-navy** (evokes both the hobby's
red/white ball colors and dark-red trading platforms). All hard _prohibitions_
in SPEC §5 still hold and are respected:

- No Poké Ball shape (see "Logo" below for why ours isn't one) — **do not "fix"
  the mark toward the franchise shape.**
- No yellow+blue as the dominant pairing — spark yellow exists only as a tiny
  highlight color, never as a dominant surface.
- No official Pokémon fonts/characters/graphics, no Collectr design/palette/copy.
- System fonts only, no runtime font downloads.

## Logo

Original geometric design (`app/components/brand.tsx`): a circular
"collector's coin" split by a **rising price-chart line** into a crimson upper
region and a light lower region, with an off-center spark-yellow data-point dot,
inside a dark rounded square.

Why it is legally defensible (and must stay that way):

- The regions are divided by a **jagged rising chart polyline**, not a horizontal
  band — the Poké Ball's registered trade dress is red top / white bottom split
  by a _horizontal black band with a centered button_.
- The dot is **off-center, small, and sits on the chart line** as a data point,
  not a centered button.
- The wordmark is plain type: `Pok` in foreground + `ector` in accent.

Canonical geometry lives in **two places that must be kept in sync**:
`app/components/brand.tsx` (uses palette classes) and
`scripts/gen-brand-assets.mjs` (uses literal oklch values).

## Palette

Defined once in `app/app.css` (`@theme` = light values, `.dark` block =
overrides). Everything in `app/` uses **semantic tokens** — never raw ramp
colors or Tailwind default colors in routes/components.

Ramps (raw, referenced only from app.css and the brand mark):

| Ramp              | Role                                            | Key value                                       |
| ----------------- | ----------------------------------------------- | ----------------------------------------------- |
| `ink-600…950`     | dark navy neutrals (dark canvas/surfaces)       | `ink-950` = `oklch(0.15 0.025 255)` = `#050b16` |
| `paper-50…300`    | warm off-white neutrals (light canvas/surfaces) | `paper-100` = `oklch(0.965 0.008 85)`           |
| `crimson-300…700` | brand red (accent)                              | `crimson-500` = `oklch(0.6 0.2 26)`             |
| `spark-300…600`   | electric yellow — **small highlights only**     | `spark-400` = `oklch(0.85 0.15 90)`             |
| `steel-300…700`   | neutral secondary                               | `steel-500` = `oklch(0.55 0.03 255)`            |

Semantic tokens (what code actually uses): `canvas`, `surface`,
`surface-raised`, `edge`, `fg`, `fg-muted`, `fg-faint`, `accent`,
`accent-strong`, `accent-soft`, `on-accent`, `secondary`, `secondary-soft`,
`on-secondary`, `highlight`, `highlight-soft`, `positive`, `negative`,
`warning`, `focus`.

Rules:

- **Text on filled controls**: always `text-(color:--color-on-accent)` /
  `-on-secondary` — never `text-white` (dark mode uses bright fills with dark
  ink text; hardcoded white fails AA there).
- **P&L colors ≠ brand red**: `negative` is rose-shifted (hue 15) so losses
  never read as the crimson CTA color (hue 26); `positive` is green.
- **Spark yellow**: badges, glints, the logo data-point, focus ring in dark.
  Never large fills, never paired with blue as a dominant combination (SPEC §5).
- **Contrast**: every text/bg token pair must clear WCAG AA 4.5:1 in both
  themes — verified by the axe Playwright suite (`pnpm test:e2e`).
- **Charts**: Chart.js can't resolve CSS variables — `history-chart.tsx` reads
  `--color-accent` from computed styles at mount (and re-reads on theme change).

## Assets & regeneration

All raster assets are generated — never hand-edited:

```bash
source scripts/env.sh
node scripts/gen-brand-assets.mjs
```

Outputs: `public/brand/pokector-icon.svg`, `pokector-icon-{192,512}.png`,
`pokector-og.png` (1200×630 social image), `public/favicon.ico` (PNG-in-ICO
32+16 px). Rendering uses puppeteer-core + system Chromium (`$CHROME_PATH`,
default `/usr/bin/chromium`) because the Pi has no rsvg/ImageMagick/sharp.

The script prints the sRGB hex of `ink-950` (currently `#050b16`) — if the
palette changes, update by hand: `<meta name="theme-color">` in `app/root.tsx`
and `background_color`/`theme_color` in `public/manifest.webmanifest`.
