import { useState } from "react";
import { Link, useFetcher } from "react-router";

import type { Route } from "./+types/cards.$slug";
import {
  carryForward,
  HistoryChart,
  rangeStartDate,
  type ChartRange,
  type HistoryPoint,
} from "~/components/history-chart";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import {
  bumpCardPopularity,
  getCardBySlug,
  getCardPriceHistory,
} from "~/lib/catalog/queries.server";
import { formatMinor } from "~/lib/money/decimal";
import { breadcrumbJsonLd, canonicalUrl, JsonLd, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data) {
    return pageMeta({
      title: "Card not found | Pokector",
      description: "Card not found.",
      noindex: true,
    });
  }
  const { card, set } = data.detail;
  const price = data.headlinePriceMinor;
  return pageMeta({
    title: `${card.name} — ${set.name} #${card.number} Price & Details | Pokector`,
    description: `${card.name} (${set.name} #${card.number}${card.rarity ? `, ${card.rarity}` : ""})${
      price !== null ? ` — current estimated market price ${formatMinor(price)}` : ""
    }. Variants, price history, and collection tracking on Pokector.`,
    canonical: data.canonical,
    image: card.imageLargeUrl ?? card.imageSmallUrl ?? undefined,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env, ctx } = getCloudflare(context);
  const db = createDb(env.DB);
  const detail = await getCardBySlug(db, params.slug);
  if (!detail) {
    throw new Response("Card not found", { status: 404 });
  }

  // Popularity signal for history tracking — off the response critical path.
  ctx.waitUntil(bumpCardPopularity(db, detail.card.id).catch(() => undefined));

  const history = await getCardPriceHistory(db, detail.card.id, { source: "tcgplayer" });

  const tcgplayerPrices = detail.prices.filter((p) => p.source === "tcgplayer");
  const headlinePriceMinor =
    tcgplayerPrices.length > 0
      ? Math.max(...tcgplayerPrices.map((p) => p.normalizedPriceMinor))
      : null;

  return {
    detail,
    history,
    headlinePriceMinor,
    canonical: canonicalUrl(env.APP_URL, `/cards/${detail.card.slug}`),
    appUrl: env.APP_URL,
  };
}

const VARIANT_LABELS: Record<string, string> = {
  normal: "Normal",
  holofoil: "Holofoil",
  reverseHolofoil: "Reverse Holofoil",
  firstEditionNormal: "1st Edition",
  firstEditionHolofoil: "1st Edition Holofoil",
};

export default function CardDetail({ loaderData }: Route.ComponentProps) {
  const { detail, history, appUrl } = loaderData;
  const { card, set, prices, related, trackingSince } = detail;
  const [range, setRange] = useState<ChartRange>("MAX");
  const fetcher = useFetcher();

  const tcgplayer = prices.filter((p) => p.source === "tcgplayer");
  const cardmarket = prices.filter((p) => p.source === "cardmarket");
  const availableVariants = [...new Set(tcgplayer.map((p) => p.variant))];
  const [chartVariant, setChartVariant] = useState(availableVariants[0] ?? "normal");

  const today = new Date().toISOString().slice(0, 10);
  const sinceDate = rangeStartDate(range);
  const chartPoints: HistoryPoint[] = carryForward(
    history
      .filter((h) => h.variant === chartVariant && (!sinceDate || h.recordedDate >= sinceDate))
      .map((h) => ({ date: h.recordedDate, valueMinor: h.priceMinor })),
    today,
  );

  const types: string[] = card.typesJson ? (JSON.parse(card.typesJson) as string[]) : [];
  const subtypes: string[] = card.subtypesJson ? (JSON.parse(card.subtypesJson) as string[]) : [];

  return (
    <div className="flex flex-col gap-8">
      <JsonLd
        data={[
          breadcrumbJsonLd(appUrl, [
            { name: "Home", path: "/" },
            { name: "Cards", path: "/cards" },
            { name: set.name, path: `/sets/${set.slug}` },
            { name: card.name, path: `/cards/${card.slug}` },
          ]),
        ]}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to="/" className="hover:text-fg">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <Link to="/cards" className="hover:text-fg">
          Cards
        </Link>
        <span aria-hidden="true"> / </span>
        <Link to={`/sets/${set.slug}`} className="hover:text-fg">
          {set.name}
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-fg">
          {card.name}
        </span>
      </nav>

      <div className="grid gap-8 md:grid-cols-[minmax(240px,320px)_1fr]">
        {/* Image */}
        <div>
          {(card.imageLargeUrl ?? card.imageSmallUrl) ? (
            <img
              src={card.imageLargeUrl ?? card.imageSmallUrl ?? undefined}
              alt={`${card.name} card, ${set.name} #${card.number}`}
              className="w-full rounded-xl border border-edge shadow-(--shadow-card)"
            />
          ) : (
            <div className="flex aspect-[63/88] items-center justify-center rounded-xl border border-edge bg-surface-raised text-fg-faint">
              No image available
            </div>
          )}
        </div>

        {/* Facts + prices */}
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-3xl font-bold text-fg">{card.name}</h1>
            <p className="text-fg-muted">
              <Link to={`/sets/${set.slug}`} className="text-accent hover:underline">
                {set.name}
              </Link>{" "}
              · #{card.number}
              {card.rarity ? ` · ${card.rarity}` : ""}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {card.supertype ? <Fact label="Card type" value={card.supertype} /> : null}
            {subtypes.length ? <Fact label="Subtypes" value={subtypes.join(", ")} /> : null}
            {types.length ? <Fact label="Energy type" value={types.join(", ")} /> : null}
            {card.hp ? <Fact label="HP" value={String(card.hp)} /> : null}
            {card.artist ? <Fact label="Artist" value={card.artist} /> : null}
            {set.releaseDate ? <Fact label="Set released" value={set.releaseDate} /> : null}
            {card.regulationMark ? (
              <Fact label="Regulation mark" value={card.regulationMark} />
            ) : null}
          </dl>

          {/* TCGplayer prices */}
          <section
            aria-labelledby="prices-heading"
            className="rounded-(--radius-card) border border-edge bg-surface p-5"
          >
            <h2 id="prices-heading" className="mb-3 font-semibold text-fg">
              Current market prices (USD)
            </h2>
            {tcgplayer.length === 0 ? (
              <p className="text-sm text-fg-muted">
                No market price is currently available for this card. It stays unpriced — Pokector
                never substitutes a guess.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-edge text-fg-muted">
                      <th scope="col" className="py-2 pr-4">
                        Variant
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Market est.
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Low
                      </th>
                      <th scope="col" className="py-2 pr-4">
                        Mid
                      </th>
                      <th scope="col" className="py-2">
                        High
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tcgplayer.map((price) => (
                      <tr key={price.variant} className="border-b border-edge/50">
                        <th scope="row" className="py-2 pr-4 font-medium text-fg">
                          {VARIANT_LABELS[price.variant] ?? price.variant}
                        </th>
                        <td className="py-2 pr-4 font-semibold text-fg">
                          {formatMinor(price.normalizedPriceMinor)}
                        </td>
                        <td className="py-2 pr-4">{formatMinor(price.lowMinor)}</td>
                        <td className="py-2 pr-4">{formatMinor(price.midMinor)}</td>
                        <td className="py-2">{formatMinor(price.highMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-fg-faint">
              Source: TCGplayer price data
              {tcgplayer[0]?.sourceUpdatedAt ? `, updated ${tcgplayer[0].sourceUpdatedAt}` : ""}.
              {trackingSince
                ? ` Pokector has tracked this card since ${trackingSince}.`
                : " Pokector price tracking starts with the first observation."}
              {card.tcgplayerUrl ? (
                <>
                  {" "}
                  <a
                    href={card.tcgplayerUrl}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    className="text-accent hover:underline"
                  >
                    View on TCGplayer ↗
                  </a>
                </>
              ) : null}
            </p>
            {cardmarket.length > 0 ? (
              <p className="mt-2 text-xs text-fg-muted">
                Cardmarket (EUR): {formatMinor(cardmarket[0].normalizedPriceMinor, "EUR")} trend
                {cardmarket[0].sourceUpdatedAt ? `, updated ${cardmarket[0].sourceUpdatedAt}` : ""}
                {card.cardmarketUrl ? (
                  <>
                    {" "}
                    <a
                      href={card.cardmarketUrl}
                      rel="noopener noreferrer nofollow"
                      target="_blank"
                      className="text-accent hover:underline"
                    >
                      View on Cardmarket ↗
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
          </section>

          {/* CTAs */}
          <div className="flex flex-wrap gap-3">
            <fetcher.Form method="post" action="/api/v1/collection/quick-add">
              <input type="hidden" name="cardId" value={card.id} />
              <button
                type="submit"
                className="min-h-11 rounded-lg bg-accent px-5 py-2 font-medium text-white hover:bg-accent-strong"
              >
                Add to collection
              </button>
            </fetcher.Form>
            <fetcher.Form method="post" action="/api/v1/wishlist/quick-add">
              <input type="hidden" name="cardId" value={card.id} />
              <button
                type="submit"
                className="min-h-11 rounded-lg border border-edge bg-surface px-5 py-2 font-medium text-fg hover:bg-surface-raised"
              >
                Add to wishlist
              </button>
            </fetcher.Form>
          </div>
          {fetcher.data && typeof fetcher.data === "object" && "message" in fetcher.data ? (
            <p className="text-sm text-fg-muted" role="status">
              {String((fetcher.data as { message: string }).message)}
            </p>
          ) : null}

          <p className="text-xs text-fg-faint">
            Displayed values are estimated market prices for raw (ungraded) cards and may not
            reflect the exact value of your copy, which depends on its physical condition and actual
            sale conditions. This is not financial advice.
          </p>
        </div>
      </div>

      {/* Price history */}
      <section className="rounded-(--radius-card) border border-edge bg-surface p-5">
        {availableVariants.length > 1 ? (
          <div className="mb-3 flex gap-1" role="group" aria-label="Price history variant">
            {availableVariants.map((variant) => (
              <button
                key={variant}
                type="button"
                onClick={() => setChartVariant(variant)}
                aria-pressed={chartVariant === variant}
                className={`min-h-9 rounded-md px-3 text-xs font-medium ${
                  chartVariant === variant
                    ? "bg-accent text-white"
                    : "border border-edge text-fg-muted"
                }`}
              >
                {VARIANT_LABELS[variant] ?? variant}
              </button>
            ))}
          </div>
        ) : null}
        <HistoryChart
          title={`Price history — ${VARIANT_LABELS[chartVariant] ?? chartVariant}`}
          points={chartPoints}
          range={range}
          onRangeChange={setRange}
          emptyMessage="No price history yet. Pokector records real observations only — tracking begins once this card is in a collection, wishlist, or viewed regularly."
          startNote={
            trackingSince
              ? `Tracking since ${trackingSince}. Values between observations carry the last known price forward.`
              : null
          }
        />
      </section>

      {/* Related cards */}
      {related.length > 0 ? (
        <section aria-labelledby="related-heading">
          <h2 id="related-heading" className="mb-4 text-xl font-bold text-fg">
            More from {set.name}
          </h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {related.map((rel) => (
              <li key={rel.id}>
                <Link to={`/cards/${rel.slug}`} className="group flex flex-col gap-2">
                  {rel.imageSmallUrl ? (
                    <img
                      src={rel.imageSmallUrl}
                      alt={`${rel.name} card`}
                      loading="lazy"
                      className="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
                    />
                  ) : (
                    <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-xs text-fg-faint">
                      No image
                    </span>
                  )}
                  <span className="truncate text-xs font-medium text-fg">{rel.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-fg-faint">{label}</dt>
      <dd className="font-medium text-fg">{value}</dd>
    </div>
  );
}
