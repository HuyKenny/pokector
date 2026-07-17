import { asc, eq } from "drizzle-orm";

import type { Route } from "./+types/sitemap-sets";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";

const escapeXml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const sets = await db
    .select({ slug: schema.pokemonSets.slug, syncedAt: schema.pokemonSets.syncedAt })
    .from(schema.pokemonSets)
    .where(eq(schema.pokemonSets.active, true))
    .orderBy(asc(schema.pokemonSets.id))
    .limit(2000);

  const urls = sets.map(
    (set) =>
      `<url><loc>${env.APP_URL}/sets/${escapeXml(set.slug)}</loc><lastmod>${set.syncedAt
        .toISOString()
        .slice(0, 10)}</lastmod></url>`,
  );

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
