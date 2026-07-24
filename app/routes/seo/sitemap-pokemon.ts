import type { Route } from "./+types/sitemap-pokemon";
import { listPokedexAggregates } from "~/lib/catalog/queries.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { SPECIES } from "~/lib/pokedex/species";
import { speciesSlug } from "~/lib/pokedex/species-slug";

const escapeXml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const NAME_BY_DEX = new Map(SPECIES.map((s) => [s.dex, s.name]));

/** Per-Pokémon hubs (/pokemon/{name}) — EN-only. Only species with enough card
 * coverage (≥3 cards) are listed, to keep thin hubs out of the index. */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const agg = await listPokedexAggregates(db); // US market; hub set is market-independent

  const urls: string[] = [];
  for (const [dex, a] of agg) {
    if (a.cardCount < 3) continue;
    const name = NAME_BY_DEX.get(dex);
    if (!name) continue;
    urls.push(`<url><loc>${env.APP_URL}/pokemon/${escapeXml(speciesSlug(name))}</loc></url>`);
  }

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
