import { data, Form, Link, useSearchParams } from "react-router";

import type { Route } from "./+types/cards";
import { optionalUser } from "~/lib/auth/guards.server";
import { getUserCardState } from "~/lib/collection/queries.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import {
  listSetsBrief,
  searchCards,
  searchCardsRelaxed,
  type CardListItem,
} from "~/lib/catalog/queries.server";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { LANG_TAGS, localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { interpolate } from "~/lib/i18n/t";
import { canonicalUrl, collectionPageJsonLd, JsonLd, pageMeta } from "~/lib/seo/meta";
import { clientIp, enforceRateLimit } from "~/lib/security/rate-limit.server";

export function meta({ loaderData: data }: Route.MetaArgs) {
  const page = data?.result.page ?? 1;
  const suffix = data && page > 1 ? interpolate(data.t.metaTitleSuffix, { page }) : "";
  return pageMeta({
    title: data ? interpolate(data.t.metaTitle, { suffix }) : "Pokector",
    description: data?.t.metaDescription ?? "",
    canonical: data?.canonical,
    // Search results and filter combinations must not be indexed (and get no
    // hreflang — pageMeta skips alternates when noindex).
    noindex: Boolean(data?.filtered),
    // hreflang only on page 1 — deeper pages self-canonicalize to their own
    // ?page=N (built in the loader) and don't need locale alternates.
    alternates: data && page === 1 ? { appUrl: data.appUrl, path: "/cards" } : undefined,
  });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  // Signed-in requests carry per-user ownership badges → the loader marks them
  // `private` so a URL-keyed shared cache can't leak one user's owned counts.
  // Anonymous requests set no header and fall back to the shared edge cache.
  return {
    "Cache-Control":
      loaderHeaders.get("Cache-Control") ?? "public, s-maxage=300, stale-while-revalidate=1800",
  };
}

export async function loader({ params: routeParams, request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const locale = resolveLocale(routeParams.locale);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q) {
    await enforceRateLimit(createDb(env.DB), "search", clientIp(request));
  }
  const params = {
    q: q || undefined,
    setId: url.searchParams.get("set") ?? undefined,
    rarity: url.searchParams.get("rarity") ?? undefined,
    supertype: url.searchParams.get("supertype") ?? undefined,
    sort: (url.searchParams.get("sort") as "name" | "number" | "newest" | null) ?? undefined,
    page: Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  };
  const db = createDb(env.DB);
  const [result, sets, session] = await Promise.all([
    searchCards(db, params),
    listSetsBrief(db),
    optionalUser(context, request),
  ]);
  const filtered = Boolean(q || params.setId || params.rarity || params.supertype || params.sort);
  // On a zero-result text search, offer relaxed "did you mean" suggestions.
  const suggestions =
    q && result.total === 0 ? await searchCardsRelaxed(db, q, 12) : ([] as CardListItem[]);

  // "You own this" badges for signed-in users — one batch query over the ids on
  // this page (results + any suggestions). Anonymous users get an empty map and
  // the shared edge cache; signed-in responses go `private` (see headers()).
  const ownedState = session
    ? await getUserCardState(
        db,
        session.user.id,
        [...result.items, ...suggestions].map((card) => card.id),
      )
    : {};

  const payload = {
    result,
    suggestions,
    sets,
    q,
    filtered,
    ownedState,
    locale,
    t: getDict(locale).cards,
    c: getDict(locale).common,
    appUrl: env.APP_URL,
    // Self-referential canonical INCLUDING ?page=N for deep pages, so page 2+
    // no longer canonicalize to page 1 (a cross-content canonical Google
    // ignores). Page 1 stays param-less.
    canonical:
      params.page > 1
        ? `${canonicalUrl(env.APP_URL, localePath(locale, "/cards"))}?page=${params.page}`
        : canonicalUrl(env.APP_URL, localePath(locale, "/cards")),
  };
  return session ? data(payload, { headers: { "Cache-Control": "private, no-cache" } }) : payload;
}

// Rarity option values are catalog data (DB query values) and stay English.
const RARITIES = ["Common", "Uncommon", "Rare", "Rare Holo", "Rare Ultra", "Rare Secret"];

export default function Cards({ loaderData }: Route.ComponentProps) {
  const { result, suggestions, sets, q, ownedState, appUrl, locale, t, c } = loaderData;
  const [searchParams] = useSearchParams();
  const lp = useLocalePath();
  const langTag = LANG_TAGS[locale];

  function pageLink(page: number): string {
    const next = new URLSearchParams(searchParams);
    if (page <= 1) next.delete("page");
    else next.set("page", String(page));
    const qs = next.toString();
    return qs ? `${lp("/cards")}?${qs}` : lp("/cards");
  }

  return (
    <div className="flex flex-col gap-6">
      <JsonLd
        data={collectionPageJsonLd(appUrl, {
          name: t.collectionName,
          description: t.collectionDescription,
          path: lp("/cards"),
          items: result.items.slice(0, 10).map((card) => ({
            name: card.name,
            path: lp(`/cards/${card.slug}`),
          })),
        })}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to={lp("/")} className="hover:text-fg">
          {c.home}
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-fg">
          {t.breadcrumb}
        </span>
      </nav>

      <h1 className="text-3xl font-bold text-fg">{t.heading}</h1>

      <Form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="flex min-w-52 flex-1 flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium text-fg">
            {t.searchLabel}
          </label>
          <input
            id="q"
            type="search"
            name="q"
            defaultValue={q}
            placeholder={t.searchPlaceholder}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg placeholder:text-fg-faint"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="set" className="text-sm font-medium text-fg">
            {t.setLabel}
          </label>
          <select
            id="set"
            name="set"
            defaultValue={searchParams.get("set") ?? ""}
            className="min-h-11 max-w-48 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="">{c.any}</option>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="rarity" className="text-sm font-medium text-fg">
            {t.rarityLabel}
          </label>
          <select
            id="rarity"
            name="rarity"
            defaultValue={searchParams.get("rarity") ?? ""}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="">{c.any}</option>
            {RARITIES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="supertype" className="text-sm font-medium text-fg">
            {t.cardTypeLabel}
          </label>
          <select
            id="supertype"
            name="supertype"
            defaultValue={searchParams.get("supertype") ?? ""}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="">{c.any}</option>
            <option value="Pokémon">{t.typePokemon}</option>
            <option value="Trainer">{t.typeTrainer}</option>
            <option value="Energy">{t.typeEnergy}</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sort" className="text-sm font-medium text-fg">
            {t.sortLabel}
          </label>
          <select
            id="sort"
            name="sort"
            defaultValue={searchParams.get("sort") ?? "name"}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="name">{t.sortName}</option>
            <option value="number">{t.sortNumber}</option>
            <option value="newest">{t.sortNewest}</option>
          </select>
        </div>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-accent px-5 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
        >
          {c.apply}
        </button>
      </Form>

      <p className="text-sm text-fg-muted" role="status">
        {q
          ? interpolate(t.resultCountMatching, {
              count: result.total.toLocaleString(langTag),
              q,
              page: result.page,
              pageCount: result.pageCount,
            })
          : interpolate(t.resultCountPlain, {
              count: result.total.toLocaleString(langTag),
              page: result.page,
              pageCount: result.pageCount,
            })}
      </p>

      {result.items.length === 0 ? (
        <div className="flex flex-col gap-6">
          <div className="rounded-(--radius-card) border border-edge bg-surface p-10 text-center">
            <p className="mb-2 text-lg font-medium text-fg">{t.emptyTitle}</p>
            <p className="text-sm text-fg-muted">{t.emptyBody}</p>
          </div>
          {suggestions.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-fg-muted">{t.didYouMean}</h2>
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
                {suggestions.map((card) => (
                  <li key={card.id}>
                    <CardTile
                      card={card}
                      to={lp(`/cards/${card.slug}`)}
                      noImage={c.noImage}
                      owned={ownedState[card.id]?.ownedQuantity ?? 0}
                      ownedAria={t.ownedBadgeAria}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {result.items.map((card) => (
            <li key={card.id}>
              <CardTile
                card={card}
                to={lp(`/cards/${card.slug}`)}
                noImage={c.noImage}
                owned={ownedState[card.id]?.ownedQuantity ?? 0}
                ownedAria={t.ownedBadgeAria}
              />
            </li>
          ))}
        </ul>
      )}

      {result.pageCount > 1 && result.items.length > 0 ? (
        <nav aria-label={t.paginationAria} className="flex items-center justify-center gap-2">
          {result.page > 1 ? (
            <Link
              to={pageLink(result.page - 1)}
              className="rounded-lg border border-edge px-4 py-2 text-sm hover:bg-surface-raised"
            >
              {c.previous}
            </Link>
          ) : null}
          <span className="px-2 text-sm text-fg-muted">
            {interpolate(c.pageShort, { page: result.page, pageCount: result.pageCount })}
          </span>
          {result.page < result.pageCount ? (
            <Link
              to={pageLink(result.page + 1)}
              className="rounded-lg border border-edge px-4 py-2 text-sm hover:bg-surface-raised"
            >
              {c.next}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}

/** Result tile — image + name + set/year/number/rarity for cross-set disambiguation. */
function CardTile({
  card,
  to,
  noImage,
  owned = 0,
  ownedAria,
}: {
  card: CardListItem;
  to: string;
  noImage: string;
  owned?: number;
  ownedAria?: string;
}) {
  const year = card.releaseDate?.slice(0, 4);
  return (
    <Link to={to} className="group flex h-full flex-col gap-2">
      <div className="relative">
        {card.imageSmallUrl ? (
          <img
            src={card.imageSmallUrl}
            alt={`${card.name} — ${card.setName ?? card.setId} ${card.number}`}
            loading="lazy"
            className="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
          />
        ) : (
          <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-sm text-fg-faint">
            {noImage}
          </span>
        )}
        {owned > 0 ? (
          <span
            className="absolute end-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-positive/90 px-2 py-0.5 text-xs font-bold text-(color:--color-on-accent) shadow-sm"
            aria-label={ownedAria ? interpolate(ownedAria, { count: owned }) : `${owned}`}
          >
            ✓{owned}
          </span>
        ) : null}
      </div>
      <div>
        <p className="truncate text-sm font-medium text-fg group-hover:text-accent">{card.name}</p>
        <p className="truncate text-xs text-fg-faint">
          {card.setName}
          {year ? ` · ${year}` : ""} · #{card.number}
          {card.rarity ? ` · ${card.rarity}` : ""}
        </p>
      </div>
    </Link>
  );
}
