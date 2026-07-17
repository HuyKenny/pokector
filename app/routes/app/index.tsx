import { useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/index";
import {
  carryForward,
  HistoryChart,
  rangeStartDate,
  type ChartRange,
} from "~/components/history-chart";
import { Card } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { changeBetween } from "~/lib/portfolio/calc";
import {
  computeUserPortfolio,
  loadDashboardBreakdowns,
  loadSnapshots,
  snapshotAtOrBefore,
  writePortfolioSnapshot,
} from "~/lib/portfolio/queries.server";
import { formatMinor, formatPercent } from "~/lib/money/decimal";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Dashboard — Pokector" }, { name: "robots", content: "noindex" }];
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env, ctx } = getCloudflare(context);
  const db = createDb(env.DB);
  const userId = session.user.id;

  const [summary, breakdowns, snapshots, prev1, prev7, prev30] = await Promise.all([
    computeUserPortfolio(db, userId),
    loadDashboardBreakdowns(db, userId),
    loadSnapshots(db, userId, null),
    snapshotAtOrBefore(db, userId, daysAgo(1)),
    snapshotAtOrBefore(db, userId, daysAgo(7)),
    snapshotAtOrBefore(db, userId, daysAgo(30)),
  ]);

  // Keep today's snapshot fresh after collection changes (idempotent upsert).
  const today = new Date().toISOString().slice(0, 10);
  if (summary.totalEntries > 0 && !snapshots.some((s) => s.snapshotDate === today)) {
    ctx.waitUntil(writePortfolioSnapshot(db, userId, today).then(() => undefined));
  }

  return {
    name: session.user.name,
    summary,
    breakdowns,
    snapshots,
    changes: {
      daily: changeBetween(summary.marketValueMinor, prev1),
      weekly: changeBetween(summary.marketValueMinor, prev7),
      monthly: changeBetween(summary.marketValueMinor, prev30),
    },
    trackingSince: snapshots[0]?.snapshotDate ?? null,
  };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const { name, summary, breakdowns, snapshots, changes, trackingSince } = loaderData;
  const [range, setRange] = useState<ChartRange>("MAX");

  if (summary.totalEntries === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-bold text-fg">Welcome, {name}</h1>
        <Card className="text-center">
          <p className="mb-2 text-lg font-medium text-fg">Your portfolio starts here</p>
          <p className="mx-auto mb-4 max-w-md text-sm text-fg-muted">
            Add your first cards and Pokector will start valuing your collection and recording its
            history — from today onward, never backfilled.
          </p>
          <div className="flex justify-center gap-3">
            <Link
              to="/app/collection"
              className="rounded-lg bg-accent px-5 py-2.5 font-medium text-white hover:bg-accent-strong"
            >
              Add cards
            </Link>
            <Link
              to="/cards"
              className="rounded-lg border border-edge bg-surface px-5 py-2.5 font-medium text-fg hover:bg-surface-raised"
            >
              Browse catalog
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const sinceDate = rangeStartDate(range);
  const chartPoints = carryForward(
    [
      ...snapshots
        .filter((s) => !sinceDate || s.snapshotDate >= sinceDate)
        .map((s) => ({ date: s.snapshotDate, valueMinor: s.marketValueMinor })),
      { date: today, valueMinor: summary.marketValueMinor },
    ].filter((point, index, arr) => arr.findIndex((p) => p.date === point.date) === index),
    today,
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-fg">Dashboard</h1>

      {/* Headline stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Estimated market value"
          value={formatMinor(summary.marketValueMinor)}
          sub={`${summary.pricedEntryCount}/${summary.totalEntries} entries priced (${summary.valuationCoveragePercent.toFixed(0)}%)`}
        />
        <StatCard
          label="Cost basis (recorded)"
          value={formatMinor(summary.costBasisMinor)}
          sub={`${summary.costBasisCoveragePercent.toFixed(0)}% of entries have a purchase price`}
        />
        <StatCard
          label="Unrealized P/L"
          value={formatMinor(summary.unrealizedPlMinor)}
          tone={summary.unrealizedPlMinor >= 0 ? "positive" : "negative"}
          sub={`over ${formatMinor(summary.matchedMarketValueMinor)} matched value`}
        />
        <StatCard
          label="ROI"
          value={summary.roiPercent !== null ? formatPercent(summary.roiPercent) : "—"}
          tone={summary.roiPercent !== null && summary.roiPercent >= 0 ? "positive" : "negative"}
          sub={
            summary.roiPercent === null
              ? "record purchase prices to unlock"
              : "on entries with cost + price"
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <MiniStat label="Unique cards" value={breakdowns.uniqueCardCount.toLocaleString("en-US")} />
        <MiniStat label="Total quantity" value={summary.totalQuantity.toLocaleString("en-US")} />
        <MiniStat label="Unpriced entries" value={String(summary.unpricedEntryCount)} />
        <ChangeStat label="Daily change" change={changes.daily} />
        <ChangeStat label="7-day change" change={changes.weekly} />
      </div>

      {/* Portfolio chart */}
      <Card>
        <HistoryChart
          title="Portfolio value"
          points={chartPoints}
          range={range}
          onRangeChange={setRange}
          emptyMessage="Portfolio history starts with your first snapshot — check back tomorrow."
          startNote={
            trackingSince
              ? `Tracking since ${trackingSince}. Earlier dates are never backfilled.`
              : `Tracking starts today (${today}).`
          }
        />
        <p className="mt-2 text-xs text-fg-faint">
          30-day change: <ChangeInline change={changes.monthly} />
        </p>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Most valuable */}
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-fg">Most valuable cards</h2>
          {breakdowns.topCards.length === 0 ? (
            <p className="text-sm text-fg-muted">No priced cards yet.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {breakdowns.topCards.map((card) => (
                <li key={`${card.cardId}-${card.variant}`}>
                  <Link
                    to={`/cards/${card.slug}`}
                    className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-surface-raised"
                  >
                    {card.imageSmallUrl ? (
                      <img
                        src={card.imageSmallUrl}
                        alt=""
                        loading="lazy"
                        className="h-12 w-9 rounded border border-edge object-cover"
                      />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        {card.name}
                      </span>
                      <span className="text-xs text-fg-faint">
                        {card.variant} ×{card.quantity}
                      </span>
                    </span>
                    <span className="text-sm font-semibold text-fg">
                      {formatMinor(card.valueMinor)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {/* Gainers / decliners */}
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-fg">Your 7-day movers</h2>
          {breakdowns.movers.length === 0 ? (
            <p className="text-sm text-fg-muted">
              No price movements recorded yet — movers appear once your cards accumulate real price
              history.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {[...breakdowns.movers.slice(0, 3), ...breakdowns.movers.slice(-3).reverse()]
                .filter(
                  (m, i, arr) =>
                    arr.findIndex((x) => x.cardId === m.cardId && x.variant === m.variant) === i,
                )
                .map((mover) => (
                  <li
                    key={`${mover.cardId}-${mover.variant}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <Link
                      to={`/cards/${mover.slug}`}
                      className="min-w-0 flex-1 truncate text-sm font-medium text-fg hover:text-accent"
                    >
                      {mover.name} <span className="text-xs text-fg-faint">({mover.variant})</span>
                    </Link>
                    <span
                      className={`text-sm font-medium ${mover.changePercent >= 0 ? "text-positive" : "text-negative"}`}
                    >
                      {formatPercent(mover.changePercent)}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        {/* Value by set */}
        <BreakdownCard
          title="Value by set"
          rows={breakdowns.bySet}
          totalMinor={summary.marketValueMinor}
        />
        <BreakdownCard
          title="Value by rarity"
          rows={breakdowns.byRarity}
          totalMinor={summary.marketValueMinor}
        />
        <BreakdownCard
          title="Value by variant"
          rows={breakdowns.byVariant}
          totalMinor={summary.marketValueMinor}
        />

        {/* Recent activity */}
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-fg">Recent activity</h2>
          {breakdowns.recentActivity.length === 0 ? (
            <p className="text-sm text-fg-muted">No activity yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {breakdowns.recentActivity.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3">
                  <Link
                    to={`/cards/${entry.cardSlug}`}
                    className="min-w-0 flex-1 truncate text-fg hover:text-accent"
                  >
                    {entry.cardName}{" "}
                    <span className="text-xs text-fg-faint">
                      ({entry.variant} ×{entry.quantity})
                    </span>
                  </Link>
                  <time
                    dateTime={new Date(entry.updatedAt).toISOString()}
                    className="text-xs text-fg-faint"
                  >
                    {new Date(entry.updatedAt).toLocaleDateString("en-US")}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative";
}) {
  return (
    <Card className="!p-4">
      <p className="text-xs uppercase tracking-wide text-fg-muted">{label}</p>
      <p
        className={`text-2xl font-bold ${tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-fg"}`}
      >
        {value}
      </p>
      {sub ? <p className="mt-1 text-xs text-fg-faint">{sub}</p> : null}
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="!p-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="text-lg font-semibold text-fg">{value}</p>
    </Card>
  );
}

function ChangeInline({
  change,
}: {
  change: { deltaMinor: number; percent: number | null } | null;
}) {
  if (!change) return <span className="text-fg-faint">not enough history yet</span>;
  return (
    <span className={change.deltaMinor >= 0 ? "text-positive" : "text-negative"}>
      {change.deltaMinor >= 0 ? "+" : ""}
      {formatMinor(change.deltaMinor)}
      {change.percent !== null ? ` (${formatPercent(change.percent)})` : ""}
    </span>
  );
}

function ChangeStat({
  label,
  change,
}: {
  label: string;
  change: { deltaMinor: number; percent: number | null } | null;
}) {
  return (
    <Card className="!p-3">
      <p className="text-xs text-fg-muted">{label}</p>
      <p className="text-lg font-semibold">
        <ChangeInline change={change} />
      </p>
    </Card>
  );
}

function BreakdownCard({
  title,
  rows,
  totalMinor,
}: {
  title: string;
  rows: { name: string; valueMinor: number }[];
  totalMinor: number;
}) {
  return (
    <Card>
      <h2 className="mb-3 text-lg font-semibold text-fg">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-muted">No priced cards yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const pct = totalMinor > 0 ? (row.valueMinor / totalMinor) * 100 : 0;
            return (
              <li key={row.name} className="text-sm">
                <div className="mb-0.5 flex justify-between gap-3">
                  <span className="truncate text-fg">{row.name}</span>
                  <span className="shrink-0 text-fg-muted">{formatMinor(row.valueMinor)}</span>
                </div>
                <div
                  aria-hidden="true"
                  className="h-1.5 w-full overflow-hidden rounded-full bg-surface-raised"
                >
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
