import { Link } from "react-router";

import type { Route } from "./+types/riftbound.sets";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { localePath, resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { listRiftboundSets } from "~/lib/riftbound/queries.server";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "Riftbound sets | Pokector",
    description: "Every Riftbound (League of Legends TCG) set, with card counts and prices.",
    canonical: data?.canonical,
    alternates: data ? { appUrl: data.appUrl, path: "/riftbound/sets" } : undefined,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" };
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const locale = resolveLocale(params.locale);
  return {
    sets: await listRiftboundSets(db),
    canonical: canonicalUrl(env.APP_URL, localePath(locale, "/riftbound/sets")),
    appUrl: env.APP_URL,
  };
}

export default function RiftboundSets({ loaderData }: Route.ComponentProps) {
  const { sets } = loaderData;
  const lp = useLocalePath();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-fg">Riftbound sets</h1>
      {sets.length === 0 ? (
        <p className="rounded-lg border border-edge bg-surface p-6 text-sm text-fg-muted">
          No Riftbound sets yet — the catalog is syncing. Check back shortly.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sets.map((s) => (
            <li key={s.id}>
              <Link
                to={lp(`/riftbound/sets/${s.slug}`)}
                className="flex items-center gap-3 rounded-(--radius-card) border border-edge bg-surface p-4 hover:border-accent"
              >
                {s.imageUrl ? (
                  <img src={s.imageUrl} alt="" className="h-10 w-10 object-contain" />
                ) : null}
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-fg">{s.name}</span>
                  <span className="text-xs text-fg-faint">
                    {s.cardCount} cards{s.releaseDate ? ` · ${s.releaseDate}` : ""}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
