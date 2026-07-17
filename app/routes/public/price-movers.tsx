import { Link } from "react-router";

import type { Route } from "./+types/price-movers";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { getPriceMovers, type PriceMover } from "~/lib/catalog/queries.server";
import { formatMinor, formatPercent } from "~/lib/money/decimal";
import { canonicalUrl, pageMeta } from "~/lib/seo/meta";

export function meta({ loaderData: data }: Route.MetaArgs) {
  return pageMeta({
    title: "Pokémon Card Price Movers — Biggest Gainers & Decliners | Pokector",
    description:
      "Which Pokémon cards gained or lost the most market value in the last 7 and 30 days — based on real price observations recorded by Pokector.",
    canonical: data?.canonical,
  });
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=7200" };
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const [up7, down7, up30, down30] = await Promise.all([
    getPriceMovers(db, 7, "up"),
    getPriceMovers(db, 7, "down"),
    getPriceMovers(db, 30, "up"),
    getPriceMovers(db, 30, "down"),
  ]);
  return { up7, down7, up30, down30, canonical: canonicalUrl(env.APP_URL, "/price-movers") };
}

export default function PriceMovers({ loaderData }: Route.ComponentProps) {
  const { up7, down7, up30, down30 } = loaderData;
  const hasAny = up7.length + down7.length + up30.length + down30.length > 0;

  return (
    <div className="flex flex-col gap-8">
      <nav aria-label="Breadcrumb" className="text-sm text-fg-muted">
        <Link to="/" className="hover:text-fg">
          Home
        </Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page" className="text-fg">
          Price movers
        </span>
      </nav>

      <div>
        <h1 className="text-3xl font-bold text-fg">Price movers</h1>
        <p className="mt-2 max-w-2xl text-fg-muted">
          The biggest raw-card market moves among cards Pokector actively tracks. Changes are
          computed only from real recorded observations — a card needs at least a week (or a month)
          of tracked history to appear here.
        </p>
      </div>

      {!hasAny ? (
        <div className="rounded-(--radius-card) border border-edge bg-surface p-10 text-center">
          <p className="mb-2 text-lg font-medium text-fg">Not enough price history yet</p>
          <p className="mx-auto max-w-md text-sm text-fg-muted">
            Pokector never fabricates price changes. Movers appear once tracked cards accumulate at
            least 7 days of real observations. Start tracking cards in your{" "}
            <Link to="/register" className="text-accent hover:underline">
              collection
            </Link>{" "}
            to help build coverage.
          </p>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          <MoverSection title="7-day gainers" movers={up7} direction="up" />
          <MoverSection title="7-day decliners" movers={down7} direction="down" />
          <MoverSection title="30-day gainers" movers={up30} direction="up" />
          <MoverSection title="30-day decliners" movers={down30} direction="down" />
        </div>
      )}
    </div>
  );
}

function MoverSection({
  title,
  movers,
  direction,
}: {
  title: string;
  movers: PriceMover[];
  direction: "up" | "down";
}) {
  return (
    <section
      aria-label={title}
      className="rounded-(--radius-card) border border-edge bg-surface p-5"
    >
      <h2 className="mb-4 text-lg font-semibold text-fg">{title}</h2>
      {movers.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No qualifying moves in this window yet — more tracked history is needed.
        </p>
      ) : (
        <ol className="flex flex-col gap-3">
          {movers.map((mover) => (
            <li key={`${mover.cardId}-${mover.variant}`}>
              <Link
                to={`/cards/${mover.slug}`}
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
                <div className="text-right">
                  <p className="text-sm font-semibold text-fg">{formatMinor(mover.currentMinor)}</p>
                  <p
                    className={`text-xs font-medium ${direction === "up" ? "text-positive" : "text-negative"}`}
                  >
                    {formatPercent(mover.changePercent)} ({formatMinor(Math.abs(mover.changeMinor))}
                    )
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
