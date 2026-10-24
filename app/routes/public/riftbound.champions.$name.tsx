import { Link } from "react-router";

import type { Route } from "./+types/riftbound.champions.$name";
import { CardImage } from "~/components/card-image";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { formatMinor } from "~/lib/money/decimal";
import { RIFTBOUND_CHAMPIONS } from "~/lib/riftbound/champions";
import { listRiftboundCardsByChampion } from "~/lib/riftbound/queries.server";
import {
  breadcrumbJsonLd,
  canonicalUrl,
  collectionPageJsonLd,
  JsonLd,
  pageMeta,
} from "~/lib/seo/meta";

/** Riftbound champion hub — every Riftbound card of one LoL champion, ranked by
 * value. Targets "{champion} riftbound" (KD 0). Inline EN, EN-only. */
export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data) return pageMeta({ title: "Riftbound | Pokector", description: "", noindex: true });
  return pageMeta({
    title: `${data.name} Riftbound Cards — List & Prices | Pokector`,
    description: `Every ${data.name} Riftbound (League of Legends TCG) card with live TCGplayer market prices, ranked by value.`,
    canonical: data.canonical,
    noindex: data.cards.length === 0,
    // EN-only page — no hreflang.
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(undefined); // EN-only route
  const champ = RIFTBOUND_CHAMPIONS[params.name];
  if (!champ) throw new Response("Not found", { status: 404 });
  const cards = await listRiftboundCardsByChampion(db, champ.term);
  return {
    slug: params.name,
    name: champ.name,
    cards,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, `/riftbound/champions/${params.name}`)),
    appUrl: env.APP_URL,
  };
}

function money(minor: number | null | undefined): string {
  return minor == null ? "—" : formatMinor(minor, "USD");
}

export default function RiftboundChampionHub({ loaderData }: Route.ComponentProps) {
  const { slug, name, cards, appUrl } = loaderData;
  const lp = useLocalePath();
  const siblings = Object.entries(RIFTBOUND_CHAMPIONS).filter(([s]) => s !== slug);

  return (
    <div className="flex flex-col gap-10">
      <JsonLd
        data={[
          breadcrumbJsonLd(appUrl, [
            { name: "Home", path: "/" },
            { name: "Riftbound", path: "/riftbound" },
            { name: `${name} cards`, path: `/riftbound/champions/${slug}` },
          ]),
          collectionPageJsonLd(appUrl, {
            name: `${name} Riftbound Cards`,
            description: `Every ${name} Riftbound card with live market prices.`,
            path: `/riftbound/champions/${slug}`,
            items: cards
              .slice(0, 25)
              .map((c) => ({ name: c.name, path: `/riftbound/cards/${c.slug}` })),
          }),
        ]}
      />

      <section className="flex flex-col gap-3 pt-4">
        <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
          <Link to={lp("/riftbound")} className="hover:text-fg">
            Riftbound
          </Link>{" "}
          / <span className="text-fg">{name} cards</span>
        </nav>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-fg sm:text-5xl">
          {name} <span className="text-accent">Riftbound Cards</span>
        </h1>
        <p className="max-w-3xl text-lg text-fg-muted">
          Every {name} card in Riftbound: League of Legends Trading Card Game, ranked by current
          market value. Live TCGplayer prices, updated daily.
        </p>
      </section>

      {cards.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface p-6 text-sm text-fg-muted">
          No {name} cards are indexed yet — check back soon.
        </p>
      ) : (
        <section aria-label={`${name} cards`} className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-fg">
            All {name} cards ({cards.length})
          </h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {cards.map((c) => (
              <li key={c.id}>
                <Link
                  to={lp(`/riftbound/cards/${c.slug}`)}
                  className="group flex h-full flex-col gap-2"
                >
                  <CardImage
                    src={c.imageSmallUrl}
                    alt={`${c.name} — ${c.setName} #${c.number}`}
                    imgClassName="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
                    fallbackClassName="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-xs text-fg-faint"
                  />
                  <div>
                    <p className="truncate text-sm font-medium text-fg group-hover:text-accent">
                      {c.name}
                    </p>
                    <p className="truncate text-xs text-fg-faint">
                      {c.setName}
                      {c.priceMinor != null ? ` · ${money(c.priceMinor)}` : ""}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Sibling champions — interlinking */}
      <section
        aria-label="Other champions"
        className="flex flex-col gap-3 border-t border-edge pt-8"
      >
        <h2 className="text-lg font-semibold text-fg">Other Riftbound champions</h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {siblings.map(([s, c]) => (
            <li key={s}>
              <Link
                to={lp(`/riftbound/champions/${s}`)}
                className="rounded-full border border-edge px-3 py-1.5 text-fg-muted hover:border-accent hover:text-fg"
              >
                {c.name}
              </Link>
            </li>
          ))}
          <li>
            <Link
              to={lp("/riftbound/cards")}
              className="rounded-full border border-edge px-3 py-1.5 text-fg-muted hover:border-accent hover:text-fg"
            >
              All cards
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
