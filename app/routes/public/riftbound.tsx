import { Link } from "react-router";

import type { Route } from "./+types/riftbound";
import { CardImage } from "~/components/card-image";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { formatMinor } from "~/lib/money/decimal";
import { RIFTBOUND_CHAMPIONS } from "~/lib/riftbound/champions";
import {
  listRiftboundCards,
  listRiftboundSets,
  listRiftboundTopValueCards,
} from "~/lib/riftbound/queries.server";
import { canonicalUrl, collectionPageJsonLd, faqPageJsonLd, JsonLd, pageMeta } from "~/lib/seo/meta";

/** Riftbound landing — a real, indexable hub targeting the head terms
 * "riftbound tcg" / "riftbound cards" / "riftbound card list" (all near-zero
 * difficulty). English copy, like the rest of the Riftbound UI (localization
 * deferred). */
export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "Riftbound TCG Card List & Prices — All Sets | Pokector",
    description:
      "Riftbound (League of Legends TCG) card list with live TCGplayer prices. Browse every set — Origins, Spiritforged, Unleashed and Proving Grounds — with card values updated daily.",
    canonical: data?.canonical,
    // EN-only page — no hreflang (content isn't translated).
  });
}

/** On-page Q&A — captures "what is riftbound tcg", "riftbound release date"
 * (1.7k/mo) and "riftbound sets", and earns an FAQ rich result. */
const RIFTBOUND_FAQ = [
  {
    question: "What is Riftbound?",
    answer:
      "Riftbound is the League of Legends Trading Card Game from Riot Games, released on 31 October 2025. It launched with the Origins set, followed by Spiritforged, Unleashed and the Proving Grounds and Vendetta expansions.",
  },
  {
    question: "How many Riftbound cards and sets are there?",
    answer:
      "Riftbound spans multiple sets — Origins, Spiritforged, Unleashed, Origins: Proving Grounds and Vendetta — plus promotional and organized-play cards. Pokector tracks the full card list with a live market price on every card.",
  },
  {
    question: "Where can I check Riftbound card prices?",
    answer:
      "Pokector pulls Riftbound single-card prices from the TCGplayer marketplace aggregate and refreshes them daily. Each card page shows the current market estimate, low/mid/high figures and a price-history chart.",
  },
  {
    question: "How do Riftbound rarities work?",
    answer:
      "Riftbound cards come in several rarities, and higher-rarity or foil printings usually carry the highest secondary-market values. You can sort any Riftbound set by rarity and price on Pokector to find the chase cards.",
  },
];

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" };
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(undefined); // EN-only route (no :locale param)
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
        data={[
          collectionPageJsonLd(appUrl, {
            name: "Riftbound TCG Card List & Prices",
            description:
              "Riftbound (League of Legends TCG) sets and cards with live market prices.",
            path: "/riftbound",
            items: sets.map((s) => ({ name: s.name, path: `/riftbound/sets/${s.slug}` })),
          }),
          faqPageJsonLd(RIFTBOUND_FAQ),
        ]}
      />

      {/* Hero */}
      <section className="flex flex-col items-center gap-5 pt-6 text-center">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-fg sm:text-5xl">
          Riftbound TCG <span className="text-accent">Card List & Prices</span>
        </h1>
        <p className="max-w-2xl text-lg text-fg-muted">
          The complete Riftbound: League of Legends Trading Card Game card list.
          Track {totalCards.toLocaleString("en-US")} cards across {sets.length} sets —
          live market prices from TCGplayer, updated daily.
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

      {/* Champions */}
      <section aria-label="Riftbound champions" className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold text-fg">Browse by champion</h2>
        <ul className="flex flex-wrap gap-2 text-sm">
          {Object.entries(RIFTBOUND_CHAMPIONS).map(([slug, c]) => (
            <li key={slug}>
              <Link
                to={lp(`/riftbound/champions/${slug}`)}
                className="rounded-full border border-edge px-3 py-1.5 text-fg-muted hover:border-accent hover:text-fg"
              >
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* FAQ */}
      <section aria-labelledby="faq-heading" className="flex flex-col gap-4">
        <h2 id="faq-heading" className="text-xl font-semibold text-fg">
          Riftbound TCG — frequently asked questions
        </h2>
        <dl className="flex max-w-3xl flex-col gap-4">
          {RIFTBOUND_FAQ.map((item) => (
            <div key={item.question}>
              <dt className="font-medium text-fg">{item.question}</dt>
              <dd className="mt-1 text-sm text-fg-muted">{item.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* SEO copy */}
      <section className="flex flex-col gap-3 border-t border-edge pt-8 text-sm text-fg-muted">
        <h2 className="text-lg font-semibold text-fg">
          The complete Riftbound card list &amp; price guide
        </h2>
        <p className="max-w-3xl">
          Pokector tracks the live secondary-market value of every card in Riot Games'
          Riftbound: League of Legends Trading Card Game. Prices come from the TCGplayer
          marketplace aggregate and are refreshed daily, with a price-history chart on each
          card so you can see how values move over time. Riftbound is sold in booster boxes
          and starter decks — Pokector follows single-card prices for every card you can
          pull from them.
        </p>
        <p className="max-w-3xl">
          Jump straight into a set:{" "}
          {sets
            .filter((s) => !/promotional|judge|organized play/i.test(s.name))
            .slice(0, 6)
            .map((s, i, arr) => (
              <span key={s.id}>
                <Link
                  to={lp(`/riftbound/sets/${s.slug}`)}
                  className="text-accent hover:underline"
                >
                  Riftbound {s.name}
                </Link>
                {i < arr.length - 1 ? ", " : "."}
              </span>
            ))}{" "}
          Or browse the{" "}
          <Link to={lp("/riftbound/cards")} className="text-accent hover:underline">
            full Riftbound card list
          </Link>{" "}
          across all sets.
        </p>
      </section>
    </div>
  );
}
