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
import { GradingCalculator, type GradedValue } from "~/components/grading-calculator";
import { optionalUser } from "~/lib/auth/guards.server";
import { getUserCardState, type UserCardState } from "~/lib/collection/queries.server";
import { getCloudflare, getMarket } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import {
  bumpCardPopularity,
  getCardBySlug,
  getCardPriceHistory,
  getGradedPriceHistory,
} from "~/lib/catalog/queries.server";
import { buildEbaySearchUrl, ebayCardQuery } from "~/lib/affiliate/ebay";
import { getEbayCardPrices } from "~/lib/affiliate/ebay-api.server";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { LANG_TAGS, localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { interpolate } from "~/lib/i18n/t";
import { MARKET_CURRENCY, MARKET_SOURCE } from "~/lib/market/market";
import { formatMinor } from "~/lib/money/decimal";
import { breadcrumbJsonLd, canonicalUrl, JsonLd, pageMeta, productJsonLd } from "~/lib/seo/meta";

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
      ? interpolate(t.metaPricePart, {
          price: formatMinor(price, MARKET_CURRENCY[data.market], langTag),
        })
      : "";
  const lcpImage = card.imageLargeUrl ?? card.imageSmallUrl ?? undefined;
  return [
    ...pageMeta({
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
      image: lcpImage,
    }),
    // Preload the LCP card image so the browser fetches it as soon as the HTML
    // head is parsed, in parallel with the CSS/JS.
    ...(lcpImage
      ? [{ tagName: "link" as const, rel: "preload", as: "image", href: lcpImage, fetchPriority: "high" }]
      : []),
  ];
}

export function headers(_args: Route.HeadersArgs) {
  // `private` (not shared/edge cache): the rendered market depends on the
  // pk_market cookie, so a shared cache keyed only on the URL would leak one
  // market's prices to visitors on the other. Browsers still cache per-user.
  return { "Cache-Control": "private, max-age=300, stale-while-revalidate=3600" };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env, ctx } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(params.locale);
  const market = getMarket(context);
  const detail = await getCardBySlug(db, params.slug);
  if (!detail) {
    throw new Response("Card not found", { status: 404 });
  }

  // Popularity signal for history tracking — off the response critical path.
  ctx.waitUntil(bumpCardPopularity(db, detail.card.id).catch(() => undefined));

  // Everything below is independent of each other (only needs the card id/name),
  // so run it as a single parallel batch instead of serial round-trips: the
  // session lookup, the three price-history series, and the (cache-first, never-
  // blocking) eBay prices read.
  const [session, history, gradedHistoryPsa9, gradedHistoryPsa10, ebayPrices] = await Promise.all([
    optionalUser(context, request),
    getCardPriceHistory(db, detail.card.id, { source: MARKET_SOURCE[market] }),
    getGradedPriceHistory(db, detail.card.id, "psa9"),
    getGradedPriceHistory(db, detail.card.id, "psa10"),
    // Live eBay "from $X" prices (raw + PSA), cached in D1; a cache miss returns
    // null and refreshes in the background so the render never blocks on eBay.
    getEbayCardPrices(env, db, (p) => ctx.waitUntil(p), {
      id: detail.card.id,
      name: detail.card.name,
      setName: detail.set.name,
      number: detail.card.number,
      printedTotal: detail.set.printedTotal ?? null,
    }),
  ]);

  // Ownership/wishlist badge for signed-in users (the loader is `private`
  // cached, so this per-user state never leaks to a shared edge cache).
  const cardState: UserCardState | null = session
    ? ((await getUserCardState(db, session.user.id, [detail.card.id]))[detail.card.id] ?? {
        ownedQuantity: 0,
        variants: [],
        onWishlist: false,
      })
    : null;

  const activePrices = detail.prices.filter((p) => p.source === MARKET_SOURCE[market]);
  const headlinePriceMinor =
    activePrices.length > 0
      ? Math.max(...activePrices.map((p) => p.normalizedPriceMinor))
      : null;

  // eBay Partner Network affiliate search link (US marketplace). Null when the
  // campaign id isn't configured → the button is hidden.
  const ebayUrl = buildEbaySearchUrl(
    ebayCardQuery(detail.card.name, detail.set.name),
    env.EBAY_CAMPAIGN_ID,
  );
  const ebayPsa9Url = buildEbaySearchUrl(
    `${ebayCardQuery(detail.card.name, detail.set.name)} PSA 9`,
    env.EBAY_CAMPAIGN_ID,
  );
  const ebayPsa10Url = buildEbaySearchUrl(
    `${ebayCardQuery(detail.card.name, detail.set.name)} PSA 10`,
    env.EBAY_CAMPAIGN_ID,
  );

  return {
    detail,
    history,
    gradedHistoryPsa9,
    gradedHistoryPsa10,
    headlinePriceMinor,
    ebayUrl,
    ebayPsa9Url,
    ebayPsa10Url,
    ebayPrices,
    signedIn: session !== null,
    cardState,
    locale,
    market,
    t: getDict(locale).cardDetail,
    c: getDict(locale).common,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, `/cards/${detail.card.slug}`)),
    appUrl: env.APP_URL,
  };
}

/** Official eBay wordmark (provided by the owner). Inline SVG — no external
 * request, so it passes the strict img CSP and stays crisp at any size.
 * Decorative here; the link carries the localized label. */
function EbayLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1000 400.75098"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="#ffbc13"
        d="m 633.07803,212.53323 c -45.43873,1.48929 -73.6715,9.689 -73.6715,39.61897 0,19.37591 15.44713,40.38162 54.66334,40.38162 52.57698,0 80.64259,-28.65902 80.64259,-75.66331 l 0.003,-5.16994 c -18.43302,0 -41.16414,0.16089 -61.63704,0.83266 z m 111.75103,62.10248 c 0,14.58313 0.42155,28.9782 1.69406,41.94092 h -46.61408 c -1.24325,-10.67368 -1.6972,-21.27945 -1.6972,-31.56656 -25.20195,30.97941 -55.17735,39.88537 -96.76149,39.88537 -61.67674,0 -94.70072,-32.59982 -94.70072,-70.30689 0,-54.61215 44.91583,-73.86739 122.89013,-75.65391 21.32332,-0.48686 45.27419,-0.55894 65.07531,-0.55894 l -0.003,-5.33606 c 0,-36.56098 -23.44364,-51.59335 -64.06765,-51.59335 -30.15876,0 -52.38579,12.48057 -54.6764,34.0468 h -52.65168 c 5.57217,-53.77165 62.06643,-67.37115 111.74005,-67.37115 59.50837,0 109.77228,21.17288 109.77228,84.11481 z"
      />
      <path
        fill="#f12c2d"
        d="m 199.63633,185.86602 c -1.94427,-46.87735 -35.77951,-64.41973 -71.94139,-64.41973 -38.99421,0 -70.12667,19.7327 -75.58026,64.41973 z M 51.034408,219.1909 c 2.704332,45.48365 34.069782,72.38437 77.197532,72.38437 29.88033,0 56.45979,-12.17498 65.35948,-38.66041 h 51.68424 c -10.05205,53.73979 -67.15384,71.98058 -116.303,71.98058 C 39.606424,324.89544 0,275.67889 0,209.30653 0,136.24203 40.965642,88.12194 129.78809,88.12194 c 70.69867,0 122.49992,36.99926 122.49992,117.75572 v 13.31324 z"
      />
      <path
        fill="#0968f6"
        d="m 380.83181,290.6235 c 46.57228,0 78.44078,-33.52181 78.44078,-84.10854 0,-50.58203 -31.8685,-84.10854 -78.44078,-84.10854 -46.31058,0 -78.44392,33.52651 -78.44392,84.10854 0,50.58673 32.13334,84.10854 78.44392,84.10854 z M 252.2854,0 h 50.10249 l -0.005,125.87707 c 24.55682,-29.25975 58.38892,-37.75513 91.68976,-37.75513 55.83503,0 117.85132,37.6773 117.85132,119.02875 0,68.12232 -49.32155,117.74475 -118.78114,117.74475 -36.35726,0 -70.58062,-13.04265 -91.68663,-38.88294 0,10.32107 -0.57618,20.72364 -1.70503,30.56413 h -49.17162 c 0.85513,-15.90944 1.70555,-35.7184 1.70555,-51.74693 z"
      />
      <path
        fill="#93c822"
        d="M 1000,96.45747 845.05541,400.75099 H 788.94926 L 833.49578,316.25589 716.89033,96.45747 h 58.6266 l 85.80469,171.73057 85.56283,-171.73057 z"
      />
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
  const {
    detail,
    history,
    gradedHistoryPsa9,
    gradedHistoryPsa10,
    ebayUrl,
    ebayPsa9Url,
    ebayPsa10Url,
    ebayPrices,
    signedIn,
    cardState,
    appUrl,
    canonical,
    locale,
    market,
    t,
    c,
  } = loaderData;
  const { card, set, prices, related, trackingSince } = detail;
  const lp = useLocalePath();
  const langTag = LANG_TAGS[locale];
  const money = (minor: number | null, currency: "USD" | "EUR" = "USD") =>
    formatMinor(minor, currency, langTag);
  const variantLabel = (v: string) => (VARIANT_KEYS[v] ? t[VARIANT_KEYS[v]] : v);
  const [range, setRange] = useState<ChartRange>("MAX");
  const fetcher = useFetcher();

  // Active market: US = TCGplayer/USD (per-variant), EU = Cardmarket/EUR.
  const isEu = market === "eu";
  const marketCurrency = MARKET_CURRENCY[market];
  const tcgplayer = prices.filter((p) => p.source === "tcgplayer");
  const cardmarket = prices.filter((p) => p.source === "cardmarket");
  const activeRows = isEu ? cardmarket : tcgplayer;
  // Cardmarket publishes ONE value per card (duplicated across variants) → one row.
  const cmRow = cardmarket[0] ?? null;
  const euVariant = cmRow?.variant ?? "normal";
  const availableVariants = [...new Set(tcgplayer.map((p) => p.variant))];

  // History-chart series. US: each raw print variant. EU: a single Cardmarket
  // "Trend" series. Both add PSA 9 / PSA 10 (always USD, global graded market).
  const hasPsa9 = gradedHistoryPsa9.length > 0 || ebayPrices?.psa9 != null;
  const hasPsa10 = gradedHistoryPsa10.length > 0 || ebayPrices?.psa10 != null;
  const rawSeries = isEu
    ? cmRow
      ? [{ key: "cm-trend", label: t.colTrend }]
      : []
    : availableVariants.map((v) => ({ key: v, label: variantLabel(v) }));
  const chartSeries: { key: string; label: string }[] = [
    ...rawSeries,
    ...(hasPsa9 ? [{ key: "psa9", label: "PSA 9" }] : []),
    ...(hasPsa10 ? [{ key: "psa10", label: "PSA 10" }] : []),
  ];
  const [chartKey, setChartKey] = useState(chartSeries[0]?.key ?? "normal");

  const today = new Date().toISOString().slice(0, 10);
  const sinceDate = rangeStartDate(range);
  const isPsaChart = chartKey === "psa9" || chartKey === "psa10";
  // PSA is always USD; raw series follow the active market currency.
  const chartCurrency: "USD" | "EUR" = isPsaChart ? "USD" : marketCurrency;
  const rawHistory =
    chartKey === "psa9"
      ? gradedHistoryPsa9
      : chartKey === "psa10"
        ? gradedHistoryPsa10
        : isEu
          ? history.filter((h) => h.variant === euVariant)
          : history.filter((h) => h.variant === chartKey);
  const chartPoints: HistoryPoint[] = carryForward(
    rawHistory
      .filter((h) => !sinceDate || h.recordedDate >= sinceDate)
      .map((h) => ({ date: h.recordedDate, valueMinor: h.priceMinor })),
    today,
  );

  const types: string[] = card.typesJson ? (JSON.parse(card.typesJson) as string[]) : [];
  const subtypes: string[] = card.subtypesJson ? (JSON.parse(card.subtypesJson) as string[]) : [];

  // Grading ROI calculator inputs — always USD (the PSA graded market). Raw cost
  // basis = TCGplayer USD headline (fallback: eBay raw "from"). Graded values are
  // the PSA 9/10 medians (or lowest listing) already fetched for the price table.
  const rawUsdMinor =
    tcgplayer.length > 0
      ? Math.max(...tcgplayer.map((p) => p.normalizedPriceMinor))
      : (ebayPrices?.rawFromMinor ?? null);
  const gradedValues: GradedValue[] = [
    ebayPrices?.psa9
      ? { label: "PSA 9", valueMinor: ebayPrices.psa9.valueMinor, source: ebayPrices.psa9.source }
      : null,
    ebayPrices?.psa10
      ? {
          label: "PSA 10",
          valueMinor: ebayPrices.psa10.valueMinor,
          source: ebayPrices.psa10.source,
        }
      : null,
  ].filter((v): v is GradedValue => v !== null);
  const showGradingCalc = rawUsdMinor !== null && gradedValues.length > 0;

  // Product/AggregateOffer schema — only when the active market actually prices
  // this card (honest: no $0 offers for unpriced cards). Reflects the real
  // TCGplayer/Cardmarket estimates already on the page.
  const offerRows = activeRows.map((p) => p.normalizedPriceMinor);
  const productSchema =
    offerRows.length > 0
      ? productJsonLd({
          appUrl,
          name: `${card.name} (${set.name} ${card.number})`,
          image: card.imageLargeUrl ?? card.imageSmallUrl ?? undefined,
          brand: set.name,
          category: card.supertype ?? undefined,
          sku: card.slug,
          url: canonical,
          offers: {
            lowPriceMinor: Math.min(...offerRows),
            highPriceMinor: Math.max(...offerRows),
            currency: marketCurrency,
            offerCount: offerRows.length,
            offerUrl: ebayUrl ?? undefined,
          },
        })
      : null;

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
          ...(productSchema ? [productSchema] : []),
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
              // LCP element: reserve the card aspect box (no CLS), decode off the
              // main thread, and hint high priority so it fetches ahead of below-
              // the-fold art. Paired with a rel=preload in meta().
              width={734}
              height={1024}
              decoding="async"
              fetchPriority="high"
              className="aspect-[63/88] w-full rounded-xl border border-edge object-contain shadow-(--shadow-card)"
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
              {interpolate(t.pricesHeading, { currency: marketCurrency })}
            </h2>
            {activeRows.length === 0 ? (
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
                        {isEu ? t.colTrend : t.colMarket}
                      </th>
                      <th scope="col" className="py-2 pe-4 text-end font-medium">
                        {t.colLow}
                      </th>
                      <th scope="col" className="py-2 pe-4 text-end font-medium">
                        {isEu ? t.colAvgSell : t.colMid}
                      </th>
                      <th scope="col" className="py-2 text-end font-medium">
                        {t.colHigh}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isEu
                      ? cmRow && (
                          <tr className="border-b border-edge/50">
                            <th scope="row" className="py-2 pe-4 text-start font-medium text-fg">
                              {variantLabel(euVariant)}
                            </th>
                            <td className="py-2 pe-4 text-end font-semibold tabular-nums text-fg">
                              {money(cmRow.trendMinor ?? cmRow.normalizedPriceMinor, "EUR")}
                            </td>
                            <td className="py-2 pe-4 text-end tabular-nums">
                              {money(cmRow.lowMinor, "EUR")}
                            </td>
                            <td className="py-2 pe-4 text-end tabular-nums">
                              {money(cmRow.averageSellMinor, "EUR")}
                            </td>
                            <td className="py-2 text-end tabular-nums">{money(null, "EUR")}</td>
                          </tr>
                        )
                      : tcgplayer.map((price) => (
                          <tr key={price.variant} className="border-b border-edge/50">
                            <th scope="row" className="py-2 pe-4 text-start font-medium text-fg">
                              {variantLabel(price.variant)}
                            </th>
                            <td className="py-2 pe-4 text-end font-semibold tabular-nums text-fg">
                              {money(price.normalizedPriceMinor)}
                            </td>
                            <td className="py-2 pe-4 text-end tabular-nums">
                              {money(price.lowMinor)}
                            </td>
                            <td className="py-2 pe-4 text-end tabular-nums">
                              {money(price.midMinor)}
                            </td>
                            <td className="py-2 text-end tabular-nums">{money(price.highMinor)}</td>
                          </tr>
                        ))}
                    {(
                      [
                        ["PSA 9", ebayPrices?.psa9 ?? null, ebayPsa9Url],
                        ["PSA 10", ebayPrices?.psa10 ?? null, ebayPsa10Url],
                      ] as const
                    ).map(([label, stat, url]) =>
                      stat != null ? (
                        <tr key={label} className="border-b border-edge/50">
                          <th scope="row" className="py-2 pe-4 text-start font-medium text-fg">
                            {url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="sponsored noopener"
                                className="hover:text-accent"
                              >
                                {label} ↗
                              </a>
                            ) : (
                              label
                            )}
                            {stat.sampleSize ? (
                              <span className="ms-1.5 text-xs font-normal text-fg-faint">
                                {interpolate(
                                  stat.source === "sold" ? t.psaSampleCount : t.psaSampleListings,
                                  { count: stat.sampleSize },
                                )}
                              </span>
                            ) : null}
                          </th>
                          <td className="py-2 pe-4 text-end font-semibold tabular-nums text-fg">
                            {money(stat.valueMinor)}
                          </td>
                          <td className="py-2 pe-4 text-end tabular-nums">{money(stat.lowMinor)}</td>
                          <td className="py-2 pe-4 text-end tabular-nums">{money(null)}</td>
                          <td className="py-2 text-end tabular-nums">{money(stat.highMinor)}</td>
                        </tr>
                      ) : null,
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {ebayPrices?.psa9 != null || ebayPrices?.psa10 != null ? (
              <p className="mt-2 text-xs text-fg-faint">
                {ebayPrices?.psa9?.source === "sold" || ebayPrices?.psa10?.source === "sold"
                  ? t.psaSoldMedian
                  : t.psaFromEbay}
                {isEu ? ` ${t.psaGlobalUsdNote}` : ""}
              </p>
            ) : null}
            {/* Primary source attribution (active market) + tracking note. */}
            <p className="mt-3 text-xs text-fg-faint">
              {isEu ? t.sourceCardmarket : t.sourceTcgplayer}
              {(isEu ? cmRow?.sourceUpdatedAt : tcgplayer[0]?.sourceUpdatedAt)
                ? interpolate(t.sourceUpdated, {
                    date: (isEu ? cmRow?.sourceUpdatedAt : tcgplayer[0]?.sourceUpdatedAt) as string,
                  })
                : ""}
              .
              {trackingSince
                ? interpolate(t.trackedSince, { date: trackingSince })
                : t.trackingStarts}
              {(isEu ? card.cardmarketUrl : card.tcgplayerUrl) ? (
                <>
                  {" "}
                  <a
                    href={(isEu ? card.cardmarketUrl : card.tcgplayerUrl) as string}
                    rel="noopener noreferrer nofollow"
                    target="_blank"
                    className="text-accent hover:underline"
                  >
                    {isEu ? t.viewOnCardmarket : t.viewOnTcgplayer}
                  </a>
                </>
              ) : null}
            </p>
            {/* Secondary cross-market reference (the other market's headline). */}
            {isEu
              ? tcgplayer.length > 0 && (
                  <p className="mt-2 text-xs text-fg-muted">
                    {interpolate(t.tcgplayerPrice, {
                      price: money(
                        Math.max(...tcgplayer.map((p) => p.normalizedPriceMinor)),
                        "USD",
                      ),
                    })}
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
                )
              : cardmarket.length > 0 && (
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
                )}
          </section>

          {/* Ownership badges for signed-in users (never rendered anonymously). */}
          {cardState && (cardState.ownedQuantity > 0 || cardState.onWishlist) ? (
            <div className="flex flex-wrap items-center gap-2" role="status">
              {cardState.ownedQuantity > 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-positive/15 px-3 py-1 text-sm font-medium text-positive">
                  ✓{" "}
                  {interpolate(t.ownedBadge, { count: cardState.ownedQuantity })}
                  {cardState.variants.length
                    ? interpolate(t.ownedVariants, {
                        variants: cardState.variants.map(variantLabel).join(", "),
                      })
                    : ""}
                </span>
              ) : null}
              {cardState.onWishlist ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent-strong">
                  ♥ {t.onWishlistBadge}
                </span>
              ) : null}
              <Link
                to="/app/collection"
                className="text-sm font-medium text-accent hover:underline"
              >
                {t.manageInCollection}
              </Link>
            </div>
          ) : null}

          {/* Add to collection / wishlist — directly under the market prices table */}
          <div className="flex flex-wrap gap-3">
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
            <Link
              to={`${lp("/cards/compare")}?ids=${card.slug}`}
              className="inline-flex min-h-11 items-center rounded-lg border border-edge bg-surface px-5 py-2 font-medium text-fg hover:bg-surface-raised"
            >
              {t.compareCard}
            </Link>
          </div>
          {fetcher.data && typeof fetcher.data === "object" && "message" in fetcher.data ? (
            <p className="text-sm text-fg-muted" role="status">
              {String((fetcher.data as { message: string }).message)}
            </p>
          ) : null}
          {!signedIn ? <p className="text-xs text-fg-faint">{t.addRequiresAccount}</p> : null}

          {/* Get this card — three eBay buy options (Raw / PSA 9 / PSA 10) */}
          {ebayUrl ? (
            <div className="flex flex-col gap-3 rounded-(--radius-card) border border-edge bg-surface p-5">
              <h2 className="font-semibold text-fg">{t.getThisCard}</h2>
              <div className="flex flex-col gap-2">
                {(
                  [
                    ["Raw", ebayUrl, ebayPrices?.rawFromMinor ?? null],
                    ["PSA 9", ebayPsa9Url, ebayPrices?.psa9FromMinor ?? null],
                    ["PSA 10", ebayPsa10Url, ebayPrices?.psa10FromMinor ?? null],
                  ] as const
                ).map(([label, url, minor]) =>
                  url ? (
                    <a
                      key={label}
                      href={url}
                      target="_blank"
                      rel="sponsored noopener"
                      aria-label={`${t.buyOnEbay} — ${label}`}
                      className="flex min-h-14 items-center justify-between gap-3 rounded-xl border-2 border-accent bg-white px-4 py-3 shadow-sm transition hover:bg-neutral-50"
                    >
                      <span className="flex items-center gap-2.5">
                        <EbayLogo className="h-6 w-auto" />
                        <span className="font-semibold text-neutral-800">{t.buyOnEbay}</span>
                        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">
                          {label}
                        </span>
                      </span>
                      {minor != null ? (
                        <span className="text-lg font-bold tabular-nums text-neutral-900">
                          {interpolate(t.buyFrom, { price: money(minor) })}
                        </span>
                      ) : (
                        <span aria-hidden className="text-xl text-neutral-500">
                          ↗
                        </span>
                      )}
                    </a>
                  ) : null,
                )}
              </div>
              <p className="text-xs text-fg-faint">{t.ebayDisclosure}</p>
            </div>
          ) : null}

          {showGradingCalc && rawUsdMinor !== null ? (
            <GradingCalculator
              rawMinor={rawUsdMinor}
              grades={gradedValues}
              langTag={langTag}
              labels={{
                heading: t.gradingHeading,
                tierLabel: t.gradingTierLabel,
                tierValue: t.gradingTierValue,
                tierRegular: t.gradingTierRegular,
                tierExpress: t.gradingTierExpress,
                rawCostLabel: t.gradingRawCostLabel,
                colGrade: t.gradingColGrade,
                colGradedValue: t.gradingColGradedValue,
                colAllIn: t.gradingColAllIn,
                colNet: t.gradingColNet,
                colRoi: t.gradingColRoi,
                worthIt: t.gradingWorthIt,
                notWorth: t.gradingNotWorth,
                soldNote: t.gradingSoldNote,
                listingDisclaimer: t.gradingListingDisclaimer,
                feeNote: t.gradingFeeNote,
              }}
            />
          ) : null}

          <p className="text-xs text-fg-faint">{t.priceDisclaimer}</p>
        </div>
      </div>

      {/* Price history */}
      <section className="rounded-(--radius-card) border border-edge bg-surface p-5">
        {chartSeries.length > 1 ? (
          <div className="mb-3 flex flex-wrap gap-1" role="group" aria-label={t.historyVariantAria}>
            {chartSeries.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setChartKey(s.key)}
                aria-pressed={chartKey === s.key}
                className={`min-h-9 rounded-md px-3 text-xs font-medium ${
                  chartKey === s.key
                    ? "bg-accent text-(color:--color-on-accent)"
                    : "border border-edge text-fg-muted"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        ) : null}
        <HistoryChart
          title={interpolate(t.historyTitle, {
            variant: chartSeries.find((s) => s.key === chartKey)?.label ?? "",
          })}
          points={chartPoints}
          currency={chartCurrency}
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
