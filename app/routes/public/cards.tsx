import { Form, Link, useSearchParams } from "react-router";

import type { Route } from "./+types/cards";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { searchCards } from "~/lib/catalog/queries.server";
import { canonicalUrl, collectionPageJsonLd, JsonLd, pageMeta } from "~/lib/seo/meta";
import { clientIp, enforceRateLimit } from "~/lib/security/rate-limit.server";

export function meta({ loaderData: data }: Route.MetaArgs) {
  const page = data?.result.page ?? 1;
  const suffix = page > 1 ? ` — Page ${page}` : "";
  return pageMeta({
    title: `Pokémon Card Catalog${suffix} | Pokector`,
    description:
      "Browse and search the complete English Pokémon TCG card catalog with current estimated market prices, rarities, sets, and variants.",
    canonical: data?.canonical,
    // Search results and filter combinations must not be indexed.
    noindex: Boolean(data?.filtered),
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q) {
    await enforceRateLimit(createDb(env.DB), "search", clientIp(request));
  }
  const params = {
    q: q || undefined,
    setId: url.searchParams.get("set") ?? undefined,
    rarity: url.searchParams.get("rarity") ?? undefined,
    supertype: url.searchParams.get("supertype") ?? undefined,
    sort: (url.searchParams.get("sort") as "name" | "number" | "newest" | null) ?? undefined,
    page: Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  };
  const db = createDb(env.DB);
  const result = await searchCards(db, params);
  const filtered = Boolean(q || params.setId || params.rarity || params.supertype || params.sort);

  return {
    result,
    q,
    filtered,
    appUrl: env.APP_URL,
    canonical: canonicalUrl(env.APP_URL, "/cards"),
  };
}

const RARITIES = ["Common", "Uncommon", "Rare", "Rare Holo", "Rare Ultra", "Rare Secret"];

export default function Cards({ loaderData }: Route.ComponentProps) {
  const { result, q, appUrl } = loaderData;
  const [searchParams] = useSearchParams();

  function pageLink(page: number): string {
    const next = new URLSearchParams(searchParams);
    if (page <= 1) next.delete("page");
    else next.set("page", String(page));
    const qs = next.toString();
    return qs ? `/cards?${qs}` : "/cards";
  }

  return (
    <div className="flex flex-col gap-6">
      <JsonLd
        data={collectionPageJsonLd(appUrl, {
          name: "Pokémon Card Catalog",
          description: "Complete English Pokémon TCG card catalog with market price estimates.",
          path: "/cards",
          items: result.items.slice(0, 10).map((card) => ({
            name: card.name,
            path: `/cards/${card.slug}`,
          })),
        })}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to="/" className="hover:text-fg">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-fg">
          Cards
        </span>
      </nav>

      <h1 className="text-3xl font-bold text-fg">Pokémon card catalog</h1>

      <Form method="get" className="flex flex-wrap items-end gap-3" role="search">
        <div className="flex min-w-52 flex-1 flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium text-fg">
            Search
          </label>
          <input
            id="q"
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Card name, set, or number…"
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg placeholder:text-fg-faint"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="rarity" className="text-sm font-medium text-fg">
            Rarity
          </label>
          <select
            id="rarity"
            name="rarity"
            defaultValue={searchParams.get("rarity") ?? ""}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="">Any</option>
            {RARITIES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="supertype" className="text-sm font-medium text-fg">
            Card type
          </label>
          <select
            id="supertype"
            name="supertype"
            defaultValue={searchParams.get("supertype") ?? ""}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="">Any</option>
            <option value="Pokémon">Pokémon</option>
            <option value="Trainer">Trainer</option>
            <option value="Energy">Energy</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sort" className="text-sm font-medium text-fg">
            Sort by
          </label>
          <select
            id="sort"
            name="sort"
            defaultValue={searchParams.get("sort") ?? "name"}
            className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
          >
            <option value="name">Name</option>
            <option value="number">Set number</option>
            <option value="newest">Recently updated</option>
          </select>
        </div>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-accent px-5 font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
        >
          Apply
        </button>
      </Form>

      <p className="text-sm text-fg-muted" role="status">
        {result.total.toLocaleString("en-US")} cards
        {q ? ` matching “${q}”` : ""} · page {result.page} of {result.pageCount}
      </p>

      {result.items.length === 0 ? (
        <div className="rounded-(--radius-card) border border-edge bg-surface p-10 text-center">
          <p className="mb-2 text-lg font-medium text-fg">No cards found</p>
          <p className="text-sm text-fg-muted">
            Try a shorter search term, or check the spelling. The catalog covers English-language
            Pokémon TCG cards.
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {result.items.map((card) => (
            <li key={card.id}>
              <Link to={`/cards/${card.slug}`} className="group flex h-full flex-col gap-2">
                {card.imageSmallUrl ? (
                  <img
                    src={card.imageSmallUrl}
                    alt={`${card.name} — ${card.setName ?? card.setId} ${card.number}`}
                    loading="lazy"
                    className="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
                  />
                ) : (
                  <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-sm text-fg-faint">
                    No image
                  </span>
                )}
                <div>
                  <p className="truncate text-sm font-medium text-fg group-hover:text-accent">
                    {card.name}
                  </p>
                  <p className="truncate text-xs text-fg-faint">
                    {card.setName} · #{card.number}
                    {card.rarity ? ` · ${card.rarity}` : ""}
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
