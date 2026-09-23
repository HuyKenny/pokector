import { Link } from "react-router";

import type { Route } from "./+types/pokemon.$name";
import { CardImage } from "~/components/card-image";
import { listCardsByPokedex } from "~/lib/catalog/queries.server";
import { getCloudflare, getMarket } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { type Currency, MARKET_CURRENCY } from "~/lib/market/market";
import { formatMinor } from "~/lib/money/decimal";
import { speciesBySlug, speciesSlug } from "~/lib/pokedex/species-slug";
import {
  breadcrumbJsonLd,
  canonicalUrl,
  collectionPageJsonLd,
  faqPageJsonLd,
  JsonLd,
  pageMeta,
} from "~/lib/seo/meta";

/** Per-Pokémon hub — every card of one Pokémon across all sets, ranked by current
 * market value. Targets "{pokemon} cards" / "{pokemon} card value" (KD 0–1, high
 * volume for iconic Pokémon). Inline EN copy, EN-only routing (no hreflang). */
export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data) return pageMeta({ title: "Pokémon cards | Pokector", description: "", noindex: true });
  return pageMeta({
    title: `${data.name} Cards — Value & Price Guide | Pokector`,
    description: `Every ${data.name} Pokémon card ranked by value, with live market prices. See the most valuable ${data.name} cards, the full checklist across sets, and what they're worth today.`,
    canonical: data.canonical,
    // Thin hubs (no cards indexed yet) shouldn't be indexed.
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
  const species = speciesBySlug(params.name);
  if (!species) throw new Response("Pokémon not found", { status: 404 });
  const market = getMarket(context);
  const cards = await listCardsByPokedex(db, species.dex, market);
  return {
    name: species.name,
    dex: species.dex,
    cards,
    currency: MARKET_CURRENCY[market],
    canonical: canonicalUrl(env.APP_URL, localePath(locale, `/pokemon/${speciesSlug(species.name)}`)),
    appUrl: env.APP_URL,
  };
}

function money(minor: number | null | undefined, currency: Currency): string {
  return minor == null ? "—" : formatMinor(minor, currency);
}

export default function PokemonHub({ loaderData }: Route.ComponentProps) {
  const { name, dex, cards, currency, appUrl } = loaderData;
  const lp = useLocalePath();
  const priced = cards.filter((c) => c.priceMinor != null);
  const mostValuable = priced[0];
  const cheapest = priced[priced.length - 1];
  const top = cards.slice(0, 12);

  const faq = [
    {
      question: `What is the most valuable ${name} card?`,
      answer: mostValuable
        ? `By current market value the most valuable ${name} card here is ${mostValuable.name} from ${mostValuable.setName}, around ${money(mostValuable.priceMinor, currency)} raw. High grades (PSA 10) sell for more.`
        : `We track ${name} cards but none are priced yet — check back as the market updates.`,
    },
    {
      question: `How many ${name} cards are there?`,
      answer: `Pokector lists ${cards.length} ${name} card${cards.length === 1 ? "" : "s"} across all Pokémon TCG sets, with a live market price on each.`,
    },
    {
      question: `How much are ${name} cards worth?`,
      answer:
        priced.length > 0
          ? `Priced ${name} cards range from about ${money(cheapest.priceMinor, currency)} to ${money(mostValuable.priceMinor, currency)} for raw copies, depending on the set, rarity and condition. Graded copies sell higher.`
          : `Most ${name} cards are affordable commons and uncommons; the chase cards are the holos and special rares.`,
    },
  ];

  return (
    <div className="flex flex-col gap-12">
      <JsonLd
        data={[
          breadcrumbJsonLd(appUrl, [
            { name: "Home", path: "/" },
            { name: "Pokédex", path: "/pokedex" },
            { name: `${name} cards`, path: `/pokemon/${speciesSlug(name)}` },
          ]),
          collectionPageJsonLd(appUrl, {
            name: `${name} Cards`,
            description: `Every ${name} Pokémon card with live market prices.`,
            path: `/pokemon/${speciesSlug(name)}`,
            items: cards.slice(0, 25).map((c) => ({ name: c.name, path: `/cards/${c.slug}` })),
          }),
          faqPageJsonLd(faq),
        ]}
      />

      {/* Hero */}
      <section className="flex flex-col gap-4 pt-4">
        <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
          <Link to={lp("/")} className="hover:text-fg">
            Home
          </Link>{" "}
          /{" "}
          <Link to={lp("/pokedex")} className="hover:text-fg">
            Pokédex
          </Link>{" "}
          / <span className="text-fg">{name} cards</span>
        </nav>
        <div className="flex items-center gap-4">
          <img
            src={`/sprites/${dex}.png`}
            alt={name}
            width={96}
            height={96}
            className="h-20 w-20 shrink-0 object-contain"
          />
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-fg sm:text-5xl">
              {name} <span className="text-accent">Cards</span>
            </h1>
            <p className="text-sm text-fg-muted">National Pokédex #{String(dex).padStart(4, "0")}</p>
          </div>
        </div>
        <p className="max-w-3xl text-lg text-fg-muted">
          Every {name} Pokémon card, ranked by current market value. Prices are from the
          TCGplayer and Cardmarket aggregates, updated daily — so you always see what {name}{" "}
          cards are worth today. Values are for raw (ungraded) singles.
        </p>
      </section>

      {cards.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface p-6 text-sm text-fg-muted">
          No {name} cards are indexed yet — check back soon.
        </p>
      ) : (
        <>
          {/* Stats */}
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Cards tracked" value={String(cards.length)} />
            <Stat
              label="Most valuable"
              value={mostValuable ? money(mostValuable.priceMinor, currency) : "—"}
            />
            <Stat label="Cheapest priced" value={cheapest ? money(cheapest.priceMinor, currency) : "—"} />
            <Stat label="Priced cards" value={String(priced.length)} />
          </dl>

          {/* Top showcase */}
          <section aria-label={`Top ${name} cards`} className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold text-fg">Most valuable {name} cards</h2>
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

          {/* Full checklist table */}
          <section aria-label={`All ${name} cards`} className="flex flex-col gap-4">
            <h2 className="text-xl font-semibold text-fg">
              All {name} cards ({cards.length})
            </h2>
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
              Prices in {currency}, raw (ungraded) singles, updated daily.
            </p>
          </section>
        </>
      )}

      {/* FAQ */}
      <section aria-labelledby="faq-heading" className="flex flex-col gap-4">
        <h2 id="faq-heading" className="text-xl font-semibold text-fg">
          {name} cards — FAQ
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

      {/* CTA */}
      <section className="flex flex-col items-start gap-3 border-t border-edge pt-8">
        <p className="max-w-3xl text-sm text-fg-muted">
          Browse the{" "}
          <Link to={lp("/most-valuable-pokemon-cards")} className="text-accent hover:underline">
            most valuable Pokémon cards
          </Link>
          , explore the{" "}
          <Link to={lp("/pokedex")} className="text-accent hover:underline">
            full Pokédex
          </Link>
          , or track your own {name} cards in a free collection.
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-(--radius-card) border border-edge bg-surface p-4">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">{value}</dd>
    </div>
  );
}
