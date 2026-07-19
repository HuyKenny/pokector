import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/pokedex";
import { listPokedexAggregates } from "~/lib/catalog/queries.server";
import { getCloudflare, getMarket } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { LANG_TAGS, localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { interpolate } from "~/lib/i18n/t";
import { MARKET_CURRENCY } from "~/lib/market/market";
import { formatMinor } from "~/lib/money/decimal";
import { generationLabel } from "~/lib/pokedex/generations";
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
  // Global data only; personal overlay (owned/favourites) is fetched client-side
  // from /api/v1/pokedex/me so this stays edge-cacheable for everyone.
  // `private`: the average prices depend on the market cookie (USD vs EUR).
  return { "Cache-Control": "private, max-age=1800, stale-while-revalidate=86400" };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const locale = resolveLocale(params.locale);
  const db = createDb(env.DB);
  const market = getMarket(context);
  const agg = await listPokedexAggregates(db, market);

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
    currency: MARKET_CURRENCY[market],
    t: getDict(locale).pokedex,
    c: getDict(locale).common,
    appUrl: env.APP_URL,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, "/pokedex")),
  };
}

type Item = { dex: number; name: string; cardCount: number; avgPriceMinor: number | null };
type Overlay = { signedIn: boolean; owned: Record<number, number>; favorites: number[] };

export default function Pokedex({ loaderData }: Route.ComponentProps) {
  const { generations, locale, currency, t, c } = loaderData;
  const lp = useLocalePath();
  const langTag = LANG_TAGS[locale];

  // Personal overlay (owned counts + favourites), fetched after hydration so the
  // SSR HTML stays public/cacheable. null until loaded / for signed-out users.
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [favorites, setFavorites] = useState<Set<number>>(new Set());
  // Filter: a generation number, or "all", or "favorites".
  const [filter, setFilter] = useState<number | "all" | "favorites">("all");

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/v1/pokedex/me", { credentials: "same-origin" });
        if (!r.ok) return;
        const data: Overlay = await r.json();
        if (!alive || !data.signedIn) return;
        setOverlay(data);
        setFavorites(new Set(data.favorites));
      } catch {
        // Page works fine without the personal overlay.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const signedIn = overlay?.signedIn ?? false;

  const toggleFavorite = useCallback((dex: number) => {
    // Optimistic flip; reconciled with the server's authoritative state below.
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(dex)) next.delete(dex);
      else next.add(dex);
      return next;
    });
    void (async () => {
      try {
        const r = await fetch("/api/v1/pokedex/favorite", {
          method: "POST",
          credentials: "same-origin",
          body: new URLSearchParams({ dex: String(dex) }),
        });
        if (!r.ok) return;
        const data: { favorited: boolean } = await r.json();
        setFavorites((prev) => {
          const next = new Set(prev);
          if (data.favorited) next.add(dex);
          else next.delete(dex);
          return next;
        });
      } catch {
        // Keep the optimistic state.
      }
    })();
  }, []);

  // Which groups to render for the current filter.
  const groups: { key: string; heading: string; items: Item[] }[] =
    filter === "favorites"
      ? [
          {
            key: "fav",
            heading: t.filterFavorites,
            items: generations.flatMap((g) => g.items).filter((i) => favorites.has(i.dex)),
          },
        ]
      : generations
          .filter((g) => filter === "all" || g.gen === filter)
          .map((g) => ({
            key: String(g.gen),
            heading: generationLabel(g.gen),
            items: g.items,
          }));

  const caught = overlay ? Object.values(overlay.owned).filter((n) => n > 0).length : 0;
  const totalSpecies = SPECIES.length;
  const caughtPct = totalSpecies ? Math.round((caught / totalSpecies) * 100) : 0;

  const filterBtn = (active: boolean) =>
    `min-h-9 rounded-full px-3 py-1.5 text-sm font-medium ${
      active
        ? "bg-accent text-(color:--color-on-accent)"
        : "border border-edge bg-surface text-fg-muted hover:text-fg"
    }`;

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

      {/* Caught progress (signed-in only): distinct Pokémon owned / total. */}
      {signedIn ? (
        <div className="flex max-w-md flex-col gap-1">
          <div className="flex items-center justify-between text-sm text-fg-muted tabular-nums">
            <span>
              {caught} / {totalSpecies}
            </span>
            <span>{caughtPct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-raised">
            <div className="h-full rounded-full bg-accent" style={{ width: `${caughtPct}%` }} />
          </div>
        </div>
      ) : null}

      {/* Filter bar: All · region (I..IX) · ★ Favorites (favorites only when signed in) */}
      <div className="flex flex-wrap gap-2" role="group" aria-label={t.heading}>
        <button
          type="button"
          onClick={() => setFilter("all")}
          aria-pressed={filter === "all"}
          className={filterBtn(filter === "all")}
        >
          {t.filterAll}
        </button>
        {generations.map((g) => (
          <button
            key={g.gen}
            type="button"
            onClick={() => setFilter(g.gen)}
            aria-pressed={filter === g.gen}
            className={filterBtn(filter === g.gen)}
          >
            {generationLabel(g.gen)}
          </button>
        ))}
        {signedIn ? (
          <button
            type="button"
            onClick={() => setFilter("favorites")}
            aria-pressed={filter === "favorites"}
            className={filterBtn(filter === "favorites")}
          >
            ★ {t.filterFavorites}
          </button>
        ) : null}
      </div>

      {groups.map((group) => (
        <section key={group.key} className="flex flex-col gap-3">
          {filter === "all" ? (
            <h2 className="text-lg font-semibold text-fg">{group.heading}</h2>
          ) : null}
          {group.items.length === 0 ? (
            <p className="rounded-(--radius-card) border border-edge bg-surface p-8 text-center text-fg-muted">
              {t.favoritesEmpty}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {group.items.map((p) => {
                const number = `#${String(p.dex).padStart(4, "0")}`;
                const hasCards = p.cardCount > 0;
                const isFav = favorites.has(p.dex);
                const owned = overlay?.owned[p.dex] ?? 0;
                return (
                  <li key={p.dex} className="relative">
                    {signedIn ? (
                      <button
                        type="button"
                        onClick={() => toggleFavorite(p.dex)}
                        aria-pressed={isFav}
                        aria-label={isFav ? t.removeFavorite : t.addFavorite}
                        title={isFav ? t.removeFavorite : t.addFavorite}
                        className={`absolute end-1.5 top-1.5 z-10 rounded-full px-1 text-lg leading-none ${
                          isFav ? "text-amber-400" : "text-fg-faint hover:text-amber-400"
                        }`}
                      >
                        {isFav ? "★" : "☆"}
                      </button>
                    ) : null}
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
                      <span className="text-xs font-medium tabular-nums text-fg-faint">{number}</span>
                      <span className="truncate text-sm font-semibold text-fg" title={p.name}>
                        {p.name}
                      </span>
                      <span className="text-xs text-fg-muted">
                        {!hasCards
                          ? t.noCards
                          : signedIn
                            ? interpolate(t.ownedCards, { owned, total: p.cardCount })
                            : interpolate(t.cardsCount, { count: p.cardCount })}
                      </span>
                      <span className="text-sm font-semibold tabular-nums text-fg">
                        {formatMinor(p.avgPriceMinor, currency, langTag)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
