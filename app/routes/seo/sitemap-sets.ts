import { asc, eq } from "drizzle-orm";

import type { Route } from "./+types/sitemap-sets";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { localeAlternates } from "~/lib/i18n/locales";

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

  // One <url> per set at the English loc, annotated with hreflang alternates for
  // every locale; the localized set pages are discovered via these + their own
  // on-page hreflang (keeps this sitemap from ballooning by 11×).
  const urls = sets.map((set) => {
    const lastmod = set.syncedAt.toISOString().slice(0, 10);
    const xhtml = localeAlternates(env.APP_URL, `/sets/${set.slug}`)
      .map(
        (a) => `<xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${escapeXml(a.href)}"/>`,
      )
      .join("");
    return `<url><loc>${env.APP_URL}/sets/${escapeXml(set.slug)}</loc><lastmod>${lastmod}</lastmod>${xhtml}</url>`;
  });

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
        "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=86400",
      },
    },
  );
}
