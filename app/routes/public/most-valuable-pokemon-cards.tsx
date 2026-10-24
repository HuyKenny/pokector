import { Link } from "react-router";

import type { Route } from "./+types/most-valuable-pokemon-cards";
import { CardImage } from "~/components/card-image";
import { listTopValueCards } from "~/lib/catalog/queries.server";
import { getCloudflare, getMarket } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { type Currency, MARKET_CURRENCY } from "~/lib/market/market";
import { formatMinor } from "~/lib/money/decimal";
import {
  breadcrumbJsonLd,
  canonicalUrl,
  collectionPageJsonLd,
  faqPageJsonLd,
  JsonLd,
  pageMeta,
} from "~/lib/seo/meta";

/** Value pillar — the live, data-driven "most valuable Pokémon cards" ranking.
 * Targets the high-volume "most valuable / most expensive / worth money" cluster
 * (KD single-digit). Inline EN copy (like the Riftbound pages); localization
 * deferred. The ranking is by CURRENT market value, so it stays honest and fresh
 * rather than being a static listicle. */
export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "Most Valuable Pokémon Cards — Live Market Values | Pokector",
    description:
      "The most valuable Pokémon cards right now, ranked by live market value. See which Pokémon cards are worth the most money, with prices from TCGplayer & Cardmarket updated daily.",
    canonical: data?.canonical,
    // EN-only page — no hreflang (content isn't translated).
  });
}

export function headers(_args: Route.HeadersArgs) {
  // Shareable since 2026-09-23: cookie-less visitors always get DEFAULT_MARKET
  // (the geolocation default was removed in workers/app.ts) and the edge cache
  // in workers/html-cache.ts skips any request carrying pk_market, pk_game or a
  // session cookie — so a shared entry only ever holds the anonymous render.
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" };
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(undefined); // EN-only route (no :locale param)
  const market = getMarket(context);
  const cards = await listTopValueCards(db, { market, limit: 100 });
  return {
    locale,
    currency: MARKET_CURRENCY[market],
    cards,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, "/most-valuable-pokemon-cards")),
    appUrl: env.APP_URL,
  };
}

const FAQ = [
  {
    question: "What is the most valuable Pokémon card?",
    answer:
      "By live secondary-market value, the ranking above is topped by the current highest-priced card in our database. All-time auction records are higher — a PSA 10 Pikachu Illustrator reportedly sold for around $5.3 million in 2022 — but those are one-off sales, not the everyday market prices shown here.",
  },
  {
    question: "How are these card values calculated?",
    answer:
      "Each card's value is its current market price — the TCGplayer market estimate (US) or Cardmarket trend price (EU) for its most valuable printing. We rank raw (ungraded) single cards; graded copies (PSA/CGC) typically sell for more.",
  },
  {
    question: "How often are the prices updated?",
    answer:
      "Prices are refreshed daily from the marketplace aggregates, so this list reflects the current market rather than a fixed snapshot. Open any card to see its full price history.",
  },
  {
    question: "Which Pokémon cards are worth money?",
    answer:
      "The biggest values sit with early-era holos (Base Set Charizard), low-population graded cards, first-edition and shadowless prints, secret rares, and modern chase cards like special-illustration and gold rares. Use the ranking above and each set page to spot the chase cards.",
  },
];

function money(minor: number | null | undefined, currency: Currency): string {
  return minor == null ? "—" : formatMinor(minor, currency);
}

export default function MostValuablePokemonCards({ loaderData }: Route.ComponentProps) {
  const { cards, currency, appUrl } = loaderData;
  const lp = useLocalePath();
  const top = cards.slice(0, 12);

  return (
    <div className="flex flex-col gap-12">
      <JsonLd
        data={[
          breadcrumbJsonLd(appUrl, [
            { name: "Home", path: "/" },
            { name: "Most Valuable Pokémon Cards", path: "/most-valuable-pokemon-cards" },
          ]),
          collectionPageJsonLd(appUrl, {
            name: "Most Valuable Pokémon Cards",
            description: "Pokémon cards ranked by current market value.",
            path: "/most-valuable-pokemon-cards",
            items: cards.slice(0, 25).map((c) => ({
              name: c.name,
              path: `/cards/${c.slug}`,
            })),
          }),
          faqPageJsonLd(FAQ),
        ]}
      />

      {/* Hero */}
      <section className="flex flex-col gap-4 pt-4">
        <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
          <Link to={lp("/")} className="hover:text-fg">
            Home
          </Link>{" "}
          / <span className="text-fg">Most Valuable Pokémon Cards</span>
        </nav>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-fg sm:text-5xl">
          Most Valuable <span className="text-accent">Pokémon Cards</span>
        </h1>
        <p className="max-w-3xl text-lg text-fg-muted">
          The Pokémon cards worth the most money right now, ranked by live market value. Prices come
          from the TCGplayer and Cardmarket aggregates and are updated daily — so this is the
          current market, not a stale list. Values are for raw (ungraded) single cards.
        </p>
      </section>

      {/* Top 12 showcase */}
      {top.length > 0 ? (
        <section aria-label="Top valued cards" className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-fg">Top 12 by market value</h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {top.map((c, i) => (
              <li key={c.id}>
                <Link to={lp(`/cards/${c.slug}`)} className="group flex h-full flex-col gap-2">
                  <div className="relative">
                    <span className="absolute left-1 top-1 z-10 rounded bg-fg/80 px-1.5 py-0.5 text-xs font-bold text-canvas">
                      #{i + 1}
                    </span>
                    <CardImage
                      src={c.imageSmallUrl}
                      alt={`${c.name} — ${c.setName} #${c.number}`}
                      imgClassName="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
                      fallbackClassName="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-xs text-fg-faint"
                    />
                  </div>
                  <div>
                    <p className="truncate text-sm font-medium text-fg group-hover:text-accent">
                      {c.name}
                    </p>
                    <p className="truncate text-xs text-fg-faint">
                      {c.setName}
                      {c.priceMinor != null ? ` · ${money(c.priceMinor, currency)}` : ""}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-lg border border-edge bg-surface p-6 text-sm text-fg-muted">
          The value ranking is being calculated — check back shortly.
        </p>
      )}

      {/* Full ranking table */}
      {cards.length > 0 ? (
        <section aria-label="Full ranking" className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-fg">
            The {cards.length} most valuable Pokémon cards
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-fg-muted">
                  <th scope="col" className="py-2 pe-3 text-end font-medium">
                    #
                  </th>
                  <th scope="col" className="py-2 pe-4 text-start font-medium">
                    Card
                  </th>
                  <th scope="col" className="py-2 pe-4 text-start font-medium">
                    Set
                  </th>
                  <th scope="col" className="py-2 pe-4 text-start font-medium">
                    Rarity
                  </th>
                  <th scope="col" className="py-2 text-end font-medium">
                    Market value
                  </th>
                </tr>
              </thead>
              <tbody>
                {cards.map((c, i) => (
                  <tr key={c.id} className="border-b border-edge/50">
                    <td className="py-2 pe-3 text-end tabular-nums text-fg-faint">{i + 1}</td>
                    <th scope="row" className="py-2 pe-4 text-start font-medium">
                      <Link to={lp(`/cards/${c.slug}`)} className="text-fg hover:text-accent">
                        {c.name} <span className="font-normal text-fg-faint">#{c.number}</span>
                      </Link>
                    </th>
                    <td className="py-2 pe-4 text-start text-fg-muted">{c.setName}</td>
                    <td className="py-2 pe-4 text-start text-fg-muted">{c.rarity ?? "—"}</td>
                    <td className="py-2 text-end font-semibold tabular-nums text-fg">
                      {money(c.priceMinor, currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-fg-faint">
            Prices in {currency}, raw (ungraded) singles, updated daily. Source: TCGplayer (US) /
            Cardmarket (EU) aggregates.
          </p>
        </section>
      ) : null}

      {/* FAQ */}
      <section aria-labelledby="faq-heading" className="flex flex-col gap-4">
        <h2 id="faq-heading" className="text-xl font-semibold text-fg">
          Most valuable Pokémon cards — FAQ
        </h2>
        <dl className="flex max-w-3xl flex-col gap-4">
          {FAQ.map((item) => (
            <div key={item.question}>
              <dt className="font-medium text-fg">{item.question}</dt>
              <dd className="mt-1 text-sm text-fg-muted">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* CTA */}
      <section className="flex flex-col items-start gap-3 border-t border-edge pt-8">
        <h2 className="text-lg font-semibold text-fg">Track your own cards' value</h2>
        <p className="max-w-3xl text-sm text-fg-muted">
          Add your cards to a free Pokector collection to see the live market value of what you own,
          spot the{" "}
          <Link to={lp("/price-movers")} className="text-accent hover:underline">
            biggest price movers
          </Link>
          , and browse every{" "}
          <Link to={lp("/sets")} className="text-accent hover:underline">
            Pokémon set
          </Link>{" "}
          with prices.
        </p>
        <Link
          to={lp("/register")}
          className="rounded-xl bg-accent px-6 py-3 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
        >
          Start tracking — free
        </Link>
      </section>
    </div>
  );
}
