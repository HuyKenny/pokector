import { Link } from "react-router";

import type { Route } from "./+types/pokemon-sets";
import { listAllSets, type SetIndexItem } from "~/lib/catalog/queries.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import {
  breadcrumbJsonLd,
  canonicalUrl,
  collectionPageJsonLd,
  faqPageJsonLd,
  JsonLd,
  pageMeta,
} from "~/lib/seo/meta";

/** "All Pokémon TCG Sets in Order" — complete, era-grouped set index. Targets
 * "all pokemon sets in order" (TP 38k) + "[era] sets". Inline EN, EN-only. */
export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "All Pokémon TCG Sets in Order — Complete List | Pokector",
    description:
      "Every Pokémon TCG set in release order, grouped by era — from Base Set to the latest Scarlet & Violet expansions. Release dates, set sizes and live card prices for each set.",
    canonical: data?.canonical,
    // EN-only page — no hreflang (content isn't translated).
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(undefined); // EN-only route
  const sets = await listAllSets(db);
  // Group by era (series), preserving newest-first order from the query.
  const eras: { series: string; sets: SetIndexItem[] }[] = [];
  const byName = new Map<string, SetIndexItem[]>();
  for (const s of sets) {
    const key = s.series || "Other";
    let bucket = byName.get(key);
    if (!bucket) {
      bucket = [];
      byName.set(key, bucket);
      eras.push({ series: key, sets: bucket });
    }
    bucket.push(s);
  }
  return {
    eras,
    totalSets: sets.length,
    newestSet: sets[0] ?? null,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, "/pokemon-sets")),
    appUrl: env.APP_URL,
  };
}

export default function PokemonSetsIndex({ loaderData }: Route.ComponentProps) {
  const { eras, totalSets, newestSet, appUrl } = loaderData;
  const lp = useLocalePath();

  const faq = [
    {
      question: "How many Pokémon TCG sets are there?",
      answer: `Pokector tracks ${totalSets} Pokémon Trading Card Game sets across every era, from the 1999 Base Set to the newest expansions.`,
    },
    {
      question: "What is the newest Pokémon TCG set?",
      answer: newestSet
        ? `The newest set here is ${newestSet.name}${newestSet.releaseDate ? `, released ${newestSet.releaseDate}` : ""}.`
        : "New sets are added as they release.",
    },
    {
      question: "What order are Pokémon TCG sets released in?",
      answer:
        "Sets release in named eras (Base/WOTC, EX, Diamond & Pearl, Black & White, XY, Sun & Moon, Sword & Shield, Scarlet & Violet). This list is grouped by era and ordered newest-first, with each set's release date.",
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <JsonLd
        data={[
          breadcrumbJsonLd(appUrl, [
            { name: "Home", path: "/" },
            { name: "All Pokémon sets in order", path: "/pokemon-sets" },
          ]),
          collectionPageJsonLd(appUrl, {
            name: "All Pokémon TCG Sets in Order",
            description: "Every Pokémon TCG set in release order, grouped by era.",
            path: "/pokemon-sets",
            items: eras
              .flatMap((e) => e.sets)
              .slice(0, 50)
              .map((s) => ({ name: s.name, path: `/sets/${s.slug}` })),
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
          / <span className="text-fg">All sets in order</span>
        </nav>
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-fg sm:text-5xl">
          All Pokémon TCG Sets <span className="text-accent">in Order</span>
        </h1>
        <p className="max-w-3xl text-lg text-fg-muted">
          Every Pokémon Trading Card Game set in release order, grouped by era — {totalSets} sets
          from the 1999 Base Set to the latest expansions. Open any set for its full card list,
          release date and live market prices.
        </p>
      </section>

      {/* Era sections */}
      {eras.map((era) => (
        <section key={era.series} aria-label={era.series} className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold text-fg">
            {era.series}{" "}
            <span className="text-sm font-normal text-fg-faint">({era.sets.length})</span>
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {era.sets.map((s) => (
              <li key={s.slug}>
                <Link
                  to={lp(`/sets/${s.slug}`)}
                  className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface px-4 py-3 hover:border-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-fg">{s.name}</span>
                    <span className="block text-xs text-fg-faint">
                      {s.releaseDate ?? "—"}
                      {s.total ? ` · ${s.total} cards` : ""}
                    </span>
                  </span>
                  {s.symbolUrl ? (
                    <img src={s.symbolUrl} alt="" className="h-6 w-6 shrink-0 object-contain" />
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* FAQ */}
      <section
        aria-labelledby="faq-heading"
        className="flex flex-col gap-4 border-t border-edge pt-8"
      >
        <h2 id="faq-heading" className="text-xl font-semibold text-fg">
          Pokémon TCG sets — FAQ
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
    </div>
  );
}
