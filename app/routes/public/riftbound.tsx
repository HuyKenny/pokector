import { Link } from "react-router";

import type { Route } from "./+types/riftbound";
import { CardImage } from "~/components/card-image";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { formatMinor } from "~/lib/money/decimal";
import {
  listRiftboundCards,
  listRiftboundSets,
  listRiftboundTopValueCards,
} from "~/lib/riftbound/queries.server";
import { canonicalUrl, collectionPageJsonLd, JsonLd, pageMeta } from "~/lib/seo/meta";

/** Riftbound landing / "Riftbound card tracker" — a real, indexable page (not a
 * redirect) so /riftbound can rank for the tracker keyword. English copy, like
 * the rest of the Riftbound UI (localization deferred). */
export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "Riftbound Card Tracker — live prices & catalog | Pokector",
    description:
      "Track Riftbound (League of Legends TCG) card prices. Browse the full catalog and every set with live TCGplayer market prices, updated daily.",
    canonical: data?.canonical,
    alternates: data ? { appUrl: data.appUrl, path: "/riftbound" } : undefined,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(params.locale);
  const [sets, topCards, firstPage] = await Promise.all([
    listRiftboundSets(db),
    listRiftboundTopValueCards(db, 12),
    listRiftboundCards(db, { page: 1 }),
  ]);
  return {
    locale,
    sets,
    topCards,
    totalCards: firstPage.total,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, "/riftbound")),
    appUrl: env.APP_URL,
  };
}

export default function RiftboundLanding({ loaderData }: Route.ComponentProps) {
  const { sets, topCards, totalCards, appUrl } = loaderData;
  const lp = useLocalePath();

  return (
    <div className="flex flex-col gap-14">
      <JsonLd
        data={collectionPageJsonLd(appUrl, {
          name: "Riftbound Card Tracker",
          description:
            "Riftbound (League of Legends TCG) sets and cards with live market prices.",
          path: "/riftbound",
          items: sets.map((s) => ({ name: s.name, path: `/riftbound/sets/${s.slug}` })),
        })}
      />

      {/* Hero */}
      <section className="flex flex-col items-center gap-5 pt-6 text-center">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-fg sm:text-5xl">
          Riftbound <span className="text-accent">Card Tracker</span>
        </h1>
        <p className="max-w-2xl text-lg text-fg-muted">
          Live market prices for the Riftbound: League of Legends Trading Card Game.
          Track {totalCards.toLocaleString("en-US")} cards across {sets.length} sets —
          prices from TCGplayer, updated daily.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            to={lp("/riftbound/cards")}
            className="rounded-xl bg-accent px-6 py-3 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
          >
            Browse cards
          </Link>
          <Link
            to={lp("/riftbound/sets")}
            className="rounded-xl border border-edge px-6 py-3 font-medium text-fg hover:bg-surface-raised"
          >
            Browse sets
          </Link>
        </div>
      </section>

      {/* Top value cards */}
      {topCards.length > 0 ? (
        <section aria-label="Most valuable Riftbound cards" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold text-fg">Most valuable cards</h2>
            <Link to={lp("/riftbound/cards")} className="text-sm text-accent hover:underline">
              All cards →
            </Link>
          </div>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {topCards.map((c) => (
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
                      {c.priceMinor !== null ? ` · ${formatMinor(c.priceMinor, "USD")}` : ""}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Sets */}
      {sets.length > 0 ? (
        <section aria-label="Riftbound sets" className="flex flex-col gap-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-semibold text-fg">Sets</h2>
            <Link to={lp("/riftbound/sets")} className="text-sm text-accent hover:underline">
              All sets →
            </Link>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((s) => (
              <li key={s.id}>
                <Link
                  to={lp(`/riftbound/sets/${s.slug}`)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface px-4 py-3 hover:border-accent"
                >
                  <span className="truncate font-medium text-fg">{s.name}</span>
                  <span className="shrink-0 text-sm text-fg-faint">
                    {s.cardCount.toLocaleString("en-US")} cards
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* SEO copy */}
      <section className="flex flex-col gap-3 border-t border-edge pt-8 text-sm text-fg-muted">
        <h2 className="text-lg font-semibold text-fg">About the Riftbound card tracker</h2>
        <p className="max-w-3xl">
          Pokector's Riftbound tracker follows the live secondary-market value of every
          card in Riot Games' Riftbound: League of Legends Trading Card Game. Prices are
          sourced from the TCGplayer marketplace aggregate and refreshed daily, with a
          price-history chart on each card so you can see how values move over time.
        </p>
        <p className="max-w-3xl">
          Browse the{" "}
          <Link to={lp("/riftbound/cards")} className="text-accent hover:underline">
            full card catalog
          </Link>{" "}
          or jump into a{" "}
          <Link to={lp("/riftbound/sets")} className="text-accent hover:underline">
            specific set
          </Link>{" "}
          to check current market prices.
        </p>
      </section>
    </div>
  );
}
