import { Form, Link } from "react-router";

import type { Route } from "./+types/riftbound.cards";
import { CardImage } from "~/components/card-image";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { formatMinor } from "~/lib/money/decimal";
import { listRiftboundCards } from "~/lib/riftbound/queries.server";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "Riftbound Card List — All Cards & Prices | Pokector",
    description:
      "The full Riftbound (League of Legends TCG) card list across every set — Origins, Spiritforged, Unleashed and Proving Grounds — with live TCGplayer market prices.",
    canonical: data?.canonical,
    alternates: data ? { appUrl: data.appUrl, path: "/riftbound/cards" } : undefined,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800" };
}

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const url = new URL(request.url);
  const result = await listRiftboundCards(db, {
    q: url.searchParams.get("q") ?? undefined,
    page: Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1,
  });
  return {
    ...result,
    q: url.searchParams.get("q") ?? "",
    locale: resolveLocale(params.locale),
    canonical: canonicalUrl(env.APP_URL, localePath(resolveLocale(params.locale), "/riftbound/cards")),
    appUrl: env.APP_URL,
  };
}

export default function RiftboundCards({ loaderData }: Route.ComponentProps) {
  const { items, total, page, pageCount, q } = loaderData;
  const lp = useLocalePath();
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold text-fg">Riftbound card list</h1>
        <p className="text-sm text-fg-muted">
          The complete Riftbound (League of Legends TCG) card list with live market prices —{" "}
          {total.toLocaleString("en-US")} cards across every set.
        </p>
      </header>

      <Form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search Riftbound cards…"
          className="w-full max-w-sm rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-fg"
        />
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-(color:--color-on-accent)"
        >
          Search
        </button>
      </Form>

      {items.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface p-6 text-sm text-fg-muted">
          No Riftbound cards yet — the catalog is syncing. Check back shortly.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                to={lp(`/riftbound/cards/${c.slug}`)}
                className="group flex h-full flex-col gap-2"
              >
                <CardImage
                  src={c.imageSmallUrl}
                  alt={`${c.name} — ${c.setName} #${c.number}`}
                  imgClassName="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
                  fallbackClassName="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-xs text-fg-faint"
                />
                <div>
                  <p className="truncate text-sm font-medium text-fg group-hover:text-accent">
                    {c.name}
                  </p>
                  <p className="truncate text-xs text-fg-faint">
                    {c.setName} · #{c.number}
                    {c.rarity ? ` · ${c.rarity}` : ""}
                    {c.priceMinor !== null ? ` · ${formatMinor(c.priceMinor, "USD")}` : ""}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pageCount > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-center gap-3 text-sm">
          {page > 1 ? (
            <Link
              to={`?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page - 1) })}`}
              className="rounded-lg border border-edge px-4 py-2"
            >
              ← Previous
            </Link>
          ) : null}
          <span className="text-fg-muted">
            Page {page} / {pageCount}
          </span>
          {page < pageCount ? (
            <Link
              to={`?${new URLSearchParams({ ...(q ? { q } : {}), page: String(page + 1) })}`}
              className="rounded-lg border border-edge px-4 py-2"
            >
              Next →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
