import type { Route } from "./+types/sitemap-static";
import { RARITY_HUB_PATHS } from "~/lib/catalog/rarity-hubs";
import { getCloudflare } from "~/lib/context";
import { RIFTBOUND_CHAMPION_PATHS } from "~/lib/riftbound/champions";
import { localeAlternates } from "~/lib/i18n/locales";

// Translated public pages get a localized <url> per locale, each carrying the
// full hreflang alternate set. English-only pages (legal + blog) stay single.
const TRANSLATED_PATHS = [
  "/",
  "/cards",
  "/sets",
  "/price-movers",
  "/pokedex",
  "/pokemon-card-collectors",
  "/pokemon-card-grading-calculator",
  "/pricing",
];
// English-only pages: legal, contact, and the not-yet-translated hubs
// (/riftbound*, /most-valuable-pokemon-cards) — single <loc>, no hreflang.
// (/blog is emitted by sitemap-blog.ts, so it's intentionally NOT here.)
const EN_ONLY_PATHS = [
  "/methodology",
  "/about",
  "/privacy",
  "/terms",
  "/disclaimer",
  "/contact",
  "/riftbound",
  "/riftbound/cards",
  "/riftbound/sets",
  "/most-valuable-pokemon-cards",
  "/pokemon-sets",
  ...RARITY_HUB_PATHS,
  ...RIFTBOUND_CHAMPION_PATHS,
];

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const origin = env.APP_URL;
  const urls: string[] = [];

  for (const path of TRANSLATED_PATHS) {
    const alternates = localeAlternates(origin, path);
    const xhtml = alternates
      .map((a) => `<xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>`)
      .join("");
    // One <url> per locale variant; each lists all alternates (bidirectional).
    for (const a of alternates) {
      if (a.hreflang === "x-default") continue;
      urls.push(`<url><loc>${a.href}</loc>${xhtml}</url>`);
    }
  }

  for (const path of EN_ONLY_PATHS) {
    urls.push(`<url><loc>${origin}${path === "/" ? "" : path}</loc></url>`);
  }

  return new Response(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
      ...urls,
      "</urlset>",
    ].join("\n"),
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=86400",
      },
    },
  );
}
