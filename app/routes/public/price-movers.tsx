import { Link } from "react-router";

import type { Route } from "./+types/price-movers";
import { getCloudflare, getMarket } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { getPriceMoversBoth, type PriceMover } from "~/lib/catalog/queries.server";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { LANG_TAGS, type Locale, localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { MARKET_CURRENCY, type Currency } from "~/lib/market/market";
import { formatMinor, formatPercent } from "~/lib/money/decimal";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: data?.t.metaTitle ?? "Pokector",
    description: data?.t.metaDescription ?? "",
    canonical: data?.canonical,
    alternates: data ? { appUrl: data.appUrl, path: "/price-movers" } : undefined,
  });
}

export function headers(_args: Route.HeadersArgs) {
  // `private`: movers depend on the market cookie (US=TCGplayer/USD vs
  // EU=Cardmarket/EUR), so a URL-keyed shared cache would leak across markets.
  return { "Cache-Control": "private, max-age=600, stale-while-revalidate=7200" };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(params.locale);
  const market = getMarket(context);
  const [w7, w30] = await Promise.all([
    getPriceMoversBoth(db, 7, 10, market),
    getPriceMoversBoth(db, 30, 10, market),
  ]);
  return {
    up7: w7.up,
    down7: w7.down,
    up30: w30.up,
    down30: w30.down,
    locale,
    currency: MARKET_CURRENCY[market],
    t: getDict(locale).priceMovers,
    c: getDict(locale).common,
    appUrl: env.APP_URL,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, "/price-movers")),
  };
}

export default function PriceMovers({ loaderData }: Route.ComponentProps) {
  const { up7, down7, up30, down30, locale, currency, t } = loaderData;
  const lp = useLocalePath();
  const hasAny = up7.length + down7.length + up30.length + down30.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to={lp("/")} className="hover:text-fg">
          {loaderData.c.home}
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-fg">
          {t.breadcrumb}
        </span>
      </nav>

      <div>
        <h1 className="text-3xl font-bold text-fg">{t.heading}</h1>
        <p className="mt-2 max-w-2xl text-fg-muted">{t.intro}</p>
      </div>

      {!hasAny ? (
        <div className="rounded-(--radius-card) border border-edge bg-surface p-10 text-center">
          <p className="mb-2 text-lg font-medium text-fg">{t.emptyTitle}</p>
          <p className="mx-auto max-w-md text-sm text-fg-muted">
            {t.emptyBodyPre}
            <Link to={lp("/cards")} className="text-accent hover:underline">
              {t.emptyBodyLink}
            </Link>
            {t.emptyBodyPost}
          </p>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          <MoverSection
            title={t.gainers7}
            movers={up7}
            direction="up"
            locale={locale}
            currency={currency}
            t={t}
          />
          <MoverSection
            title={t.decliners7}
            movers={down7}
            direction="down"
            locale={locale}
            currency={currency}
            t={t}
          />
          <MoverSection
            title={t.gainers30}
            movers={up30}
            direction="up"
            locale={locale}
            currency={currency}
            t={t}
          />
          <MoverSection
            title={t.decliners30}
            movers={down30}
            direction="down"
            locale={locale}
            currency={currency}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

function MoverSection({
  title,
  movers,
  direction,
  locale,
  currency,
  t,
}: {
  title: string;
  movers: PriceMover[];
  direction: "up" | "down";
  locale: Locale;
  currency: Currency;
  t: { sectionEmpty: string };
}) {
  const langTag = LANG_TAGS[locale];
  return (
    <section
      aria-label={title}
      className="rounded-(--radius-card) border border-edge bg-surface p-5"
    >
      <h2 className="mb-4 text-lg font-semibold text-fg">{title}</h2>
      {movers.length === 0 ? (
        <p className="text-sm text-fg-muted">{t.sectionEmpty}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {movers.map((mover) => (
            <li key={`${mover.cardId}-${mover.variant}`}>
              <Link
                to={localePath(locale, `/cards/${mover.slug}`)}
                className="flex items-center gap-3 rounded-lg p-2 hover:bg-surface-raised"
              >
                {mover.imageSmallUrl ? (
                  <img
                    src={mover.imageSmallUrl}
                    alt=""
                    loading="lazy"
                    className="h-14 w-10 rounded border border-edge object-cover"
                  />
                ) : (
                  <span className="flex h-14 w-10 items-center justify-center rounded border border-edge bg-surface-raised text-xs">
                    ?
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{mover.name}</p>
                  <p className="truncate text-xs text-fg-faint">
                    {mover.setName} · {mover.variant}
                  </p>
                </div>
                <div className="text-end">
                  <p className="text-sm font-semibold text-fg">
                    {formatMinor(mover.currentMinor, currency, langTag)}
                  </p>
                  <p
                    className={`text-xs font-medium ${direction === "up" ? "text-positive" : "text-negative"}`}
                  >
                    {formatPercent(mover.changePercent)} (
                    {formatMinor(Math.abs(mover.changeMinor), currency, langTag)})
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
