/**
 * Portfolio aggregation queries. Valuation source: TCGplayer USD, matching each
 * entry's SELECTED variant exactly (never silently another variant — SPEC §16).
 */

import { and, asc, desc, eq, gte, sql } from "drizzle-orm";

import { schema, type Database } from "../db/index.server";
import { computePortfolioSummary, type PortfolioSummary } from "./calc";

/** Joined entry rows for summary computation (variant-exact price match). */
export async function loadPortfolioEntries(db: Database, userId: string) {
  return db.all<{
    quantity: number;
    current_price_minor: number | null;
    purchase_price_minor: number | null;
  }>(sql`
    SELECT e.quantity,
           CASE WHEN e.grade = 'raw' THEN p.normalized_price_minor ELSE g.from_minor END
             AS current_price_minor,
           CASE WHEN e.purchase_currency = 'USD' THEN e.purchase_price_minor ELSE NULL END
             AS purchase_price_minor
    FROM collection_entries e
    LEFT JOIN card_prices_current p
      ON p.card_id = e.card_id AND p.variant = e.variant
     AND p.source = 'tcgplayer' AND p.currency = 'USD'
    LEFT JOIN card_graded_prices g
      ON g.card_id = e.card_id AND g.grade = e.grade AND g.currency = 'USD'
    WHERE e.user_id = ${userId}
  `);
}

export async function computeUserPortfolio(
  db: Database,
  userId: string,
): Promise<PortfolioSummary> {
  const rows = await loadPortfolioEntries(db, userId);
  return computePortfolioSummary(
    rows.map((row) => ({
      quantity: row.quantity,
      currentPriceMinor: row.current_price_minor,
      purchasePriceMinor: row.purchase_price_minor,
    })),
  );
}

export interface DashboardBreakdowns {
  bySet: { name: string; valueMinor: number }[];
  byRarity: { name: string; valueMinor: number }[];
  byVariant: { name: string; valueMinor: number }[];
  topCards: {
    cardId: string;
    slug: string;
    name: string;
    imageSmallUrl: string | null;
    variant: string;
    quantity: number;
    valueMinor: number;
  }[];
  movers: {
    cardId: string;
    slug: string;
    name: string;
    variant: string;
    grade: string;
    currentMinor: number;
    previousMinor: number;
    changePercent: number;
  }[];
  recentActivity: {
    id: string;
    cardName: string;
    cardSlug: string;
    quantity: number;
    variant: string;
    updatedAt: number;
  }[];
  uniqueCardCount: number;
}

export async function loadDashboardBreakdowns(
  db: Database,
  userId: string,
): Promise<DashboardBreakdowns> {
  // Grade-aware price: raw entries use the TCGplayer variant price; PSA-graded
  // entries use the eBay graded "from" price for that grade.
  const priceMinor = sql`CASE WHEN e.grade = 'raw' THEN p.normalized_price_minor ELSE g.from_minor END`;
  const baseJoins = sql`
    FROM collection_entries e
    JOIN pokemon_cards k ON k.id = e.card_id
    LEFT JOIN card_prices_current p
      ON p.card_id = e.card_id AND p.variant = e.variant
     AND p.source = 'tcgplayer' AND p.currency = 'USD'
    LEFT JOIN card_graded_prices g
      ON g.card_id = e.card_id AND g.grade = e.grade AND g.currency = 'USD'
  `;
  const whereUser = sql`WHERE e.user_id = ${userId}`;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);

  const [bySet, byRarity, byVariant, topCards, movers, recentActivity, unique] = await Promise.all([
    db.all<{ name: string; value_minor: number }>(sql`
      SELECT s.name AS name, SUM(COALESCE(${priceMinor}, 0) * e.quantity) AS value_minor
      ${baseJoins} JOIN pokemon_sets s ON s.id = k.set_id
      ${whereUser}
      GROUP BY s.name HAVING value_minor > 0 ORDER BY value_minor DESC LIMIT 8
    `),
    db.all<{ name: string; value_minor: number }>(sql`
      SELECT COALESCE(k.rarity, 'Unknown') AS name,
             SUM(COALESCE(${priceMinor}, 0) * e.quantity) AS value_minor
      ${baseJoins} ${whereUser}
      GROUP BY COALESCE(k.rarity, 'Unknown') HAVING value_minor > 0
      ORDER BY value_minor DESC LIMIT 8
    `),
    db.all<{ name: string; value_minor: number }>(sql`
      SELECT e.variant AS name, SUM(COALESCE(${priceMinor}, 0) * e.quantity) AS value_minor
      ${baseJoins} ${whereUser}
      GROUP BY e.variant HAVING value_minor > 0 ORDER BY value_minor DESC
    `),
    db.all<{
      card_id: string;
      slug: string;
      name: string;
      image_small_url: string | null;
      variant: string;
      quantity: number;
      value_minor: number;
    }>(sql`
      SELECT e.card_id, k.slug, k.name, k.image_small_url, e.variant,
             SUM(e.quantity) AS quantity,
             SUM(${priceMinor} * e.quantity) AS value_minor
      ${baseJoins} ${whereUser} AND ${priceMinor} IS NOT NULL
      GROUP BY e.card_id, e.variant ORDER BY value_minor DESC LIMIT 5
    `),
    db.all<{
      card_id: string;
      slug: string;
      name: string;
      variant: string;
      grade: string;
      current_minor: number;
      previous_minor: number;
    }>(sql`
      SELECT DISTINCT e.card_id, k.slug, k.name, e.variant, e.grade,
             ${priceMinor} AS current_minor,
             CASE WHEN e.grade = 'raw' THEN prev.price_minor ELSE gprev.price_minor END AS previous_minor
      ${baseJoins}
      LEFT JOIN (
        SELECT h.card_id, h.variant, h.price_minor,
               ROW_NUMBER() OVER (PARTITION BY h.card_id, h.variant ORDER BY h.recorded_date DESC) rn
        FROM card_price_history h
        WHERE h.source = 'tcgplayer' AND h.currency = 'USD' AND h.recorded_date <= ${weekAgo}
      ) prev ON prev.card_id = e.card_id AND prev.variant = e.variant AND prev.rn = 1
      LEFT JOIN (
        SELECT h.card_id, h.grade, h.price_minor,
               ROW_NUMBER() OVER (PARTITION BY h.card_id, h.grade ORDER BY h.recorded_date DESC) rn
        FROM card_graded_price_history h
        WHERE h.currency = 'USD' AND h.recorded_date <= ${weekAgo}
      ) gprev ON gprev.card_id = e.card_id AND gprev.grade = e.grade AND gprev.rn = 1
      ${whereUser}
        AND (CASE WHEN e.grade = 'raw' THEN prev.price_minor ELSE gprev.price_minor END) > 0
        AND ${priceMinor} != (CASE WHEN e.grade = 'raw' THEN prev.price_minor ELSE gprev.price_minor END)
    `),
    db
      .select({
        id: schema.collectionEntries.id,
        cardName: schema.pokemonCards.name,
        cardSlug: schema.pokemonCards.slug,
        quantity: schema.collectionEntries.quantity,
        variant: schema.collectionEntries.variant,
        updatedAt: schema.collectionEntries.updatedAt,
      })
      .from(schema.collectionEntries)
      .innerJoin(schema.pokemonCards, eq(schema.collectionEntries.cardId, schema.pokemonCards.id))
      .where(eq(schema.collectionEntries.userId, userId))
      .orderBy(desc(schema.collectionEntries.updatedAt))
      .limit(6),
    db.get<{ n: number }>(sql`
      SELECT COUNT(DISTINCT card_id) AS n FROM collection_entries WHERE user_id = ${userId}
    `),
  ]);

  const moversMapped = movers
    .map((m) => ({
      cardId: m.card_id,
      slug: m.slug,
      name: m.name,
      variant: m.variant,
      grade: m.grade,
      currentMinor: m.current_minor,
      previousMinor: m.previous_minor,
      changePercent: ((m.current_minor - m.previous_minor) / m.previous_minor) * 100,
    }))
    .sort((a, b) => b.changePercent - a.changePercent);

  return {
    bySet: bySet.map((r) => ({ name: r.name, valueMinor: r.value_minor })),
    byRarity: byRarity.map((r) => ({ name: r.name, valueMinor: r.value_minor })),
    byVariant: byVariant.map((r) => ({ name: r.name, valueMinor: r.value_minor })),
    topCards: topCards.map((r) => ({
      cardId: r.card_id,
      slug: r.slug,
      name: r.name,
      imageSmallUrl: r.image_small_url,
      variant: r.variant,
      quantity: r.quantity,
      valueMinor: r.value_minor,
    })),
    movers: moversMapped,
    recentActivity: recentActivity.map((r) => ({
      ...r,
      updatedAt: r.updatedAt.getTime(),
    })),
    uniqueCardCount: unique?.n ?? 0,
  };
}

/** Snapshot history for the portfolio chart; bounded by range start. */
export async function loadSnapshots(db: Database, userId: string, sinceDate: string | null) {
  const conditions = [
    eq(schema.portfolioSnapshots.userId, userId),
    eq(schema.portfolioSnapshots.currency, "USD" as const),
  ];
  if (sinceDate) conditions.push(gte(schema.portfolioSnapshots.snapshotDate, sinceDate));
  return db
    .select({
      snapshotDate: schema.portfolioSnapshots.snapshotDate,
      marketValueMinor: schema.portfolioSnapshots.marketValueMinor,
      unrealizedPlMinor: schema.portfolioSnapshots.unrealizedPlMinor,
    })
    .from(schema.portfolioSnapshots)
    .where(and(...conditions))
    .orderBy(asc(schema.portfolioSnapshots.snapshotDate))
    .limit(800);
}

/** Snapshot value at-or-before a date (baseline for 1d/7d/30d changes). */
export async function snapshotAtOrBefore(db: Database, userId: string, date: string) {
  const row = await db.get<{ market_value_minor: number }>(sql`
    SELECT market_value_minor FROM portfolio_snapshots
    WHERE user_id = ${userId} AND currency = 'USD' AND snapshot_date <= ${date}
    ORDER BY snapshot_date DESC LIMIT 1
  `);
  return row?.market_value_minor ?? null;
}

/**
 * Upsert today's snapshot for one user (idempotent, recalculable; SPEC §18).
 * Returns the summary so callers can reuse it.
 */
export async function writePortfolioSnapshot(
  db: Database,
  userId: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<PortfolioSummary> {
  const summary = await computeUserPortfolio(db, userId);
  const unique = await db.get<{ n: number }>(sql`
    SELECT COUNT(DISTINCT card_id) AS n FROM collection_entries WHERE user_id = ${userId}
  `);

  await db
    .insert(schema.portfolioSnapshots)
    .values({
      userId,
      snapshotDate: today,
      currency: "USD",
      marketValueMinor: summary.marketValueMinor,
      costBasisMinor: summary.costBasisMinor,
      unrealizedPlMinor: summary.unrealizedPlMinor,
      uniqueCardCount: unique?.n ?? 0,
      totalQuantity: summary.totalQuantity,
      pricedEntryCount: summary.pricedEntryCount,
      unpricedEntryCount: summary.unpricedEntryCount,
      calculatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        schema.portfolioSnapshots.userId,
        schema.portfolioSnapshots.snapshotDate,
        schema.portfolioSnapshots.currency,
      ],
      set: {
        marketValueMinor: summary.marketValueMinor,
        costBasisMinor: summary.costBasisMinor,
        unrealizedPlMinor: summary.unrealizedPlMinor,
        uniqueCardCount: unique?.n ?? 0,
        totalQuantity: summary.totalQuantity,
        pricedEntryCount: summary.pricedEntryCount,
        unpricedEntryCount: summary.unpricedEntryCount,
        calculatedAt: new Date(),
      },
    });

  return summary;
}
