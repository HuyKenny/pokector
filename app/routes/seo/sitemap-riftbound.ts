import { asc, eq } from "drizzle-orm";

import type { Route } from "./+types/sitemap-riftbound";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { localeAlternates } from "~/lib/i18n/locales";

const escapeXml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** Riftbound catalog sitemap — sets + cards in one file (small catalog). Each
 * <url> is the English loc with hreflang alternates for every locale. */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);

  const [sets, cards] = await Promise.all([
    db
      .select({ slug: schema.riftboundSets.slug, syncedAt: schema.riftboundSets.syncedAt })
      .from(schema.riftboundSets)
      .where(eq(schema.riftboundSets.active, true))
      .orderBy(asc(schema.riftboundSets.id))
      .limit(500),
    db
      .select({ slug: schema.riftboundCards.slug, syncedAt: schema.riftboundCards.syncedAt })
      .from(schema.riftboundCards)
      .where(eq(schema.riftboundCards.active, true))
      .orderBy(asc(schema.riftboundCards.id))
      .limit(40000),
  ]);

  const urlFor = (path: string, syncedAt: Date) => {
    const lastmod = syncedAt.toISOString().slice(0, 10);
    const xhtml = localeAlternates(env.APP_URL, path)
      .map((a) => `<xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${escapeXml(a.href)}"/>`)
      .join("");
    return `<url><loc>${env.APP_URL}${escapeXml(path)}</loc><lastmod>${lastmod}</lastmod>${xhtml}</url>`;
  };

  const urls = [
    ...sets.map((s) => urlFor(`/riftbound/sets/${s.slug}`, s.syncedAt)),
    ...cards.map((c) => urlFor(`/riftbound/cards/${c.slug}`, c.syncedAt)),
  ];

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
