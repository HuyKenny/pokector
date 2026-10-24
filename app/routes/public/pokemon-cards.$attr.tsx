import { Link } from "react-router";

import type { Route } from "./+types/pokemon-cards.$attr";
import { CardImage } from "~/components/card-image";
import { listAttributeCards } from "~/lib/catalog/queries.server";
import { RARITY_HUBS } from "~/lib/catalog/rarity-hubs";
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

/** Rarity / attribute hub — cards filtered by rarity or era, ranked by value.
 * Targets "gold star / promo / secret rare / vintage pokemon cards" (KD 0).
 * Inline EN, EN-only routing. Config in ~/lib/catalog/rarity-hubs. */
export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data) return pageMeta({ title: "Pokémon cards | Pokector", description: "", noindex: true });
  return pageMeta({
    title: data.hub.title,
    description: data.hub.description,
    canonical: data.canonical,
    noindex: data.cards.length === 0,
    // EN-only page — no hreflang (content isn't translated).
  });
}

export function headers(_args: Route.HeadersArgs) {
  // Shareable since 2026-09-23: cookie-less visitors always get DEFAULT_MARKET
  // (the geolocation default was removed in workers/app.ts) and the edge cache
  // in workers/html-cache.ts skips any request carrying pk_market, pk_game or a
  // session cookie — so a shared entry only ever holds the anonymous render.
  return { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(undefined); // EN-only route
  const hub = RARITY_HUBS[params.attr];
  if (!hub) throw new Response("Not found", { status: 404 });
  const market = getMarket(context);
  const cards = await listAttributeCards(db, {
    key: params.attr,
    rarities: hub.rarities,
    releaseBefore: hub.releaseBefore,
    market,
  });
  return {
    attr: params.attr,
    hub,
    cards,
    currency: MARKET_CURRENCY[market],
    canonical: canonicalUrl(env.APP_URL, localePath(locale, `/pokemon-cards/${params.attr}`)),
    appUrl: env.APP_URL,
  };
}

function money(minor: number | null | undefined, currency: Currency): string {
  return minor == null ? "—" : formatMinor(minor, currency);
}

export default function RarityHub({ loaderData }: Route.ComponentProps) {
  const { attr, hub, cards, currency, appUrl } = loaderData;
  const lp = useLocalePath();
  const priced = cards.filter((c) => c.priceMinor != null);
  const top = cards.slice(0, 12);
  const siblings = Object.entries(RARITY_HUBS).filter(([slug]) => slug !== attr);

  const faq = [
    {
      question: `What are ${hub.h1.replace(/ Pokémon Cards$/i, "")} Pokémon cards?`,
      answer: hub.blurb,
    },
    {
      question: `How much are ${hub.h1.replace(/ Pokémon Cards$/i, "").toLowerCase()} cards worth?`,
      answer:
        priced.length > 0
          ? `Prices range widely by card, set and condition. The most valuable in this list is around ${money(top[0]?.priceMinor, currency)} raw; graded copies sell higher. See the full ranking above.`
          : "Values depend on the specific card, set and condition — browse the ranking above for live prices.",
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <JsonLd
        data={[
          breadcrumbJsonLd(appUrl, [
            { name: "Home", path: "/" },
            { name: hub.h1, path: `/pokemon-cards/${attr}` },
          ]),
          collectionPageJsonLd(appUrl, {
            name: hub.h1,
            description: hub.description,
            path: `/pokemon-cards/${attr}`,
            items: cards.slice(0, 25).map((c) => ({ name: c.name, path: `/cards/${c.slug}` })),
          }),
          faqPageJsonLd(faq),
        ]}
      />

      {/* Hero */}
      <section className="flex flex-col gap-3 pt-4">
        <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
          <Link to={lp("/")} className="hover:text-fg">
            Home
          </Link>{" "}
          / <span className="text-fg">{hub.h1}</span>
        </nav>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-fg sm:text-5xl">
          {hub.h1}
        </h1>
        <p className="max-w-3xl text-lg text-fg-muted">{hub.blurb}</p>
      </section>

      {cards.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface p-6 text-sm text-fg-muted">
          No cards found for this category yet — check back soon.
        </p>
      ) : (
        <>
          {/* Showcase */}
          <section aria-label="Top cards" className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold text-fg">
              Most valuable {hub.label.toLowerCase()} cards
            </h2>
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

          {/* Table */}
          <section aria-label="Full list" className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold text-fg">{hub.h1} by value</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-edge text-fg-muted">
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
                  {cards.map((c) => (
                    <tr key={c.id} className="border-b border-edge/50">
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
              Prices in {currency}, raw singles, updated daily.
            </p>
          </section>
        </>
      )}

      {/* FAQ */}
      <section aria-labelledby="faq-heading" className="flex flex-col gap-4">
        <h2 id="faq-heading" className="text-xl font-semibold text-fg">
          FAQ
        </h2>
        <dl className="flex max-w-3xl flex-col gap-4">
          {faq.map((item) => (
            <div key={item.question}>
              <dt className="font-medium text-fg">{item.question}</dt>
              <dd className="mt-1 text-sm text-fg-muted">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Sibling hubs — interlinking */}
      <section
        aria-label="Browse by card type"
        className="flex flex-col gap-3 border-t border-edge pt-8"
      >
        <h2 className="text-lg font-semibold text-fg">Browse by card type</h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {siblings.map(([slug, s]) => (
            <li key={slug}>
              <Link
                to={lp(`/pokemon-cards/${slug}`)}
                className="rounded-full border border-edge px-3 py-1.5 text-fg-muted hover:border-accent hover:text-fg"
              >
                {s.label}
              </Link>
            </li>
          ))}
          <li>
            <Link
              to={lp("/most-valuable-pokemon-cards")}
              className="rounded-full border border-edge px-3 py-1.5 text-fg-muted hover:border-accent hover:text-fg"
            >
              Most valuable
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
