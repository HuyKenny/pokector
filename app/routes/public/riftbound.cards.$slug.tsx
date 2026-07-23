import { useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/riftbound.cards.$slug";
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
  if (!data) return pageMeta({ title: "Riftbound card | Pokector", description: "" });
  const { card, set } = data;
  return pageMeta({
    title: `${card.name} — ${set.name} #${card.number} | Riftbound | Pokector`,
    description: `Riftbound ${card.name} (${set.name} #${card.number}) — live market price and history.`,
    canonical: data.canonical,
    alternates: { appUrl: data.appUrl, path: `/riftbound/cards/${card.slug}` },
    image: card.imageLargeUrl ?? card.imageSmallUrl ?? undefined,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(params.locale);
  const detail = await getRiftboundCardBySlug(db, params.slug);
  if (!detail) throw new Response("Card not found", { status: 404 });
  const history = await getRiftboundPriceHistory(db, detail.card.id);
  const usd = detail.prices.filter((p) => p.currency === "USD");
  const headlineMinor = usd.length > 0 ? Math.min(...usd.map((p) => p.normalizedPriceMinor)) : null;
  const ebayUrl = buildEbaySearchUrl(
    [detail.card.name, detail.set.name, "Riftbound"].join(" "),
    env.EBAY_CAMPAIGN_ID,
  );
  return {
    card: detail.card,
    set: detail.set,
    prices: usd,
    related: detail.related,
    history: history.map((h) => ({ date: h.recordedDate, valueMinor: h.priceMinor })),
    headlineMinor,
    ebayUrl,
    locale,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, `/riftbound/cards/${detail.card.slug}`)),
    appUrl: env.APP_URL,
  };
}

export default function RiftboundCardDetail({ loaderData }: Route.ComponentProps) {
  const { card, set, prices, related, history, headlineMinor, ebayUrl } = loaderData;
  const lp = useLocalePath();
  const [range, setRange] = useState<ChartRange>("MAX");
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
          {(card.imageLargeUrl ?? card.imageSmallUrl) ? (
            <img
              src={card.imageLargeUrl ?? card.imageSmallUrl ?? undefined}
              alt={`${card.name} — ${set.name} #${card.number}`}
              width={734}
              height={1024}
              decoding="async"
              fetchPriority="high"
              className="aspect-[63/88] w-full rounded-xl border border-edge object-contain shadow-(--shadow-card)"
            />
          ) : (
            <div className="flex aspect-[63/88] items-center justify-center rounded-xl border border-edge bg-surface-raised text-fg-faint">
              No image
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <h1 className="text-2xl font-bold text-fg">{card.name}</h1>
            <p className="text-sm text-fg-muted">
              {set.name} · #{card.number}
              {card.rarity ? ` · ${card.rarity}` : ""}
            </p>
          </div>

          <div className="rounded-(--radius-card) border border-edge bg-surface p-4">
            <p className="text-xs uppercase tracking-wide text-fg-muted">Market price (USD)</p>
            <p className="text-3xl font-bold text-fg">
              {headlineMinor !== null ? formatMinor(headlineMinor, "USD") : "—"}
            </p>
            {prices.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1 text-sm text-fg-muted">
                {prices.map((p) => (
                  <li key={`${p.source}-${p.variant}-${p.currency}`}>
                    {p.variant}: {formatMinor(p.normalizedPriceMinor, "USD")}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-xs text-fg-faint">
              Prices from JustTCG (TCGplayer aggregate), shown in USD.
            </p>
          </div>

          {ebayUrl ? (
            <a
              href={ebayUrl}
              target="_blank"
              rel="sponsored noopener"
              className="inline-flex w-fit rounded-xl bg-accent px-6 py-3 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
            >
              Buy on eBay ↗
            </a>
          ) : null}
        </div>
      </div>

      <section aria-label="Price history">
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
        <section aria-label="More from this set" className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-fg">More from {set.name}</h2>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {related.map((r) => (
              <li key={r.id}>
                <Link to={lp(`/riftbound/cards/${r.slug}`)} className="group flex flex-col gap-1">
                  {r.imageSmallUrl ? (
                    <img
                      src={r.imageSmallUrl}
                      alt={r.name}
                      loading="lazy"
                      className="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
                    />
                  ) : null}
                  <span className="truncate text-xs text-fg-muted">{r.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
