import { asc, eq } from "drizzle-orm";

import type { Route } from "./+types/sitemap-cards";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { CARDS_PER_SITEMAP } from "./sitemap-index";

const escapeXml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const chunk = Number.parseInt(params.chunk, 10);
  if (!Number.isFinite(chunk) || chunk < 1 || chunk > 50) {
    throw new Response("Not Found", { status: 404 });
  }

  const db = createDb(env.DB);
  const cards = await db
    .select({
      slug: schema.pokemonCards.slug,
      syncedAt: schema.pokemonCards.syncedAt,
      sourceUpdatedAt: schema.pokemonCards.sourceUpdatedAt,
    })
    .from(schema.pokemonCards)
    .where(eq(schema.pokemonCards.active, true))
    .orderBy(asc(schema.pokemonCards.id))
    .limit(CARDS_PER_SITEMAP)
    .offset((chunk - 1) * CARDS_PER_SITEMAP);

  if (cards.length === 0) throw new Response("Not Found", { status: 404 });

  const urls = cards.map((card) => {
    const lastmod = card.sourceUpdatedAt ?? card.syncedAt.toISOString().slice(0, 10);
    return `<url><loc>${env.APP_URL}/cards/${escapeXml(card.slug)}</loc><lastmod>${lastmod}</lastmod></url>`;
  });

  return new Response(
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      ...urls,
      "</urlset>",
    ].join("\n"),
    {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=86400",
      },
    },
  );
}
