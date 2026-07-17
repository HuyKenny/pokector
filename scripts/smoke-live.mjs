/**
 * Post-deploy hydration + CSP smoke test (headless Chromium).
 *
 *   node scripts/smoke-live.mjs https://pokector.com
 *
 * Verifies on /sets/pitch-black-me5 (or the newest set with scrydex images):
 *   1. every card image actually loads (CSP img-src regression guard),
 *   2. clicking a filter chip changes the URL and the visible card count
 *      (hydration regression guard — dev CSP uses 'unsafe-inline', so only a
 *      deployed environment exercises the nonce-based CSP path),
 *   3. no console/page errors.
 *
 * Requires puppeteer-core (a devDependency of this package) and a system
 * Chromium/Chrome binary. The binary path is picked up from $CHROME_PATH
 * (set by the CI runner) and falls back to the Raspberry Pi's system
 * Chromium at /usr/bin/chromium for local/manual runs.
 *
 *   node scripts/smoke-live.mjs https://pokector.com
 */
import puppeteer from "puppeteer-core";

const base = (process.argv[2] ?? "").replace(/\/$/, "");
if (!base.startsWith("http")) {
  console.error("Usage: node scripts/smoke-live.mjs <base-url>");
  process.exit(1);
}
const target = `${base}/sets/pitch-black-me5`;
const executablePath = process.env.CHROME_PATH || "/usr/bin/chromium";

const browser = await puppeteer.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-gpu"],
});
const failures = [];
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push(`PAGEERROR: ${String(e).slice(0, 200)}`));

  await page.goto(target, { waitUntil: "networkidle2", timeout: 60_000 });

  // Card images are lazy-loaded — scroll through the page so below-the-fold
  // images actually start loading before we assert on them.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 800) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 150));
    }
    window.scrollTo(0, 0);
  });
  await new Promise((r) => setTimeout(r, 3000));

  // 1) images
  const img = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("ul img")];
    return {
      total: imgs.length,
      broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).length,
    };
  });
  if (img.total === 0) failures.push("no card images found on the set page");
  if (img.broken > 0)
    failures.push(`${img.broken}/${img.total} images failed to load (CSP img-src?)`);

  // 2) hydration: clicking a chip must change the URL and the card count
  const countCards = () => page.evaluate(() => document.querySelectorAll("ul.grid > li").length);
  const before = await countCards();
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Common",
    );
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!clicked) failures.push('filter chip "Common" not found');
  await new Promise((r) => setTimeout(r, 2500));
  const after = await countCards();
  if (!page.url().includes("rarity=Common")) {
    failures.push(`URL did not change after filter click (hydration dead?): ${page.url()}`);
  }
  if (clicked && after >= before) {
    failures.push(`card count did not shrink after Common filter (${before} → ${after})`);
  }

  // 3) console errors
  if (consoleErrors.length > 0) {
    failures.push(`console errors:\n  - ${consoleErrors.slice(0, 5).join("\n  - ")}`);
  }

  console.log(
    `smoke-live ${target}\n  images: ${img.total - img.broken}/${img.total} loaded\n  filter: ${before} → ${after} cards, url=${page.url()}\n  console errors: ${consoleErrors.length}`,
  );
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error("\nFAILURES:");
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
console.log("✓ smoke-live passed");
