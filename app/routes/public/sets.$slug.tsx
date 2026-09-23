import { data as dataResponse, Link, useSearchParams } from "react-router";

import type { Route } from "./+types/sets.$slug";
import { optionalUser } from "~/lib/auth/guards.server";
import { getCloudflare, getMarket } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { getSetBySlug } from "~/lib/catalog/queries.server";
import { MARKET_CURRENCY } from "~/lib/market/market";
import { computeSetProgress } from "~/lib/sets/progress.server";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { LANG_TAGS, localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { interpolate } from "~/lib/i18n/t";
import { formatMinor } from "~/lib/money/decimal";
import {
  breadcrumbJsonLd,
  canonicalUrl,
  collectionPageJsonLd,
  JsonLd,
  pageMeta,
} from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data) {
    return pageMeta({
      title: "Set not found | Pokector",
      description: "Set not found.",
      noindex: true,
    });
  }
  const { set, t } = data;
  const released = set.releaseDate ? interpolate(t.metaReleased, { date: set.releaseDate }) : "";
  return pageMeta({
    title: interpolate(t.metaTitle, { name: set.name }),
    description: interpolate(t.metaDescription, {
      name: set.name,
      series: set.series,
      released,
      total: set.total ?? t.metaAllCards,
    }),
    canonical: data.canonical,
    alternates: { appUrl: data.appUrl, path: `/sets/${set.slug}` },
    image: set.logoUrl ?? undefined,
  });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  // The loader owns the policy and returns `private, no-store` whenever the
  // response carries a signed-in visitor's set progress. The fallback below is
  // the anonymous case, which is shareable since 2026-09-23 — see the note in
  // workers/html-cache.ts for why a URL-keyed cache is safe there.
  return {
    "Cache-Control":
      loaderHeaders.get("Cache-Control") ?? "public, s-maxage=300, stale-while-revalidate=3600",
  };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(params.locale);
  const market = getMarket(context);
  const data = await getSetBySlug(db, params.slug, market);
  if (!data) throw new Response("Set not found", { status: 404 });

  const session = await optionalUser(context, request);
  const progress = session
    ? await computeSetProgress(db, session.user.id, data.set.id, market)
    : null;

  const payload = {
    locale,
    currency: MARKET_CURRENCY[market],
    t: getDict(locale).setDetail,
    c: getDict(locale).common,
    set: {
      id: data.set.id,
      slug: data.set.slug,
      name: data.set.name,
      series: data.set.series,
      releaseDate: data.set.releaseDate,
      printedTotal: data.set.printedTotal,
      total: data.set.total,
      logoUrl: data.set.logoUrl,
      symbolUrl: data.set.symbolUrl,
      sourceUpdatedAt: data.set.sourceUpdatedAt,
    },
    cards: data.cards,
    estimatedValueMinor: data.estimatedValueMinor,
    pricedCount: data.pricedCount,
    progress: progress
      ? {
          ownedCount: progress.ownedCount,
          totalCount: progress.totalCount,
          missingCount: progress.missingCount,
          completionPercent: progress.completionPercent,
          missingValueMinor: progress.missingValueMinor,
          missingPricedCount: progress.missingPricedCount,
          ownedCardIds: progress.ownedCardIds,
        }
      : null,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, `/sets/${data.set.slug}`)),
    appUrl: env.APP_URL,
  };

  return dataResponse(payload, {
    headers: {
      // Signed-in progress is per-user and must never be shared; the anonymous
      // branch is shareable (see headers() above).
      "Cache-Control": progress
        ? "private, no-store"
        : "public, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}

const RARITY_GROUPS = ["Common", "Uncommon", "Rare"];

export default function SetDetail({ loaderData }: Route.ComponentProps) {
  const { set, cards, estimatedValueMinor, pricedCount, progress, appUrl, locale, currency, t, c } =
    loaderData;
  const lp = useLocalePath();
  const langTag = LANG_TAGS[locale];
  const money = (minor: number, cur: "USD" | "EUR" = currency) => formatMinor(minor, cur, langTag);
  const [searchParams, setSearchParams] = useSearchParams();
  const ownedFilter = searchParams.get("show"); // "owned" | "missing" | null
  const rarityFilter = searchParams.get("rarity");
  const typeFilter = searchParams.get("type");

  const ownedSet = new Set(progress?.ownedCardIds ?? []);
  const visibleCards = cards.filter((card) => {
    if (progress && ownedFilter === "owned" && !ownedSet.has(card.id)) return false;
    if (progress && ownedFilter === "missing" && ownedSet.has(card.id)) return false;
    if (rarityFilter) {
      // "Rare+" bucket = anything beyond Common/Uncommon. Modern rarity names
      // ("Double Rare", "Illustration Rare", "Ultra Rare", …) don't share a
      // common prefix, so membership is defined by exclusion.
      if (rarityFilter === "Rare") {
        if (!card.rarity || card.rarity === "Common" || card.rarity === "Uncommon") return false;
      } else if (card.rarity !== rarityFilter) {
        return false;
      }
    }
    if (typeFilter && card.supertype !== typeFilter) return false;
    return true;
  });

  // "Most valuable cards" highlight — derived from the already-loaded cards
  // (each carries its market price), so no extra query. Targets "most valuable
  // {set} cards". Shown only with enough priced cards to be meaningful.
  const topValueCards = [...cards]
    .filter((card) => card.priceMinor != null)
    .sort((a, b) => (b.priceMinor ?? 0) - (a.priceMinor ?? 0))
    .slice(0, 8);

  function setFilter(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { preventScrollReset: true });
  }

  return (
    <div className="flex flex-col gap-8">
      <JsonLd
        data={[
          breadcrumbJsonLd(appUrl, [
            { name: c.home, path: lp("/") },
            { name: t.breadcrumbSets, path: lp("/sets") },
            { name: set.name, path: lp(`/sets/${set.slug}`) },
          ]),
          collectionPageJsonLd(appUrl, {
            name: interpolate(t.setCardList, { name: set.name }),
            description: interpolate(t.setCardListDescription, { name: set.name }),
            path: lp(`/sets/${set.slug}`),
            items: cards
              .slice(0, 10)
              .map((card) => ({ name: card.name, path: lp(`/cards/${card.slug}`) })),
          }),
        ]}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to={lp("/")} className="hover:text-fg">
          {c.home}
        </Link>
        <span aria-hidden="true"> / </span>
        <Link to={lp("/sets")} className="hover:text-fg">
          {t.breadcrumbSets}
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-fg">
          {set.name}
        </span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-6">
        {set.logoUrl ? (
          <img src={set.logoUrl} alt="" className="h-16 w-auto object-contain" />
        ) : null}
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold text-fg">
            {set.name}
            {set.symbolUrl ? <img src={set.symbolUrl} alt="" className="h-6 w-6" /> : null}
          </h1>
          <p className="text-fg-muted">
            {set.series}
            {set.releaseDate ? interpolate(t.released, { date: set.releaseDate }) : ""}
            {interpolate(t.cardsCount, { count: set.total ?? "?" })}
            {set.printedTotal && set.total && set.printedTotal !== set.total
              ? interpolate(t.printedSuffix, { count: set.printedTotal })
              : ""}
          </p>
          {estimatedValueMinor !== null ? (
            <p className="mt-1 text-sm text-fg-muted">
              {t.estimatedValuePre}
              <strong className="text-fg">{money(estimatedValueMinor)}</strong>{" "}
              <span className="text-fg-faint">
                {interpolate(t.estimatedValueNote, {
                  priced: pricedCount,
                  total: cards.length,
                })}
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-fg-faint">{t.noValueCoverage}</p>
          )}
        </div>
      </div>

      {/* Most valuable cards in this set (price-ranked highlight) */}
      {topValueCards.length >= 3 ? (
        <section aria-labelledby="topvalue-heading" className="flex flex-col gap-4">
          <h2 id="topvalue-heading" className="text-xl font-semibold text-fg">
            {interpolate(t.mostValuableHeading, { name: set.name })}
          </h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-8">
            {topValueCards.map((card, i) => (
              <li key={card.id} className="relative">
                <Link to={lp(`/cards/${card.slug}`)} className="group flex h-full flex-col gap-2">
                  <span className="absolute start-1 top-1 z-10 rounded bg-fg/80 px-1.5 py-0.5 text-xs font-bold text-canvas">
                    #{i + 1}
                  </span>
                  {card.imageSmallUrl ? (
                    <img
                      src={card.imageSmallUrl}
                      alt={`${card.name} card`}
                      loading="lazy"
                      className="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
                    />
                  ) : (
                    <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-xs text-fg-faint">
                      {c.noImage}
                    </span>
                  )}
                  <div>
                    <p className="truncate text-sm font-medium text-fg group-hover:text-accent">
                      {card.name}
                    </p>
                    <p className="truncate text-xs font-semibold tabular-nums text-fg-muted">
                      {card.priceMinor !== null ? money(card.priceMinor) : ""}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Signed-in completion */}
      {progress ? (
        <section
          aria-labelledby="progress-heading"
          className="rounded-(--radius-card) border border-accent/40 bg-accent-soft p-5"
        >
          <h2 id="progress-heading" className="mb-2 font-semibold text-fg">
            {t.completionHeading}
          </h2>
          <div
            role="progressbar"
            aria-valuenow={Math.round(progress.completionPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={interpolate(t.completionAria, {
              owned: progress.ownedCount,
              total: progress.totalCount,
            })}
            className="mb-2 h-3 w-full overflow-hidden rounded-full bg-surface"
          >
            <div className="h-full bg-accent" style={{ width: `${progress.completionPercent}%` }} />
          </div>
          <p className="text-sm text-fg-muted">
            <strong className="text-fg">{progress.ownedCount}</strong> {t.owned} ·{" "}
            <strong className="text-fg">{progress.missingCount}</strong> {t.missing} ·{" "}
            {interpolate(t.complete, { percent: progress.completionPercent.toFixed(1) })}
            {progress.missingValueMinor !== null ? (
              <>
                {t.missingValuePre}
                <strong className="text-fg">{money(progress.missingValueMinor)}</strong>
                <span className="text-fg-faint">
                  {interpolate(t.missingValueNote, {
                    priced: progress.missingPricedCount,
                    missing: progress.missingCount,
                  })}
                </span>
              </>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-fg-faint">{t.checklistNote}</p>
        </section>
      ) : (
        <p className="rounded-lg border border-edge bg-surface p-4 text-sm text-fg-muted">
          <Link to={lp("/login")} className="text-accent hover:underline">
            {c.signIn}
          </Link>
          {t.signInPre}
        </p>
      )}

      {/* Filters */}
      <div
        className="flex flex-wrap items-center gap-2 text-sm"
        role="group"
        aria-label="Card list filters"
      >
        {progress ? (
          <>
            <FilterChip
              active={ownedFilter === null}
              onClick={() => setFilter("show", null)}
              label={t.filterAll}
            />
            <FilterChip
              active={ownedFilter === "owned"}
              onClick={() => setFilter("show", "owned")}
              label={t.filterOwned}
            />
            <FilterChip
              active={ownedFilter === "missing"}
              onClick={() => setFilter("show", "missing")}
              label={t.filterMissing}
            />
            <span aria-hidden="true" className="mx-1 text-fg-faint">
              |
            </span>
          </>
        ) : null}
        <FilterChip
          active={rarityFilter === null}
          onClick={() => setFilter("rarity", null)}
          label={t.filterAnyRarity}
        />
        {RARITY_GROUPS.map((rarity) => (
          <FilterChip
            key={rarity}
            active={rarityFilter === rarity}
            onClick={() => setFilter("rarity", rarity)}
            label={
              rarity === "Rare"
                ? t.filterRarePlus
                : rarity === "Common"
                  ? t.rarityCommon
                  : t.rarityUncommon
            }
          />
        ))}
        <span aria-hidden="true" className="mx-1 text-fg-faint">
          |
        </span>
        <FilterChip
          active={typeFilter === null}
          onClick={() => setFilter("type", null)}
          label={t.filterAnyType}
        />
        {[
          { value: "Pokémon", label: t.typePokemon },
          { value: "Trainer", label: t.typeTrainer },
          { value: "Energy", label: t.typeEnergy },
        ].map((st) => (
          <FilterChip
            key={st.value}
            active={typeFilter === st.value}
            onClick={() => setFilter("type", st.value)}
            label={st.label}
          />
        ))}
      </div>

      {/* Card list */}
      <p className="text-sm text-fg-muted" role="status">
        {interpolate(t.showingCount, { visible: visibleCards.length, total: cards.length })}
      </p>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {visibleCards.map((card) => {
          const owned = ownedSet.has(card.id);
          return (
            <li key={card.id} className="relative">
              <Link to={lp(`/cards/${card.slug}`)} className="group flex h-full flex-col gap-2">
                {progress ? (
                  <span
                    className={`absolute start-1.5 top-1.5 z-10 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      owned
                        ? "bg-accent text-(color:--color-on-accent)"
                        : "bg-surface text-fg-muted border border-edge"
                    }`}
                  >
                    {owned ? t.badgeOwned : t.badgeMissing}
                  </span>
                ) : null}
                {card.imageSmallUrl ? (
                  <img
                    src={card.imageSmallUrl}
                    alt={`${card.name} card`}
                    loading="lazy"
                    className={`aspect-[63/88] w-full rounded-lg border object-cover group-hover:border-accent ${
                      progress && !owned ? "border-edge opacity-60" : "border-edge"
                    }`}
                  />
                ) : (
                  <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-xs text-fg-faint">
                    {c.noImage}
                  </span>
                )}
                <div>
                  <p className="truncate text-sm font-medium text-fg group-hover:text-accent">
                    {card.name}
                  </p>
                  <p className="text-xs text-fg-faint">
                    #{card.number}
                    {card.rarity ? ` · ${card.rarity}` : ""}
                    {card.priceMinor !== null ? ` · ${money(card.priceMinor)}` : ""}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-9 rounded-full px-3 text-xs font-medium ${
        active
          ? "bg-accent text-(color:--color-on-accent)"
          : "border border-edge text-fg-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}
