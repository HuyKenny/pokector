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
import { buildEbaySearchUrl, ebayCardQuery } from "~/lib/affiliate/ebay";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { LANG_TAGS, localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { interpolate } from "~/lib/i18n/t";
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
  const { t } = data;
  const price = data.headlinePriceMinor;
  const langTag = LANG_TAGS[data.locale];
  const rarityPart = card.rarity ? interpolate(t.metaRarityPart, { rarity: card.rarity }) : "";
  const pricePart =
    price !== null
      ? interpolate(t.metaPricePart, { price: formatMinor(price, "USD", langTag) })
      : "";
  return pageMeta({
    title: interpolate(t.metaTitle, {
      name: card.name,
      setName: set.name,
      number: card.number,
    }),
    description: interpolate(t.metaDescription, {
      name: card.name,
      setName: set.name,
      number: card.number,
      rarityPart,
      pricePart,
    }),
    canonical: data.canonical,
    alternates: { appUrl: data.appUrl, path: `/cards/${card.slug}` },
    image: card.imageLargeUrl ?? card.imageSmallUrl ?? undefined,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env, ctx } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(params.locale);
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

  // eBay Partner Network affiliate search link (US marketplace). Null when the
  // campaign id isn't configured → the button is hidden.
  const ebayUrl = buildEbaySearchUrl(
    ebayCardQuery(detail.card.name, detail.set.name),
    env.EBAY_CAMPAIGN_ID,
  );

  return {
    detail,
    history,
    headlinePriceMinor,
    ebayUrl,
    locale,
    t: getDict(locale).cardDetail,
    c: getDict(locale).common,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, `/cards/${detail.card.slug}`)),
    appUrl: env.APP_URL,
  };
}

/** eBay wordmark in the four official brand colors (e red, b blue, a gold, y
 * green). Inline SVG — no external request, so it passes the strict img CSP and
 * stays crisp at any size. Decorative here; the link carries the localized label. */
function EbayLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 92 40" className={className} aria-hidden="true" focusable="false">
      <text
        x="0"
        y="31"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="36"
        fontWeight="900"
        fontStyle="italic"
        letterSpacing="-1.5"
      >
        <tspan fill="#E53238">e</tspan>
        <tspan fill="#0064D2">b</tspan>
        <tspan fill="#F5AF02">a</tspan>
        <tspan fill="#86B817">y</tspan>
      </text>
    </svg>
  );
}

/** Variant key → dictionary key. Values are localized in the component. */
const VARIANT_KEYS: Record<string, keyof ReturnType<typeof getDict>["cardDetail"]> = {
  normal: "variantNormal",
  holofoil: "variantHolofoil",
  reverseHolofoil: "variantReverseHolofoil",
  firstEditionNormal: "variantFirstEdition",
  firstEditionHolofoil: "variantFirstEditionHolofoil",
};

export default function CardDetail({ loaderData }: Route.ComponentProps) {
  const { detail, history, ebayUrl, appUrl, locale, t, c } = loaderData;
  const { card, set, prices, related, trackingSince } = detail;
  const lp = useLocalePath();
  const langTag = LANG_TAGS[locale];
  const money = (minor: number | null, currency: "USD" | "EUR" = "USD") =>
    formatMinor(minor, currency, langTag);
  const variantLabel = (v: string) => (VARIANT_KEYS[v] ? t[VARIANT_KEYS[v]] : v);
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
            { name: c.home, path: lp("/") },
            { name: t.breadcrumbCards, path: lp("/cards") },
            { name: set.name, path: lp(`/sets/${set.slug}`) },
            { name: card.name, path: lp(`/cards/${card.slug}`) },
          ]),
        ]}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to={lp("/")} className="hover:text-fg">
          {c.home}
        </Link>
        <span aria-hidden="true"> / </span>
        <Link to={lp("/cards")} className="hover:text-fg">
          {t.breadcrumbCards}
        </Link>
        <span aria-hidden="true"> / </span>
        <Link to={lp(`/sets/${set.slug}`)} className="hover:text-fg">
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
              {c.noImage}
            </div>
          )}
        </div>

        {/* Facts + prices */}
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-3xl font-bold text-fg">{card.name}</h1>
            <p className="text-fg-muted">
              <Link to={lp(`/sets/${set.slug}`)} className="text-accent hover:underline">
                {set.name}
              </Link>{" "}
              · #{card.number}
              {card.rarity ? ` · ${card.rarity}` : ""}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            {card.supertype ? <Fact label={t.factCardType} value={card.supertype} /> : null}
            {subtypes.length ? <Fact label={t.factSubtypes} value={subtypes.join(", ")} /> : null}
            {types.length ? <Fact label={t.factEnergyType} value={types.join(", ")} /> : null}
            {card.hp ? <Fact label={t.factHp} value={String(card.hp)} /> : null}
            {card.artist ? <Fact label={t.factArtist} value={card.artist} /> : null}
            {set.releaseDate ? <Fact label={t.factSetReleased} value={set.releaseDate} /> : null}
            {card.regulationMark ? (
              <Fact label={t.factRegulationMark} value={card.regulationMark} />
            ) : null}
          </dl>

          {/* TCGplayer prices */}
          <section
            aria-labelledby="prices-heading"
            className="rounded-(--radius-card) border border-edge bg-surface p-5"
          >
            <h2 id="prices-heading" className="mb-3 font-semibold text-fg">
              {t.pricesHeading}
            </h2>
            {tcgplayer.length === 0 ? (
              <p className="text-sm text-fg-muted">{t.pricesEmpty}</p>
            ) : (
              <div className="overflow-x-auto">
                {/* Numeric columns are right-aligned (tabular-nums) so prices line
                    up; the <th> alignment is set explicitly because the browser
                    default (text-align:center) would otherwise beat the table's
                    inherited alignment and leave headers off from their values. */}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-edge text-fg-muted">
                      <th scope="col" className="py-2 pe-4 text-start font-medium">
                        {t.colVariant}
                      </th>
                      <th scope="col" className="py-2 pe-4 text-end font-medium">
                        {t.colMarket}
                      </th>
                      <th scope="col" className="py-2 pe-4 text-end font-medium">
                        {t.colLow}
                      </th>
                      <th scope="col" className="py-2 pe-4 text-end font-medium">
                        {t.colMid}
                      </th>
                      <th scope="col" className="py-2 text-end font-medium">
                        {t.colHigh}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {tcgplayer.map((price) => (
                      <tr key={price.variant} className="border-b border-edge/50">
                        <th scope="row" className="py-2 pe-4 text-start font-medium text-fg">
                          {variantLabel(price.variant)}
                        </th>
                        <td className="py-2 pe-4 text-end font-semibold tabular-nums text-fg">
                          {money(price.normalizedPriceMinor)}
                        </td>
                        <td className="py-2 pe-4 text-end tabular-nums">{money(price.lowMinor)}</td>
                        <td className="py-2 pe-4 text-end tabular-nums">{money(price.midMinor)}</td>
                        <td className="py-2 text-end tabular-nums">{money(price.highMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-fg-faint">
              {t.sourceTcgplayer}
              {tcgplayer[0]?.sourceUpdatedAt
                ? interpolate(t.sourceUpdated, { date: tcgplayer[0].sourceUpdatedAt })
                : ""}
              .
              {trackingSince
                ? interpolate(t.trackedSince, { date: trackingSince })
                : t.trackingStarts}
              {card.tcgplayerUrl ? (
                <>
                  {" "}
                  <a
                    href={card.tcgplayerUrl}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    className="text-accent hover:underline"
                  >
                    {t.viewOnTcgplayer}
                  </a>
                </>
              ) : null}
            </p>
            {cardmarket.length > 0 ? (
              <p className="mt-2 text-xs text-fg-muted">
                {interpolate(t.cardmarketTrend, {
                  price: money(cardmarket[0].normalizedPriceMinor, "EUR"),
                })}
                {cardmarket[0].sourceUpdatedAt
                  ? interpolate(t.sourceUpdated, { date: cardmarket[0].sourceUpdatedAt })
                  : ""}
                {card.cardmarketUrl ? (
                  <>
                    {" "}
                    <a
                      href={card.cardmarketUrl}
                      rel="noopener noreferrer nofollow"
                      target="_blank"
                      className="text-accent hover:underline"
                    >
                      {t.viewOnCardmarket}
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
          </section>

          {/* CTAs */}
          <div className="flex flex-wrap gap-3">
            {ebayUrl ? (
              <a
                href={ebayUrl}
                target="_blank"
                rel="sponsored noopener"
                aria-label={t.buyOnEbay}
                title={t.buyOnEbay}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-neutral-300 bg-white px-5 py-2 shadow-sm hover:bg-neutral-50"
              >
                <EbayLogo className="h-6 w-auto" />
                <span aria-hidden className="text-lg text-neutral-500">
                  ↗
                </span>
              </a>
            ) : null}
            <fetcher.Form method="post" action="/api/v1/collection/quick-add">
              <input type="hidden" name="cardId" value={card.id} />
              <button
                type="submit"
                className="min-h-11 rounded-lg bg-accent px-5 py-2 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
              >
                {t.addToCollection}
              </button>
            </fetcher.Form>
            <fetcher.Form method="post" action="/api/v1/wishlist/quick-add">
              <input type="hidden" name="cardId" value={card.id} />
              <button
                type="submit"
                className="min-h-11 rounded-lg border border-edge bg-surface px-5 py-2 font-medium text-fg hover:bg-surface-raised"
              >
                {t.addToWishlist}
              </button>
            </fetcher.Form>
          </div>
          {fetcher.data && typeof fetcher.data === "object" && "message" in fetcher.data ? (
            <p className="text-sm text-fg-muted" role="status">
              {String((fetcher.data as { message: string }).message)}
            </p>
          ) : null}

          <p className="text-xs text-fg-faint">{t.priceDisclaimer}</p>
          {ebayUrl ? <p className="text-xs text-fg-faint">{t.ebayDisclosure}</p> : null}
        </div>
      </div>

      {/* Price history */}
      <section className="rounded-(--radius-card) border border-edge bg-surface p-5">
        {availableVariants.length > 1 ? (
          <div className="mb-3 flex gap-1" role="group" aria-label={t.historyVariantAria}>
            {availableVariants.map((variant) => (
              <button
                key={variant}
                type="button"
                onClick={() => setChartVariant(variant)}
                aria-pressed={chartVariant === variant}
                className={`min-h-9 rounded-md px-3 text-xs font-medium ${
                  chartVariant === variant
                    ? "bg-accent text-(color:--color-on-accent)"
                    : "border border-edge text-fg-muted"
                }`}
              >
                {variantLabel(variant)}
              </button>
            ))}
          </div>
        ) : null}
        <HistoryChart
          title={interpolate(t.historyTitle, { variant: variantLabel(chartVariant) })}
          points={chartPoints}
          range={range}
          onRangeChange={setRange}
          emptyMessage={t.historyEmpty}
          startNote={
            trackingSince ? interpolate(t.historyStartNote, { date: trackingSince }) : null
          }
        />
      </section>

      {/* Related cards */}
      {related.length > 0 ? (
        <section aria-labelledby="related-heading">
          <h2 id="related-heading" className="mb-4 text-xl font-bold text-fg">
            {interpolate(t.relatedHeading, { setName: set.name })}
          </h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {related.map((rel) => (
              <li key={rel.id}>
                <Link to={lp(`/cards/${rel.slug}`)} className="group flex flex-col gap-2">
                  {rel.imageSmallUrl ? (
                    <img
                      src={rel.imageSmallUrl}
                      alt={`${rel.name} card`}
                      loading="lazy"
                      className="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
                    />
                  ) : (
                    <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-xs text-fg-faint">
                      {c.noImage}
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
