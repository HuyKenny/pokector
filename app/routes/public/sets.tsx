import { Form, Link, useSearchParams } from "react-router";

import type { Route } from "./+types/sets";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { listSets } from "~/lib/catalog/queries.server";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { interpolate } from "~/lib/i18n/t";
import { canonicalUrl, collectionPageJsonLd, JsonLd, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  const page = data?.result.page ?? 1;
  const suffix = data && page > 1 ? interpolate(data.t.metaTitleSuffix, { page }) : "";
  return pageMeta({
    title: data ? interpolate(data.t.metaTitle, { suffix }) : "Pokector",
    description: data?.t.metaDescription ?? "",
    canonical: data?.canonical,
    noindex: Boolean(data?.filtered),
    // hreflang only on page 1 — deeper pages self-canonicalize to their ?page=N.
    alternates: data && page === 1 ? { appUrl: data.appUrl, path: "/sets" } : undefined,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };
}

export async function loader({ params: routeParams, request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const locale = resolveLocale(routeParams.locale);
  const url = new URL(request.url);
  const params = {
    series: url.searchParams.get("series") ?? undefined,
    sort: (url.searchParams.get("sort") as "release" | "name" | "cards" | null) ?? undefined,
    page: Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  };
  const db = createDb(env.DB);
  const result = await listSets(db, params);
  return {
    result,
    filtered: Boolean(params.series || params.sort),
    locale,
    t: getDict(locale).sets,
    c: getDict(locale).common,
    appUrl: env.APP_URL,
    // Self-referential canonical INCLUDING ?page=N for deep pages (page 1 stays
    // param-less) so page 2+ no longer canonicalize to page 1.
    canonical:
      params.page > 1
        ? `${canonicalUrl(env.APP_URL, localePath(locale, "/sets"))}?page=${params.page}`
        : canonicalUrl(env.APP_URL, localePath(locale, "/sets")),
  };
}

export default function Sets({ loaderData }: Route.ComponentProps) {
  const { result, appUrl, t, c } = loaderData;
  const [searchParams] = useSearchParams();
  const lp = useLocalePath();

  function pageLink(page: number): string {
    const next = new URLSearchParams(searchParams);
    if (page <= 1) next.delete("page");
    else next.set("page", String(page));
    const qs = next.toString();
    return qs ? `${lp("/sets")}?${qs}` : lp("/sets");
  }

  return (
    <div className="flex flex-col gap-6">
      <JsonLd
        data={collectionPageJsonLd(appUrl, {
          name: t.collectionName,
          description: t.collectionDescription,
          path: lp("/sets"),
          items: result.items
            .slice(0, 10)
            .map((set) => ({ name: set.name, path: lp(`/sets/${set.slug}`) })),
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

      <Form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="series" className="text-sm font-medium text-fg">
            {t.seriesLabel}
          </label>
          <select
            id="series"
            name="series"
            defaultValue={searchParams.get("series") ?? ""}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="">{t.seriesAll}</option>
            {result.seriesOptions.map((series) => (
              <option key={series} value={series}>
                {series}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sort" className="text-sm font-medium text-fg">
            {t.sortLabel}
          </label>
          <select
            id="sort"
            name="sort"
            defaultValue={searchParams.get("sort") ?? "release"}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="release">{t.sortRelease}</option>
            <option value="name">{t.sortName}</option>
            <option value="cards">{t.sortCards}</option>
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
        {interpolate(t.resultCount, {
          count: result.total,
          page: result.page,
          pageCount: result.pageCount,
        })}
      </p>

      {result.items.length === 0 ? (
        <div className="rounded-(--radius-card) border border-edge bg-surface p-10 text-center text-fg-muted">
          {t.empty}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((set) => (
            <li key={set.id}>
              <Link
                to={lp(`/sets/${set.slug}`)}
                className="flex h-full items-center gap-4 rounded-(--radius-card) border border-edge bg-surface p-4 hover:border-accent"
              >
                {set.symbolUrl ? (
                  <img
                    src={set.symbolUrl}
                    alt=""
                    loading="lazy"
                    className="h-10 w-10 object-contain"
                  />
                ) : (
                  <span aria-hidden="true" className="text-2xl">
                    🃏
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate font-semibold text-fg">{set.name}</p>
                  <p className="truncate text-sm text-fg-muted">{set.series}</p>
                  <p className="text-xs text-fg-faint">
                    {set.releaseDate ?? t.unknownRelease} ·{" "}
                    {interpolate(t.cardsCount, { count: set.total ?? "?" })}
                    {set.printedTotal && set.total && set.printedTotal !== set.total
                      ? interpolate(t.printedSuffix, { count: set.printedTotal })
                      : ""}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {result.pageCount > 1 ? (
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
