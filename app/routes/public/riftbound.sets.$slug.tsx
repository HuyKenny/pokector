import { Link } from "react-router";

import type { Route } from "./+types/riftbound.sets.$slug";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { formatMinor } from "~/lib/money/decimal";
import { getRiftboundSetBySlug } from "~/lib/riftbound/queries.server";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  if (!data) return pageMeta({ title: "Riftbound set | Pokector", description: "" });
  return pageMeta({
    title: `${data.set.name} — Riftbound set cards & prices | Pokector`,
    description: `All ${data.set.name} Riftbound cards with live market prices.`,
    canonical: data.canonical,
    alternates: { appUrl: data.appUrl, path: `/riftbound/sets/${data.set.slug}` },
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(params.locale);
  const data = await getRiftboundSetBySlug(db, params.slug);
  if (!data) throw new Response("Set not found", { status: 404 });
  return {
    set: data.set,
    cards: data.cards,
    canonical: canonicalUrl(env.APP_URL, localePath(locale, `/riftbound/sets/${data.set.slug}`)),
    appUrl: env.APP_URL,
  };
}

export default function RiftboundSetDetail({ loaderData }: Route.ComponentProps) {
  const { set, cards } = loaderData;
  const lp = useLocalePath();
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to={lp("/riftbound/sets")} className="hover:text-fg">
          Riftbound sets
        </Link>{" "}
        / <span className="text-fg">{set.name}</span>
      </nav>
      <h1 className="text-2xl font-bold text-fg">{set.name}</h1>

      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <li key={c.id}>
            <Link to={lp(`/riftbound/cards/${c.slug}`)} className="group flex flex-col gap-1">
              {c.imageSmallUrl ? (
                <img
                  src={c.imageSmallUrl}
                  alt={c.name}
                  loading="lazy"
                  className="aspect-[63/88] w-full rounded-lg border border-edge object-cover group-hover:border-accent"
                />
              ) : (
                <span className="flex aspect-[63/88] items-center justify-center rounded-lg border border-edge bg-surface-raised text-xs text-fg-faint">
                  No image
                </span>
              )}
              <span className="truncate text-sm font-medium text-fg">{c.name}</span>
              <span className="text-xs text-fg-faint">#{c.number}</span>
              <span className="text-sm font-semibold text-fg">
                {c.priceMinor !== null ? formatMinor(c.priceMinor, "USD") : "—"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
