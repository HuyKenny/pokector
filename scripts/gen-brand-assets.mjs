/**
 * Regenerates all Pokector brand assets from the canonical mark geometry
 * (kept in sync with app/components/brand.tsx — see docs/BRAND.md):
 *
 *   public/brand/pokector-icon.svg        (standalone SVG, oklch colors)
 *   public/brand/pokector-icon-192.png
 *   public/brand/pokector-icon-512.png
 *   public/brand/pokector-og.png          (1200×630 social image)
 *   public/favicon.ico                    (PNG-in-ICO, 32 + 16 px)
 *
 * Rendering uses puppeteer-core + a system Chromium ($CHROME_PATH, falling
 * back to /usr/bin/chromium) because the Pi has no rsvg/ImageMagick/sharp —
 * and Chromium resolves the oklch() colors for us. Also prints the sRGB hex
 * of the dark canvas color for root.tsx <meta name="theme-color"> and
 * manifest.webmanifest (update those by hand if the palette changes).
 *
 *   node scripts/gen-brand-assets.mjs
 */
import { Buffer } from "node:buffer";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = join(root, "public", "brand");
mkdirSync(brandDir, { recursive: true });

// Literal oklch values of the palette tokens used by the mark (app/app.css).
const INK = "oklch(0.15 0.025 255)"; // --color-ink-950
const PAPER = "oklch(0.965 0.008 85)"; // --color-paper-100
const CRIMSON = "oklch(0.6 0.2 26)"; // --color-crimson-500
const SPARK = "oklch(0.85 0.15 90)"; // --color-spark-400

/** Same geometry as PokectorIcon in app/components/brand.tsx. */
function iconSvg({ standalone = false } = {}) {
  const xmlns = standalone ? ' xmlns="http://www.w3.org/2000/svg"' : "";
  return `<svg viewBox="0 0 64 64"${xmlns}>
  <rect width="64" height="64" rx="14" fill="${INK}"/>
  <clipPath id="coin"><circle cx="32" cy="32" r="21"/></clipPath>
  <g clip-path="url(#coin)">
    <rect width="64" height="64" fill="${PAPER}"/>
    <path d="M0 0 H64 V16 L38 28 L28 40 L20 36 L0 48 Z" fill="${CRIMSON}"/>
    <path d="M0 48 L20 36 L28 40 L38 28 L64 16" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>
  </g>
  <circle cx="32" cy="32" r="21" fill="none" stroke="${INK}" stroke-width="3.5"/>
  <circle cx="38" cy="28" r="4.5" fill="${SPARK}" stroke="${INK}" stroke-width="2"/>
</svg>`;
}

/** ICO container with embedded PNG images (valid for all modern browsers). */
function buildIco(images /* [{size, buf}] */) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = [];
  for (const { size, buf } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    e.writeUInt8(size >= 256 ? 0 : size, 1); // height
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.buf)]);
}

const OG_HTML = `<!doctype html><html><head><style>
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; overflow: hidden;
    background: ${INK};
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: ${PAPER};
    display: flex; flex-direction: column; justify-content: center;
    padding: 0 96px; position: relative;
  }
  .grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(oklch(1 0 0 / 0.045) 1px, transparent 1px),
      linear-gradient(90deg, oklch(1 0 0 / 0.045) 1px, transparent 1px);
    background-size: 60px 60px;
  }
  .chart { position: absolute; right: 0; bottom: 0; width: 640px; height: 360px; }
  .row { display: flex; align-items: center; gap: 28px; position: relative; }
  .mark { width: 120px; height: 120px; }
  h1 { font-size: 96px; font-weight: 800; letter-spacing: -0.03em; }
  h1 span { color: ${CRIMSON}; }
  p { position: relative; margin-top: 20px; font-size: 34px; color: oklch(0.78 0.015 255); }
  .badge {
    position: relative; margin-top: 36px; display: inline-flex; align-self: flex-start;
    align-items: center; gap: 12px; font-size: 26px; font-weight: 600;
    color: oklch(0.8 0.13 155);
  }
</style></head><body>
  <div class="grid"></div>
  <svg class="chart" viewBox="0 0 640 360" fill="none">
    <path d="M0 330 L110 280 L200 300 L320 210 L420 240 L530 120 L640 60"
      stroke="${CRIMSON}" stroke-width="6" stroke-linejoin="round" opacity="0.9"/>
    <path d="M0 330 L110 280 L200 300 L320 210 L420 240 L530 120 L640 60 V360 H0 Z"
      fill="${CRIMSON}" opacity="0.08"/>
    <circle cx="530" cy="120" r="10" fill="${SPARK}" stroke="${INK}" stroke-width="4"/>
  </svg>
  <div class="row">
    <div class="mark">${iconSvg()}</div>
    <h1>Pok<span>ector</span></h1>
  </div>
  <p>Pokémon TCG collection tracker &amp; card price portfolio</p>
  <div class="badge">▲ Track every card like an asset — free &amp; independent</div>
</body></html>`;

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
  args: ["--no-sandbox", "--disable-gpu", "--force-color-profile=srgb"],
});
try {
  const page = await browser.newPage();

  // Raster icon sizes (transparent background outside the rounded square).
  const pngs = {};
  for (const size of [512, 192, 32, 16]) {
    await page.setViewport({ width: size, height: size });
    await page.setContent(
      `<!doctype html><style>*{margin:0}body{width:${size}px;height:${size}px}svg{display:block;width:100%;height:100%}</style>${iconSvg()}`,
    );
    pngs[size] = await page.screenshot({ type: "png", omitBackground: true });
  }
  writeFileSync(join(brandDir, "pokector-icon-512.png"), pngs[512]);
  writeFileSync(join(brandDir, "pokector-icon-192.png"), pngs[192]);
  writeFileSync(
    join(root, "public", "favicon.ico"),
    buildIco([
      { size: 32, buf: pngs[32] },
      { size: 16, buf: pngs[16] },
    ]),
  );
  writeFileSync(join(brandDir, "pokector-icon.svg"), iconSvg({ standalone: true }) + "\n");

  // Social sharing image.
  await page.setViewport({ width: 1200, height: 630 });
  await page.setContent(OG_HTML);
  writeFileSync(join(brandDir, "pokector-og.png"), await page.screenshot({ type: "png" }));

  // Print the sRGB hex of the dark canvas for theme-color/manifest.
  const hex = await page.evaluate((ink) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { colorSpace: "srgb" });
    ctx.fillStyle = ink;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  }, INK);
  console.log(`ink-950 (${INK}) = ${hex}  ← use in root.tsx theme-color + manifest.webmanifest`);
  console.log("✓ brand assets written to public/brand/ + public/favicon.ico");
} finally {
  await browser.close();
}
