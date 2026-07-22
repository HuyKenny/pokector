import { count, eq } from "drizzle-orm";

import type { Route } from "./+types/sitemap-index";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";

export const CARDS_PER_SITEMAP = 5000;

function xml(strings: string[]): Response {
  return new Response(strings.join("\n"), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

/** Sitemap index — chunked card sitemaps scale to the whole catalog (SPEC §23). */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const [{ n: cardCount }] = await db
    .select({ n: count() })
    .from(schema.pokemonCards)
    .where(eq(schema.pokemonCards.active, true));
  const chunks = Math.max(1, Math.ceil(cardCount / CARDS_PER_SITEMAP));

  const entries = [
    `<sitemap><loc>${env.APP_URL}/sitemap-static.xml</loc></sitemap>`,
    `<sitemap><loc>${env.APP_URL}/sitemap-sets.xml</loc></sitemap>`,
    `<sitemap><loc>${env.APP_URL}/sitemap-riftbound.xml</loc></sitemap>`,
    `<sitemap><loc>${env.APP_URL}/sitemap-blog.xml</loc></sitemap>`,
    ...Array.from(
      { length: chunks },
      (_, i) => `<sitemap><loc>${env.APP_URL}/sitemap-cards/${i + 1}</loc></sitemap>`,
    ),
  ];

  return xml([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries,
    "</sitemapindex>",
  ]);
}
