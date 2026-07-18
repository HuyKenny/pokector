import { Link } from "react-router";

import type { Route } from "./+types/pokedex";
import { listPokedexAggregates } from "~/lib/catalog/queries.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { LANG_TAGS, localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { interpolate } from "~/lib/i18n/t";
import { formatMinor } from "~/lib/money/decimal";
import { generationOf, GENERATION_MAX, SPECIES } from "~/lib/pokedex/species";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: data?.t.metaTitle ?? "Pokédex | Pokector",
    description: data?.t.metaDescription ?? "",
    canonical: data?.canonical,
    alternates: data ? { appUrl: data.appUrl, path: "/pokedex" } : undefined,
  });
}

export function headers(_args: Route.HeadersArgs) {
  // Data only changes with the (weekly) catalog sync — cache hard at the edge.
  return { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const locale = resolveLocale(params.locale);
  const db = createDb(env.DB);
  const agg = await listPokedexAggregates(db);

  // Merge the full static National Pokédex with the live per-dex aggregates so
  // every Pokémon appears (0 cards / no price when it has none), grouped by gen.
  const generations = GENERATION_MAX.map((_, i) => i + 1).map((gen) => ({
    gen,
    items: SPECIES.filter((s) => generationOf(s.dex) === gen).map((s) => {
      const a = agg.get(s.dex);
      return {
        dex: s.dex,
        name: s.name,
        cardCount: a?.cardCount ?? 0,
        avgPriceMinor: a?.avgPriceMinor ?? null,
      };
    }),
  }));

  return {
    generations,
    locale,
    t: getDict(locale).pokedex,
    c: getDict(locale).common,
    appUrl: env.APP_URL,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, "/pokedex")),
  };
}

export default function Pokedex({ loaderData }: Route.ComponentProps) {
  const { generations, locale, t, c } = loaderData;
  const lp = useLocalePath();
  const langTag = LANG_TAGS[locale];

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to={lp("/")} className="hover:text-fg">
          {c.home}
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-fg">
          {t.breadcrumb}
        </span>
      </nav>

      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-fg">{t.heading}</h1>
        <p className="max-w-3xl text-sm text-fg-muted">{t.intro}</p>
      </div>

      {generations.map((group) => (
        <section key={group.gen} className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-fg">
            {interpolate(t.generationLabel, { n: group.gen })}
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {group.items.map((p) => {
              const number = `#${String(p.dex).padStart(4, "0")}`;
              const hasCards = p.cardCount > 0;
              return (
                <li key={p.dex}>
                  <Link
                    to={`${lp("/cards")}?q=${encodeURIComponent(p.name)}`}
                    aria-label={`${p.name} ${number}`}
                    className="flex h-full flex-col items-center gap-1 rounded-(--radius-card) border border-edge bg-surface p-3 text-center hover:border-accent"
                  >
                    <img
                      src={`/sprites/${p.dex}.png`}
                      alt={p.name}
                      width={96}
                      height={96}
                      loading="lazy"
                      className={`h-16 w-16 object-contain ${hasCards ? "" : "opacity-50"}`}
                    />
                    <span className="text-xs font-medium text-fg-faint tabular-nums">{number}</span>
                    <span className="truncate text-sm font-semibold text-fg" title={p.name}>
                      {p.name}
                    </span>
                    <span className="text-xs text-fg-muted">
                      {hasCards ? interpolate(t.cardsCount, { count: p.cardCount }) : t.noCards}
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-fg">
                      {formatMinor(p.avgPriceMinor, "USD", langTag)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
