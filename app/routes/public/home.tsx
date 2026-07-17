import { Form, Link } from "react-router";

import type { Route } from "./+types/home";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { getHomepageData } from "~/lib/catalog/queries.server";
import { canonicalUrl, JsonLd, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "Pokector — Pokémon TCG Collection Tracker & Card Price Portfolio",
    description:
      "Track your Pokémon TCG collection, monitor estimated market value with TCGplayer prices, complete set checklists, organize binders, and watch your portfolio over time. Free and independent.",
    canonical: data?.canonical,
    image: "/brand/pokector-icon-512.png",
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" };
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const { popularSets, recentCards } = await getHomepageData(db);
  return {
    canonical: canonicalUrl(env.APP_URL, "/"),
    appUrl: env.APP_URL,
    popularSets,
    recentCards,
  };
}

const FEATURES = [
  {
    title: "Know what your collection is worth",
    body: "Every card you track is valued with current TCGplayer market estimates in USD (Cardmarket EUR shown alongside where available). Coverage is always transparent — unpriced cards are labeled, never counted as zero.",
  },
  {
    title: "Watch value over time",
    body: "Pokector records real price observations from the day you start tracking and builds your portfolio history from them. No backfilled or invented data — your chart starts when you do.",
  },
  {
    title: "Complete your sets",
    body: "Automatic checklists show what you own, what's missing, and roughly what the missing cards would cost — for every set in the catalog.",
  },
  {
    title: "Organize like a binder",
    body: "Arrange your cards into visual 9-pocket binder pages, keep binders private, or share them with a link.",
  },
];

export default function Home({ loaderData }: Route.ComponentProps) {
  const { popularSets, recentCards, appUrl } = loaderData;

  return (
    <div className="flex flex-col gap-16">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Pokector",
          url: appUrl,
          potentialAction: {
            "@type": "SearchAction",
            target: `${appUrl}/cards?q={search_term_string}`,
            "query-input": "required name=search_term_string",
          },
        }}
      />

      {/* Hero */}
      <section className="flex flex-col items-center gap-6 pt-8 text-center">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-fg sm:text-5xl">
          Your Pokémon TCG collection, <span className="text-accent">tracked and valued</span>.
        </h1>
        <p className="max-w-2xl text-lg text-fg-muted">
          Browse the full card catalog, record what you own, and watch your collection's estimated
          market value — with honest prices, honest history, and no hype.
        </p>
        <Form method="get" action="/cards" role="search" className="flex w-full max-w-xl gap-2">
          <label htmlFor="hero-search" className="sr-only">
            Search the card catalog
          </label>
          <input
            id="hero-search"
            type="search"
            name="q"
            placeholder="Search for a card, e.g. Charizard…"
            className="min-h-12 flex-1 rounded-xl border border-edge bg-surface px-4 text-fg placeholder:text-fg-faint"
          />
          <button
            type="submit"
            className="min-h-12 rounded-xl bg-accent px-6 font-medium text-white hover:bg-accent-strong"
          >
            Search
          </button>
        </Form>
        <div className="flex gap-3">
          <Link
            to="/register"
            className="rounded-xl bg-secondary px-6 py-3 font-medium text-white hover:opacity-90"
          >
            Start tracking free
          </Link>
          <Link
            to="/cards"
            className="rounded-xl border border-edge bg-surface px-6 py-3 font-medium text-fg hover:bg-surface-raised"
          >
            Browse cards
          </Link>
        </div>
      </section>

      {/* Features */}
      <section aria-labelledby="features-heading">
        <h2 id="features-heading" className="mb-6 text-2xl font-bold text-fg">
          Built for collectors, not speculators
        </h2>
        <div className="grid gap-6 sm:grid-cols-2">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-(--radius-card) border border-edge bg-surface p-6"
            >
              <h3 className="mb-2 font-semibold text-fg">{feature.title}</h3>
              <p className="text-sm text-fg-muted">{feature.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Popular sets */}
      <section aria-labelledby="sets-heading">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 id="sets-heading" className="text-2xl font-bold text-fg">
            Latest sets
          </h2>
          <Link to="/sets" className="text-sm font-medium text-accent hover:underline">
            All sets →
          </Link>
        </div>
        {popularSets.length === 0 ? (
          <p className="rounded-lg border border-edge bg-surface p-6 text-fg-muted">
            The catalog is being synchronized. Check back shortly.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {popularSets.map((set) => (
              <li key={set.id}>
                <Link
                  to={`/sets/${set.slug}`}
                  className="flex h-full flex-col items-center gap-3 rounded-(--radius-card) border border-edge bg-surface p-4 text-center hover:border-accent"
                >
                  {set.logoUrl ? (
                    <img
                      src={set.logoUrl}
                      alt=""
                      loading="lazy"
                      className="h-12 w-auto max-w-full object-contain"
                    />
                  ) : (
                    <span aria-hidden="true" className="flex h-12 items-center text-2xl">
                      🃏
                    </span>
                  )}
                  <span className="text-sm font-medium text-fg">{set.name}</span>
                  <span className="text-xs text-fg-faint">{set.total ?? "?"} cards</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recently updated cards */}
      <section aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-6 text-2xl font-bold text-fg">
          Recently updated cards
        </h2>
        {recentCards.length === 0 ? (
          <p className="rounded-lg border border-edge bg-surface p-6 text-fg-muted">
            Card data will appear here after the first catalog synchronization.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {recentCards.map((card) => (
              <li key={card.id}>
                <Link to={`/cards/${card.slug}`} className="group flex flex-col gap-2">
                  {card.imageSmallUrl ? (
                    <img
                      src={card.imageSmallUrl}
                      alt={`${card.name} card`}
                      loading="lazy"
                      className="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
                    />
                  ) : (
                    <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-fg-faint">
                      No image
                    </span>
                  )}
                  <span className="truncate text-xs font-medium text-fg">{card.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* How valuation works */}
      <section
        aria-labelledby="valuation-heading"
        className="rounded-(--radius-card) border border-edge bg-surface p-8"
      >
        <h2 id="valuation-heading" className="mb-4 text-2xl font-bold text-fg">
          How valuation works
        </h2>
        <div className="grid gap-6 text-sm text-fg-muted md:grid-cols-3">
          <p>
            <strong className="text-fg">Market-based estimates.</strong> Card values use current
            TCGplayer prices (market price where available, otherwise mid or low) per printing
            variant — normal, holofoil, reverse holofoil, and first edition.
          </p>
          <p>
            <strong className="text-fg">Raw cards only.</strong> Estimates describe ungraded,
            near-mint-market pricing. Your card's actual condition may change what it would really
            sell for — condition is tracked, but never silently changes the estimate.
          </p>
          <p>
            <strong className="text-fg">Honest history.</strong> Price history starts when Pokector
            first observes a card, and portfolio history starts when you do. Missing prices are
            shown as missing — never as zero.{" "}
            <Link to="/methodology" className="text-accent hover:underline">
              Read the full methodology
            </Link>
            .
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="flex flex-col items-center gap-4 rounded-(--radius-card) bg-accent-soft p-10 text-center">
        <h2 className="text-2xl font-bold text-fg">Ready to see what your binder is worth?</h2>
        <p className="max-w-xl text-fg-muted">
          Create a free account, add your first cards in minutes, and let Pokector keep score from
          here on.
        </p>
        <Link
          to="/register"
          className="rounded-xl bg-accent px-8 py-3 font-medium text-white hover:bg-accent-strong"
        >
          Create free account
        </Link>
      </section>
    </div>
  );
}
