import { Form, Link, useSearchParams } from "react-router";

import type { Route } from "./+types/sets";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { listSets } from "~/lib/catalog/queries.server";
import { canonicalUrl, collectionPageJsonLd, JsonLd, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  const page = data?.result.page ?? 1;
  return pageMeta({
    title: `Pokémon TCG Sets${page > 1 ? ` — Page ${page}` : ""} | Pokector`,
    description:
      "All English Pokémon TCG expansions with release dates, card counts, and set symbols — from Base Set to the newest series.",
    canonical: data?.canonical,
    noindex: Boolean(data?.filtered),
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
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
    appUrl: env.APP_URL,
    canonical: canonicalUrl(env.APP_URL, "/sets"),
  };
}

export default function Sets({ loaderData }: Route.ComponentProps) {
  const { result, appUrl } = loaderData;
  const [searchParams] = useSearchParams();

  function pageLink(page: number): string {
    const next = new URLSearchParams(searchParams);
    if (page <= 1) next.delete("page");
    else next.set("page", String(page));
    const qs = next.toString();
    return qs ? `/sets?${qs}` : "/sets";
  }

  return (
    <div className="flex flex-col gap-6">
      <JsonLd
        data={collectionPageJsonLd(appUrl, {
          name: "Pokémon TCG Sets",
          description: "All English Pokémon TCG expansions.",
          path: "/sets",
          items: result.items
            .slice(0, 10)
            .map((set) => ({ name: set.name, path: `/sets/${set.slug}` })),
        })}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to="/" className="hover:text-fg">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-fg">
          Sets
        </span>
      </nav>

      <h1 className="text-3xl font-bold text-fg">Pokémon TCG sets</h1>

      <Form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="series" className="text-sm font-medium text-fg">
            Series
          </label>
          <select
            id="series"
            name="series"
            defaultValue={searchParams.get("series") ?? ""}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="">All series</option>
            {result.seriesOptions.map((series) => (
              <option key={series} value={series}>
                {series}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sort" className="text-sm font-medium text-fg">
            Sort by
          </label>
          <select
            id="sort"
            name="sort"
            defaultValue={searchParams.get("sort") ?? "release"}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="release">Release date (newest)</option>
            <option value="name">Name</option>
            <option value="cards">Number of cards</option>
          </select>
        </div>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-accent px-5 font-medium text-white hover:bg-accent-strong"
        >
          Apply
        </button>
      </Form>

      <p className="text-sm text-fg-muted" role="status">
        {result.total} sets · page {result.page} of {result.pageCount}
      </p>

      {result.items.length === 0 ? (
        <div className="rounded-(--radius-card) border border-edge bg-surface p-10 text-center text-fg-muted">
          The set catalog is being synchronized — check back shortly.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.items.map((set) => (
            <li key={set.id}>
              <Link
                to={`/sets/${set.slug}`}
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
                    {set.releaseDate ?? "Unknown release"} · {set.total ?? "?"} cards
                    {set.printedTotal && set.total && set.printedTotal !== set.total
                      ? ` (${set.printedTotal} printed)`
                      : ""}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {result.pageCount > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-2">
          {result.page > 1 ? (
            <Link
              to={pageLink(result.page - 1)}
              className="rounded-lg border border-edge px-4 py-2 text-sm hover:bg-surface-raised"
            >
              ← Previous
            </Link>
          ) : null}
          <span className="px-2 text-sm text-fg-muted">
            Page {result.page} / {result.pageCount}
          </span>
          {result.page < result.pageCount ? (
            <Link
              to={pageLink(result.page + 1)}
              className="rounded-lg border border-edge px-4 py-2 text-sm hover:bg-surface-raised"
            >
              Next →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
