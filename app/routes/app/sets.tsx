import { Link } from "react-router";

import type { Route } from "./+types/sets";
import { Card } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare, getMarket } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { MARKET_CURRENCY } from "~/lib/market/market";
import { formatMinor } from "~/lib/money/decimal";
import { sql } from "drizzle-orm";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "My Set Progress — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const userId = session.user.id;
  const market = getMarket(context);
  // Missing-card value is currency-specific → pick the active market's column.
  const missingValueCol =
    market === "us" ? sql`c.missing_value_minor` : sql`c.missing_value_minor_eur`;

  // Sets where the user owns at least one card, joined with cached progress
  // (source of truth = collection; cache refreshed on set page views/changes)
  // and pinned goals.
  const rows = await db.all<{
    set_id: string;
    slug: string;
    name: string;
    series: string;
    release_date: string | null;
    symbol_url: string | null;
    total_cards: number;
    owned_count: number;
    cached_missing_value: number | null;
    pinned: number | null;
    target_date: string | null;
  }>(sql`
    SELECT s.id AS set_id, s.slug, s.name, s.series, s.release_date, s.symbol_url,
           (SELECT COUNT(*) FROM pokemon_cards k2 WHERE k2.set_id = s.id AND k2.active = 1) AS total_cards,
           (SELECT COUNT(DISTINCT e.card_id) FROM collection_entries e
             JOIN pokemon_cards k3 ON k3.id = e.card_id
             WHERE e.user_id = ${userId} AND k3.set_id = s.id AND e.quantity > 0) AS owned_count,
           (SELECT ${missingValueCol} FROM set_progress_cache c
             WHERE c.user_id = ${userId} AND c.set_id = s.id AND c.checklist_mode = 'standard') AS cached_missing_value,
           (SELECT g.pinned FROM set_goals g
             WHERE g.user_id = ${userId} AND g.set_id = s.id AND g.checklist_mode = 'standard') AS pinned,
           (SELECT g.target_date FROM set_goals g
             WHERE g.user_id = ${userId} AND g.set_id = s.id AND g.checklist_mode = 'standard') AS target_date
    FROM pokemon_sets s
    WHERE s.active = 1
      AND (
        EXISTS (SELECT 1 FROM collection_entries e JOIN pokemon_cards k ON k.id = e.card_id
                WHERE e.user_id = ${userId} AND k.set_id = s.id)
        OR EXISTS (SELECT 1 FROM set_goals g WHERE g.user_id = ${userId} AND g.set_id = s.id)
      )
    ORDER BY pinned DESC, s.release_date DESC
    LIMIT 200
  `);

  return {
    currency: MARKET_CURRENCY[market],
    sets: rows.map((r) => ({
      setId: r.set_id,
      slug: r.slug,
      name: r.name,
      series: r.series,
      releaseDate: r.release_date,
      symbolUrl: r.symbol_url,
      totalCards: r.total_cards,
      ownedCount: r.owned_count,
      missingValueMinor: r.cached_missing_value,
      pinned: r.pinned === 1,
      targetDate: r.target_date,
    })),
  };
}

export default function MySets({ loaderData }: Route.ComponentProps) {
  const { sets, currency } = loaderData;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-fg">My set progress</h1>

      {sets.length === 0 ? (
        <Card className="text-center">
          <p className="mb-1 text-lg font-medium text-fg">No set progress yet</p>
          <p className="text-sm text-fg-muted">
            Add cards to your collection and your per-set completion will appear here. Browse{" "}
            <Link to="/sets" className="text-accent hover:underline">
              all sets
            </Link>{" "}
            to get started.
          </p>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {sets.map((set) => {
            const pct = set.totalCards > 0 ? (set.ownedCount / set.totalCards) * 100 : 0;
            return (
              <li key={set.setId}>
                <Link
                  to={`/app/sets/${set.slug}`}
                  className="flex h-full flex-col gap-2 rounded-(--radius-card) border border-edge bg-surface p-5 hover:border-accent"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 font-semibold text-fg">
                      {set.symbolUrl ? (
                        <img src={set.symbolUrl} alt="" className="h-5 w-5" />
                      ) : null}
                      <span className="truncate">{set.name}</span>
                    </span>
                    {set.pinned ? (
                      <span aria-label="Pinned set" className="shrink-0 text-secondary">
                        ★
                      </span>
                    ) : null}
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={Math.round(pct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${set.name} completion`}
                    className="h-2.5 w-full overflow-hidden rounded-full bg-surface-raised"
                  >
                    <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-sm text-fg-muted">
                    {set.ownedCount}/{set.totalCards} cards ({pct.toFixed(0)}%)
                    {set.missingValueMinor !== null && set.ownedCount < set.totalCards
                      ? ` · missing ≈ ${formatMinor(set.missingValueMinor, currency)}`
                      : ""}
                  </p>
                  {set.targetDate ? (
                    <p className="text-xs text-fg-faint">Goal: complete by {set.targetDate}</p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className="text-sm text-fg-muted">
        Looking for a set you don't collect yet? Browse{" "}
        <Link to="/sets" className="text-accent hover:underline">
          the full set catalog
        </Link>
        .
      </p>
    </div>
  );
}
