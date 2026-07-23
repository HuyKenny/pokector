import { Link, useSearchParams } from "react-router";

import type { Route } from "./+types/riftbound.sets.$slug";
import { CardImage } from "~/components/card-image";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { formatMinor } from "~/lib/money/decimal";
import { getRiftboundSetBySlug } from "~/lib/riftbound/queries.server";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data) return pageMeta({ title: "Riftbound set | Pokector", description: "" });
  return pageMeta({
    title: `Riftbound ${data.set.name} — Card List & Prices | Pokector`,
    description: `Every card in the Riftbound ${data.set.name} set (${data.cards.length} cards) with live TCGplayer market prices, updated daily.`,
    canonical: data.canonical,
    alternates: { appUrl: data.appUrl, path: `/riftbound/sets/${data.set.slug}` },
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(params.locale);
  const data = await getRiftboundSetBySlug(db, params.slug);
  if (!data) throw new Response("Set not found", { status: 404 });
  // Full-set value = sum of each card's cheapest priced variant (USD), matching
  // the Pokémon set header. Only cards with a price contribute.
  const priced = data.cards.filter((c) => c.priceMinor !== null);
  const estimatedValueMinor =
    priced.length > 0 ? priced.reduce((sum, c) => sum + (c.priceMinor ?? 0), 0) : null;
  return {
    set: data.set,
    cards: data.cards,
    estimatedValueMinor,
    pricedCount: priced.length,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, `/riftbound/sets/${data.set.slug}`)),
    appUrl: env.APP_URL,
  };
}

function money(minor: number | null | undefined): string {
  return minor == null ? "—" : formatMinor(minor, "USD");
}

export default function RiftboundSetDetail({ loaderData }: Route.ComponentProps) {
  const { set, cards, estimatedValueMinor, pricedCount } = loaderData;
  const lp = useLocalePath();
  const [searchParams, setSearchParams] = useSearchParams();
  const rarityFilter = searchParams.get("rarity");

  const rarities = [
    ...new Set(
      cards
        .map((c) => c.rarity)
        .filter((r): r is string => !!r && r.toLowerCase() !== "none"),
    ),
  ].sort();
  const visibleCards = rarityFilter
    ? cards.filter((c) => c.rarity === rarityFilter)
    : cards;

  const setRarity = (value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete("rarity");
    else next.set("rarity", value);
    setSearchParams(next, { preventScrollReset: true });
  };

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to={lp("/riftbound/sets")} className="hover:text-fg">
          Riftbound sets
        </Link>{" "}
        / <span className="text-fg">{set.name}</span>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-center gap-6">
        {set.imageUrl ? (
          <img src={set.imageUrl} alt="" className="h-16 w-auto object-contain" />
        ) : null}
        <div>
          <h1 className="text-3xl font-bold text-fg">Riftbound {set.name}</h1>
          <p className="text-fg-muted">
            League of Legends TCG
            {set.releaseDate ? ` · Released ${set.releaseDate}` : ""} · {cards.length} cards
          </p>
          {estimatedValueMinor !== null ? (
            <p className="mt-1 text-sm text-fg-muted">
              Estimated full-set market value:{" "}
              <strong className="text-fg">{money(estimatedValueMinor)}</strong>{" "}
              <span className="text-fg-faint">
                (sum of cheapest priced variant for {pricedCount} of {cards.length} cards; raw cards)
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-fg-faint">No price coverage for this set yet.</p>
          )}
        </div>
      </div>

      <p className="max-w-3xl text-sm text-fg-muted">
        The full Riftbound {set.name} card list, with a live TCGplayer market price on every
        card. Sort by rarity to find the set's chase cards, or open any card for its price
        history.
      </p>

      {/* Rarity filters */}
      {rarities.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Rarity filter">
          <FilterChip active={rarityFilter === null} onClick={() => setRarity(null)} label="Any rarity" />
          {rarities.map((r) => (
            <FilterChip
              key={r}
              active={rarityFilter === r}
              onClick={() => setRarity(r)}
              label={r}
            />
          ))}
        </div>
      ) : null}

      <p className="text-sm text-fg-muted" role="status">
        Showing {visibleCards.length} of {cards.length} cards
      </p>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {visibleCards.map((c) => (
          <li key={c.id}>
            <Link to={lp(`/riftbound/cards/${c.slug}`)} className="group flex h-full flex-col gap-2">
              <CardImage
                src={c.imageSmallUrl}
                alt={`${c.name} #${c.number}`}
                imgClassName="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
                fallbackClassName="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-xs text-fg-faint"
              />
              <div>
                <p className="truncate text-sm font-medium text-fg group-hover:text-accent">
                  {c.name}
                </p>
                <p className="truncate text-xs text-fg-faint">
                  #{c.number}
                  {c.rarity ? ` · ${c.rarity}` : ""}
                  {c.priceMinor !== null ? ` · ${formatMinor(c.priceMinor, "USD")}` : ""}
                </p>
              </div>
            </Link>
          </li>
        ))}
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
