import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useNavigate } from "react-router";

import type { Route } from "./+types/cards.compare";
import {
  MultiHistoryChart,
  type CompareSeries,
} from "~/components/multi-history-chart";
import { type ChartRange } from "~/components/history-chart";
import {
  getCardPriceHistory,
  getCardsBriefBySlugs,
} from "~/lib/catalog/queries.server";
import { getCloudflare, getMarket } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { interpolate } from "~/lib/i18n/t";
import { MARKET_CURRENCY, MARKET_SOURCE } from "~/lib/market/market";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";
import type { SuggestItem } from "~/routes/api/v1.cards.suggest";

const MAX_COMPARE = 3;

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: data?.t.metaTitle ?? "Pokector",
    description: data?.t.metaDescription ?? "",
    canonical: data?.canonical,
    // Parameterized (?ids=) selection — not indexed.
    noindex: true,
  });
}

export function headers(_args: Route.HeadersArgs) {
  // Depends on the pk_market cookie (US vs EU series) → `private`, like the card
  // page, so a URL-keyed shared cache can't serve one market's series to both.
  return { "Cache-Control": "private, max-age=300, stale-while-revalidate=3600" };
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(params.locale);
  const market = getMarket(context);
  const url = new URL(request.url);
  const slugs = (url.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_COMPARE);

  const briefs = await getCardsBriefBySlugs(db, slugs);
  const source = MARKET_SOURCE[market];
  const series: (CompareSeries & { slug: string })[] = await Promise.all(
    briefs.map(async (b) => {
      const history = await getCardPriceHistory(db, b.id, { source });
      // Collapse per-variant rows into one line per card: the highest recorded
      // value on each day (the card's headline market price).
      const byDate = new Map<string, number>();
      for (const h of history) {
        byDate.set(h.recordedDate, Math.max(byDate.get(h.recordedDate) ?? 0, h.priceMinor));
      }
      const points = [...byDate.entries()]
        .map(([date, valueMinor]) => ({ date, valueMinor }))
        .sort((a, z) => a.date.localeCompare(z.date));
      return { slug: b.slug, label: `${b.name} · ${b.setName} #${b.number}`, points };
    }),
  );

  return {
    briefs,
    series,
    currency: MARKET_CURRENCY[market],
    locale,
    t: getDict(locale).compare,
    c: getDict(locale).common,
    appUrl: env.APP_URL,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, "/cards/compare")),
  };
}

export default function CompareCards({ loaderData }: Route.ComponentProps) {
  const { briefs, series, currency, t, c } = loaderData;
  const lp = useLocalePath();
  const navigate = useNavigate();
  const [range, setRange] = useState<ChartRange>("MAX");
  const slugs = briefs.map((b) => b.slug);

  function withSlugs(next: string[]) {
    const qs = next.length ? `?ids=${next.join(",")}` : "";
    void navigate(`${lp("/cards/compare")}${qs}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to={lp("/")} className="hover:text-fg">
          {c.home}
        </Link>
        <span aria-hidden="true"> / </span>
        <Link to={lp("/cards")} className="hover:text-fg">
          {t.breadcrumb}
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-fg">
          {t.heading}
        </span>
      </nav>

      <div>
        <h1 className="text-3xl font-bold text-fg">{t.heading}</h1>
        <p className="mt-1 text-fg-muted">{t.intro}</p>
      </div>

      {/* Selected cards + remove */}
      {briefs.length > 0 ? (
        <ul className="flex flex-wrap gap-3">
          {briefs.map((b) => (
            <li
              key={b.slug}
              className="flex items-center gap-2 rounded-lg border border-edge bg-surface p-2 pe-3"
            >
              {b.imageSmallUrl ? (
                <img
                  src={b.imageSmallUrl}
                  alt=""
                  loading="lazy"
                  className="h-12 w-9 rounded border border-edge object-cover"
                />
              ) : null}
              <span className="min-w-0">
                <Link
                  to={lp(`/cards/${b.slug}`)}
                  className="block truncate text-sm font-medium text-fg hover:text-accent"
                >
                  {b.name}
                </Link>
                <span className="block truncate text-xs text-fg-faint">
                  {b.setName} · #{b.number}
                </span>
              </span>
              <button
                type="button"
                onClick={() => withSlugs(slugs.filter((s) => s !== b.slug))}
                aria-label={interpolate(t.remove, { name: b.name })}
                className="ms-1 rounded-full px-2 py-0.5 text-fg-faint hover:bg-surface-raised hover:text-negative"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Picker */}
      {briefs.length < MAX_COMPARE ? (
        <ComparePicker
          label={briefs.length === 0 ? t.addLabel : t.addAnother}
          placeholder={t.addPlaceholder}
          noResults={t.searchNoResults}
          excludeSlugs={slugs}
          onPick={(slug) => withSlugs([...slugs, slug])}
        />
      ) : (
        <p className="text-sm text-fg-muted">{t.full}</p>
      )}

      {/* Chart */}
      {briefs.length === 0 ? (
        <div className="flex h-56 items-center justify-center rounded-(--radius-card) border border-edge bg-surface text-sm text-fg-muted">
          {t.empty}
        </div>
      ) : (
        <section className="rounded-(--radius-card) border border-edge bg-surface p-5">
          <MultiHistoryChart
            series={series}
            currency={currency}
            range={range}
            onRangeChange={setRange}
            labels={{
              rangeAria: t.rangeAria,
              showTable: t.showTable,
              hideTable: t.hideTable,
              dateColumn: t.dateColumn,
              empty: t.chartEmpty,
            }}
          />
        </section>
      )}
    </div>
  );
}

/** Compact typeahead that adds a card to the comparison (reuses the public
 * suggest endpoint). On pick it calls onPick with the card's slug. */
function ComparePicker({
  label,
  placeholder,
  noResults,
  excludeSlugs,
  onPick,
}: {
  label: string;
  placeholder: string;
  noResults: string;
  excludeSlugs: string[];
  onPick: (slug: string) => void;
}) {
  const fetcher = useFetcher<{ items: SuggestItem[] }>();
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const items = (fetcher.data?.items ?? []).filter((i) => !excludeSlugs.includes(i.slug));

  useEffect(() => () => void (debounce.current && clearTimeout(debounce.current)), []);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function onChange(v: string) {
    setValue(v);
    if (debounce.current) clearTimeout(debounce.current);
    if (v.trim().length >= 2) {
      setOpen(true);
      debounce.current = setTimeout(() => {
        void fetcher.load(`/api/v1/cards/suggest?q=${encodeURIComponent(v.trim())}`);
      }, 250);
    } else {
      setOpen(false);
    }
  }

  function pick(slug: string) {
    setValue("");
    setOpen(false);
    onPick(slug);
  }

  return (
    <div ref={rootRef} className="relative max-w-md">
      <label htmlFor="compare-add" className="mb-1 block text-sm font-medium text-fg">
        {label}
      </label>
      <input
        id="compare-add"
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="compare-add-list"
        aria-autocomplete="list"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => value.trim().length >= 2 && setOpen(true)}
        className="min-h-11 w-full rounded-lg border border-edge bg-surface px-3 text-fg placeholder:text-fg-faint"
      />
      {open && value.trim().length >= 2 ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-edge bg-surface shadow-(--shadow-card)">
          {items.length > 0 ? (
            <ul id="compare-add-list" role="listbox" className="max-h-80 overflow-auto py-1">
              {items.map((it) => (
                <li key={it.slug} role="option" aria-selected="false">
                  <button
                    type="button"
                    onClick={() => pick(it.slug)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-surface-raised"
                  >
                    {it.imageSmallUrl ? (
                      <img
                        src={it.imageSmallUrl}
                        alt=""
                        loading="lazy"
                        className="h-10 w-8 shrink-0 rounded border border-edge object-cover"
                      />
                    ) : (
                      <span className="h-10 w-8 shrink-0 rounded border border-edge bg-surface-raised" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">{it.name}</span>
                      <span className="block truncate text-xs text-fg-faint">
                        {it.setName} · #{it.number}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : fetcher.state === "idle" ? (
            <p className="p-3 text-sm text-fg-muted">{noResults}</p>
          ) : (
            <div className="p-3">
              <div className="skeleton h-10 w-full" aria-hidden="true" />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
