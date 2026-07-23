import { useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/riftbound.cards.$slug";
import { CardImage } from "~/components/card-image";
import { carryForward, HistoryChart, rangeStartDate, type ChartRange } from "~/components/history-chart";
import { buildEbaySearchUrl } from "~/lib/affiliate/ebay";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { formatMinor } from "~/lib/money/decimal";
import { getRiftboundCardBySlug, getRiftboundPriceHistory } from "~/lib/riftbound/queries.server";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data)
    return pageMeta({ title: "Riftbound card | Pokector", description: "", noindex: true });
  const { card, set } = data;
  return pageMeta({
    title: `${card.name} — Riftbound ${set.name} Card Price | Pokector`,
    description: `Riftbound ${card.name} (${set.name} #${card.number}) — live TCGplayer market price, low/mid/high estimates and full price history.`,
    canonical: data.canonical,
    // EN-only page — no hreflang (content isn't translated).
    image: card.imageLargeUrl ?? card.imageSmallUrl ?? undefined,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(undefined); // EN-only route (no :locale param)
  const detail = await getRiftboundCardBySlug(db, params.slug);
  if (!detail) throw new Response("Card not found", { status: 404 });
  const history = await getRiftboundPriceHistory(db, detail.card.id);
  const usd = detail.prices.filter((p) => p.currency === "USD");
  const headlineMinor = usd.length > 0 ? Math.min(...usd.map((p) => p.normalizedPriceMinor)) : null;
  // eBay affiliate search (Raw + PSA), same pattern as the Pokémon detail.
  const ebayQuery = [detail.card.name, detail.set.name, "Riftbound"].join(" ");
  const ebayUrl = buildEbaySearchUrl(ebayQuery, env.EBAY_CAMPAIGN_ID);
  const ebayPsa9Url = buildEbaySearchUrl(`${ebayQuery} PSA 9`, env.EBAY_CAMPAIGN_ID);
  const ebayPsa10Url = buildEbaySearchUrl(`${ebayQuery} PSA 10`, env.EBAY_CAMPAIGN_ID);
  const tcgplayerUrl = detail.card.tcgplayerId
    ? `https://www.tcgplayer.com/product/${detail.card.tcgplayerId}`
    : null;
  return {
    card: detail.card,
    set: detail.set,
    prices: usd,
    related: detail.related,
    history: history.map((h) => ({ date: h.recordedDate, valueMinor: h.priceMinor })),
    headlineMinor,
    ebayUrl,
    ebayPsa9Url,
    ebayPsa10Url,
    tcgplayerUrl,
    locale,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, `/riftbound/cards/${detail.card.slug}`)),
    appUrl: env.APP_URL,
  };
}

/** Printing slug → display label ("normal" → "Normal"). */
function variantLabel(variant: string): string {
  return variant.charAt(0).toUpperCase() + variant.slice(1);
}

function money(minor: number | null | undefined): string {
  return minor == null ? "—" : formatMinor(minor, "USD");
}

export default function RiftboundCardDetail({ loaderData }: Route.ComponentProps) {
  const { card, set, prices, related, history, ebayUrl, ebayPsa9Url, ebayPsa10Url, tcgplayerUrl } =
    loaderData;
  const lp = useLocalePath();
  const [range, setRange] = useState<ChartRange>("MAX");
  const [heroFailed, setHeroFailed] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const sinceDate = rangeStartDate(range);
  const points = carryForward(
    history.filter((p) => !sinceDate || p.date >= sinceDate),
    today,
  );

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to={lp("/riftbound/cards")} className="hover:text-fg">
          Riftbound
        </Link>{" "}
        / <span className="text-fg">{card.name}</span>
      </nav>

      <div className="grid gap-8 md:grid-cols-[minmax(240px,320px)_1fr]">
        <div>
          {!heroFailed && (card.imageLargeUrl ?? card.imageSmallUrl) ? (
            <img
              src={card.imageLargeUrl ?? card.imageSmallUrl ?? undefined}
              alt={`${card.name} — ${set.name} #${card.number}`}
              width={734}
              height={1024}
              decoding="async"
              fetchPriority="high"
              onError={() => setHeroFailed(true)}
              className="aspect-[63/88] w-full rounded-xl border border-edge object-contain shadow-(--shadow-card)"
            />
          ) : (
            <div className="flex aspect-[63/88] items-center justify-center rounded-xl border border-edge bg-surface-raised text-fg-faint">
              No image
            </div>
          )}
        </div>

        {/* Facts + prices */}
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-3xl font-bold text-fg">{card.name}</h1>
            <p className="text-fg-muted">
              <Link to={lp(`/riftbound/sets/${set.slug}`)} className="text-accent hover:underline">
                {set.name}
              </Link>{" "}
              · #{card.number}
              {card.rarity ? ` · ${card.rarity}` : ""}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <Fact label="Game" value="Riftbound (League of Legends TCG)" />
            {card.rarity ? <Fact label="Rarity" value={card.rarity} /> : null}
            {set.releaseDate ? <Fact label="Set released" value={set.releaseDate} /> : null}
          </dl>

          {/* Prices */}
          <section
            aria-labelledby="prices-heading"
            className="rounded-(--radius-card) border border-edge bg-surface p-5"
          >
            <h2 id="prices-heading" className="mb-3 font-semibold text-fg">
              Current market prices (USD)
            </h2>
            {prices.length === 0 ? (
              <p className="text-sm text-fg-muted">No price data yet for this card.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-edge text-fg-muted">
                      <th scope="col" className="py-2 pe-4 text-start font-medium">
                        Variant
                      </th>
                      <th scope="col" className="py-2 pe-4 text-end font-medium">
                        Market est.
                      </th>
                      <th scope="col" className="py-2 pe-4 text-end font-medium">
                        Low
                      </th>
                      <th scope="col" className="py-2 pe-4 text-end font-medium">
                        Mid
                      </th>
                      <th scope="col" className="py-2 text-end font-medium">
                        High
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {prices.map((price) => (
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
              Source: JustTCG (TCGplayer price aggregate), shown in USD.
              {tcgplayerUrl ? (
                <>
                  {" "}
                  <a
                    href={tcgplayerUrl}
                    target="_blank"
                    rel="sponsored noopener"
                    className="text-accent hover:underline"
                  >
                    View on TCGplayer ↗
                  </a>
                </>
              ) : null}
            </p>
          </section>

          {/* Get this card — three eBay buy options (Raw / PSA 9 / PSA 10) */}
          {ebayUrl ? (
            <div className="flex flex-col gap-3 rounded-(--radius-card) border border-edge bg-surface p-5">
              <h2 className="font-semibold text-fg">Get this card</h2>
              <div className="flex flex-col gap-2">
                {(
                  [
                    ["Raw", ebayUrl],
                    ["PSA 9", ebayPsa9Url],
                    ["PSA 10", ebayPsa10Url],
                  ] as const
                ).map(([label, url]) =>
                  url ? (
                    <a
                      key={label}
                      href={url}
                      target="_blank"
                      rel="sponsored noopener"
                      aria-label={`Buy on eBay — ${label}`}
                      className="flex min-h-14 items-center justify-between gap-3 rounded-xl border-2 border-accent bg-white px-4 py-3 shadow-sm transition hover:bg-neutral-50"
                    >
                      <span className="flex items-center gap-2.5">
                        <EbayLogo className="h-6 w-auto" />
                        <span className="font-semibold text-neutral-800">Buy on eBay</span>
                        <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">
                          {label}
                        </span>
                      </span>
                      <span aria-hidden className="text-xl text-neutral-500">
                        ↗
                      </span>
                    </a>
                  ) : null,
                )}
              </div>
              <p className="text-xs text-fg-faint">
                &ldquo;Buy on eBay&rdquo; is an affiliate link — Pokector may earn a commission from
                qualifying purchases, at no extra cost to you.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <section aria-label="Price history" className="rounded-(--radius-card) border border-edge bg-surface p-5">
        <HistoryChart
          title="Price history"
          points={points}
          currency="USD"
          range={range}
          onRangeChange={setRange}
          emptyMessage="No price history yet — tracking begins once this card is observed."
        />
      </section>

      {related.length > 0 ? (
        <section aria-labelledby="related-heading">
          <h2 id="related-heading" className="mb-4 text-xl font-bold text-fg">
            More Riftbound {set.name} cards
          </h2>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-8">
            {related.map((r) => (
              <li key={r.id}>
                <Link to={lp(`/riftbound/cards/${r.slug}`)} className="group flex flex-col gap-2">
                  <CardImage
                    src={r.imageSmallUrl}
                    alt={`${r.name} card`}
                    imgClassName="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
                    fallbackClassName="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-xs text-fg-faint"
                  />
                  <span className="truncate text-xs font-medium text-fg">{r.name}</span>
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
      <dt className="text-fg-muted">{label}</dt>
      <dd className="font-medium text-fg">{value}</dd>
    </div>
  );
}

/** eBay wordmark (inline SVG — CSP allows no external images). */
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
