/**
 * Catalog synchronization handlers (SPEC §15). One PTCG API page per job keeps
 * every invocation inside the Workers Free CPU budget; jobs chain via queue
 * wake-ups. All upserts are idempotent; malformed records are skipped and
 * counted; a sync run is marked completed only when every page succeeded.
 */

import { and, eq, inArray, lt, sql } from "drizzle-orm";

import { normalizeCard, normalizeSet } from "../../catalog/normalize";
import { ftsRowValues } from "../../catalog/search.server";
import { createDb, schema, type Database } from "../../db/index.server";
import { log } from "../../log.server";
import { CARDS_PAGE_SIZE, PtcgClient, SETS_PAGE_SIZE } from "../../ptcg/client.server";
import {
  addJobLog,
  enqueueJob,
  enqueueJobs,
  parsePayload,
  wakeUp,
  type SyncJob,
} from "../queue.server";

const todayUtc = () => new Date().toISOString().slice(0, 10);

type BatchStatement = Parameters<Database["batch"]>[0][number];

/** Upsert helper: chunked db.batch writes (D1 limits statements per call). */
async function batchStatements(db: Database, statements: BatchStatement[]) {
  const CHUNK = 20;
  for (let i = 0; i < statements.length; i += CHUNK) {
    const chunk = statements.slice(i, i + CHUNK);
    await db.batch(chunk as [BatchStatement, ...BatchStatement[]]);
  }
}

/**
 * Run raw D1 prepared statements in chunks.
 *
 * `card_search` is an FTS5 virtual table that Drizzle does not model, so its
 * writes go through the native binding.
 *
 * These statements must NOT be built with `db.run()` and handed to `db.batch()`.
 * `db.run()` returns a `SQLiteRaw`, whose `_prepare()` returns itself and which
 * has no `stmt` property — while Drizzle's D1 `batch()` calls
 * `preparedQuery.stmt.bind(...)` for any statement that has parameters. That
 * threw `TypeError: Cannot read properties of undefined (reading 'bind')` on
 * every single card page, and because the card rows are written *earlier* in the
 * handler and the prices *later*, the failure was invisible on the site: cards
 * kept appearing while every price silently froze.
 */
export async function batchD1(db: Env["DB"], statements: D1PreparedStatement[]) {
  const CHUNK = 20;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await db.batch(statements.slice(i, i + CHUNK));
  }
}

// ── catalog_sets ─────────────────────────────────────────────────────────────

export interface CatalogSetsPayload {
  syncRunId?: string;
  kind?: "catalog_full" | "catalog_delta";
}

export async function handleCatalogSets(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const payload = parsePayload<CatalogSetsPayload>(job);
  const client = PtcgClient.fromEnv(env);
  const syncedAt = new Date();

  // Create (or reuse, on retry) the sync run bookkeeping row.
  let syncRunId = payload.syncRunId;
  if (!syncRunId) {
    syncRunId = crypto.randomUUID();
    await db.insert(schema.syncRuns).values({
      id: syncRunId,
      kind: payload.kind ?? "catalog_full",
      status: "running",
      startedAt: syncedAt,
    });
    await db
      .update(schema.syncJobs)
      .set({ payloadJson: JSON.stringify({ ...payload, syncRunId }) })
      .where(eq(schema.syncJobs.id, job.id));
  }

  let page = 1;
  let fetched = 0;
  let malformed = 0;
  let total = Number.POSITIVE_INFINITY;
  let apiRequests = 0;

  while (fetched < total) {
    const result = await client.getSetsPage(page);
    apiRequests++;
    total = result.totalCount;
    fetched += result.items.length;
    if (result.items.length === 0) break;

    const rows = result.items
      .map((item) => normalizeSet(item, syncedAt))
      .filter((row): row is NonNullable<typeof row> => {
        if (row === null) malformed++;
        return row !== null;
      });

    const statements = rows.map((row) =>
      db
        .insert(schema.pokemonSets)
        .values(row)
        .onConflictDoUpdate({
          target: schema.pokemonSets.id,
          set: {
            name: row.name,
            nameNormalized: row.nameNormalized,
            series: row.series,
            printedTotal: row.printedTotal,
            total: row.total,
            releaseDate: row.releaseDate,
            symbolUrl: row.symbolUrl,
            logoUrl: row.logoUrl,
            sourceUpdatedAt: row.sourceUpdatedAt,
            syncedAt: row.syncedAt,
            active: true,
          },
        }),
    );
    await batchStatements(db, statements);
    page++;
    if (page > Math.ceil(total / SETS_PAGE_SIZE) + 1) break; // hard stop safety
  }

  await db
    .update(schema.syncRuns)
    .set({
      setsUpserted: fetched - malformed,
      malformedSkipped: sql`${schema.syncRuns.malformedSkipped} + ${malformed}`,
      apiRequestCount: sql`${schema.syncRuns.apiRequestCount} + ${apiRequests}`,
    })
    .where(eq(schema.syncRuns.id, syncRunId));

  await addJobLog(db, job.id, "info", "sets.synced", { fetched, malformed, apiRequests });

  // Kick off the cards pagination with page 1.
  await enqueueJob(db, {
    type: "catalog_cards_page",
    payload: { syncRunId, page: 1 },
    idempotencyKey: `cards:${syncRunId}:1`,
  });
  await wakeUp(env, "catalog_sets_done");
}

// ── catalog_cards_page ───────────────────────────────────────────────────────

export interface CatalogCardsPagePayload {
  syncRunId: string;
  page: number;
}

export async function handleCatalogCardsPage(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const { syncRunId, page } = parsePayload<CatalogCardsPagePayload>(job);
  const client = PtcgClient.fromEnv(env);
  const syncedAt = new Date();

  const result = await client.getCardsPage(page);
  const totalPages = Math.max(1, Math.ceil(result.totalCount / CARDS_PAGE_SIZE));

  // First page discovers the page count and enqueues the remaining pages.
  if (page === 1) {
    await db.update(schema.syncRuns).set({ totalPages }).where(eq(schema.syncRuns.id, syncRunId));
    const followUps = [];
    for (let p = 2; p <= totalPages; p++) {
      followUps.push({
        type: "catalog_cards_page" as const,
        payload: { syncRunId, page: p },
        idempotencyKey: `cards:${syncRunId}:${p}`,
      });
    }
    await enqueueJobs(db, followUps);
  }

  let malformed = 0;
  const normalized = result.items
    .map((item) => normalizeCard(item, syncedAt))
    .filter((row): row is NonNullable<typeof row> => {
      if (row === null) malformed++;
      return row !== null;
    });

  // Guard: skip cards whose set is unknown (FK) — counted as malformed. Also grab
  // set name/series here to feed the FTS search index below.
  const setIds = [...new Set(normalized.map((n) => n.card.setId))];
  const setInfo = new Map<string, { name: string; series: string; printedTotal: number | null }>();
  for (const r of await db
    .select({
      id: schema.pokemonSets.id,
      name: schema.pokemonSets.name,
      series: schema.pokemonSets.series,
      printedTotal: schema.pokemonSets.printedTotal,
    })
    .from(schema.pokemonSets)
    .where(inArray(schema.pokemonSets.id, setIds))) {
    setInfo.set(r.id, { name: r.name, series: r.series, printedTotal: r.printedTotal });
  }
  const knownSets = new Set(setInfo.keys());
  const usable = normalized.filter((n) => {
    if (!knownSets.has(n.card.setId)) {
      malformed++;
      return false;
    }
    return true;
  });

  const cardStatements = usable.map(({ card }) =>
    db
      .insert(schema.pokemonCards)
      .values(card)
      .onConflictDoUpdate({
        target: schema.pokemonCards.id,
        set: {
          slug: card.slug,
          name: card.name,
          nameNormalized: card.nameNormalized,
          number: card.number,
          numberSort: card.numberSort,
          supertype: card.supertype,
          subtypesJson: card.subtypesJson,
          hp: card.hp,
          typesJson: card.typesJson,
          rarity: card.rarity,
          artist: card.artist,
          nationalPokedexNumbersJson: card.nationalPokedexNumbersJson,
          regulationMark: card.regulationMark,
          imageSmallUrl: card.imageSmallUrl,
          imageLargeUrl: card.imageLargeUrl,
          tcgplayerUrl: card.tcgplayerUrl,
          cardmarketUrl: card.cardmarketUrl,
          searchText: card.searchText,
          sourceUpdatedAt: card.sourceUpdatedAt,
          syncedAt: card.syncedAt,
          active: true,
        },
      }),
  );
  await batchStatements(db, cardStatements);

  // Keep the FTS5 search index in sync. No ON CONFLICT on FTS5 tables, so replace
  // by card_id (delete-then-insert). Includes set name/series for set-name search.
  const ftsStatements = usable.flatMap(({ card }) => {
    const info = setInfo.get(card.setId);
    const v = ftsRowValues({
      id: card.id,
      name: card.name,
      number: card.number,
      printedTotal: info?.printedTotal ?? null,
      rarity: card.rarity,
      artist: card.artist,
      supertype: card.supertype,
      subtypesJson: card.subtypesJson,
      nationalPokedexNumbersJson: card.nationalPokedexNumbersJson,
      setName: info?.name ?? "",
      series: info?.series ?? "",
    });
    return [
      env.DB.prepare("DELETE FROM card_search WHERE card_id = ?").bind(v[0]),
      env.DB.prepare(
        `INSERT INTO card_search
           (card_id, name, set_name, series, number, rarity, artist, dex, supertype)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(...v),
    ];
  });
  await batchD1(env.DB, ftsStatements);

  let pricesUpserted = 0;
  const priceStatements = usable.flatMap(({ card, prices }) =>
    prices.map((price) => {
      pricesUpserted++;
      return db
        .insert(schema.cardPricesCurrent)
        .values({ cardId: card.id, observedAt: syncedAt, ...price })
        .onConflictDoUpdate({
          target: [
            schema.cardPricesCurrent.cardId,
            schema.cardPricesCurrent.source,
            schema.cardPricesCurrent.variant,
            schema.cardPricesCurrent.currency,
          ],
          set: {
            normalizedPriceMinor: price.normalizedPriceMinor,
            lowMinor: price.lowMinor,
            midMinor: price.midMinor,
            highMinor: price.highMinor,
            marketMinor: price.marketMinor,
            directLowMinor: price.directLowMinor,
            trendMinor: price.trendMinor,
            averageSellMinor: price.averageSellMinor,
            sourceUpdatedAt: price.sourceUpdatedAt,
            observedAt: syncedAt,
          },
        });
    }),
  );
  await batchStatements(db, priceStatements);

  // Record history observations for every card on this page (insert only when
  // the value changed or no prior observation exists; unique constraint caps at
  // one row per day). Spread across the chained per-page jobs.
  const pageCardIds = usable.map((n) => n.card.id);
  if (pageCardIds.length > 0) {
    await recordHistoryForCards(db, pageCardIds, syncedAt);
  }

  // Progress bookkeeping + completion detection.
  await db
    .update(schema.syncRuns)
    .set({
      completedPages: sql`${schema.syncRuns.completedPages} + 1`,
      cardsUpserted: sql`${schema.syncRuns.cardsUpserted} + ${usable.length}`,
      pricesUpserted: sql`${schema.syncRuns.pricesUpserted} + ${pricesUpserted}`,
      malformedSkipped: sql`${schema.syncRuns.malformedSkipped} + ${malformed}`,
      apiRequestCount: sql`${schema.syncRuns.apiRequestCount} + 1`,
    })
    .where(eq(schema.syncRuns.id, syncRunId));

  const run = await db.query.syncRuns.findFirst({ where: eq(schema.syncRuns.id, syncRunId) });
  if (
    run &&
    run.totalPages !== null &&
    run.completedPages >= run.totalPages &&
    run.status === "running"
  ) {
    await finalizeCatalogRun(db, run.id);
  }

  await addJobLog(db, job.id, "info", "cards.page_synced", {
    page,
    cards: usable.length,
    prices: pricesUpserted,
    malformed,
  });
  await wakeUp(env, `cards_page_${page}_done`);
}

/** Completed full sync: mark cards missing from the last TWO completed runs inactive. */
async function finalizeCatalogRun(db: Database, runId: string): Promise<void> {
  await db
    .update(schema.syncRuns)
    .set({ status: "completed", completedAt: new Date() })
    .where(eq(schema.syncRuns.id, runId));

  const previousCompleted = await db
    .select({ startedAt: schema.syncRuns.startedAt })
    .from(schema.syncRuns)
    .where(and(eq(schema.syncRuns.kind, "catalog_full"), eq(schema.syncRuns.status, "completed")))
    .orderBy(sql`${schema.syncRuns.startedAt} DESC`)
    .limit(2);

  // Only deactivate when at least two completed runs exist (repeated absence).
  if (previousCompleted.length === 2) {
    const olderRunStart = previousCompleted[1].startedAt;
    await db
      .update(schema.pokemonCards)
      .set({ active: false })
      .where(
        and(eq(schema.pokemonCards.active, true), lt(schema.pokemonCards.syncedAt, olderRunStart)),
      );
  }
  log.info("sync.run_completed", { jobId: runId });
}

// ── price_history_record (daily, all active cards) ──────────────────────────

async function recordHistoryForCards(
  db: Database,
  cardIds: string[] | null,
  now: Date,
): Promise<void> {
  const today = todayUtc();
  const idFilter = cardIds ? sql`AND c.card_id IN ${cardIds}` : sql``;
  // Record a daily observation for EVERY card that has a current price, not just
  // tracked ones — every card's detail page shows a price chart, so the whole
  // catalog needs history (owner request 2026-07-17; see docs/DECISIONS.md D15).
  // Insert only when the value changed vs. the last observation (or none exists);
  // the unique constraint caps this at one row per card/source/variant/day, so
  // steady-state writes are delta-only. The per-page sync spreads the initial
  // full population across the chained catalog jobs (fresh CPU budget each).
  await db.run(sql`
    INSERT OR IGNORE INTO card_price_history
      (card_id, source, variant, currency, price_minor, recorded_date, observed_at, source_updated_at, granularity)
    SELECT c.card_id, c.source, c.variant, c.currency, c.normalized_price_minor,
           ${today}, ${now.getTime()}, c.source_updated_at, 'daily'
    FROM card_prices_current c
    WHERE 1=1 ${idFilter}
      AND COALESCE((
        SELECT h.price_minor FROM card_price_history h
        WHERE h.card_id = c.card_id AND h.source = c.source
          AND h.variant = c.variant AND h.currency = c.currency
        ORDER BY h.recorded_date DESC LIMIT 1
      ), -1) != c.normalized_price_minor
  `);
  // Keep tracked cards' lastHistoryAt fresh (cheap; touches only tracked rows).
  await db
    .update(schema.trackedCards)
    .set({ lastHistoryAt: now })
    .where(cardIds ? inArray(schema.trackedCards.cardId, cardIds) : sql`1=1`);
}

/** Snapshot current graded (PSA) prices into history, delta-only (one row per
 * card/grade/currency/day). Only cards with a graded price (i.e. viewed on the
 * card page, which triggers the eBay lookup) accumulate history. */
async function recordGradedHistory(db: Database, now: Date): Promise<void> {
  const today = todayUtc();
  await db.run(sql`
    INSERT OR IGNORE INTO card_graded_price_history
      (card_id, grade, currency, price_minor, recorded_date, observed_at, granularity)
    SELECT g.card_id, g.grade, g.currency, g.from_minor, ${today}, ${now.getTime()}, 'daily'
    FROM card_graded_prices g
    WHERE COALESCE((
      SELECT h.price_minor FROM card_graded_price_history h
      WHERE h.card_id = g.card_id AND h.grade = g.grade AND h.currency = g.currency
      ORDER BY h.recorded_date DESC LIMIT 1
    ), -1) != g.from_minor
  `);
}

export async function handlePriceHistoryRecord(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const now = new Date();
  await recordHistoryForCards(db, null, now);
  await recordGradedHistory(db, now);
  await addJobLog(db, job.id, "info", "history.recorded", {});
}

// ── retention_aggregate ──────────────────────────────────────────────────────

/** Dailies older than 400 days collapse to one monthly point (the month's last
 * observation). The only value in a period is preserved (SPEC §17). */
export async function handleRetentionAggregate(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const cutoff = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  await db.run(sql`
    UPDATE card_price_history SET granularity = 'monthly'
    WHERE id IN (
      SELECT h.id FROM card_price_history h
      JOIN (
        SELECT card_id, source, variant, currency,
               substr(recorded_date, 1, 7) AS ym, MAX(recorded_date) AS max_date
        FROM card_price_history
        WHERE granularity = 'daily' AND recorded_date < ${cutoff}
        GROUP BY card_id, source, variant, currency, ym
      ) m ON h.card_id = m.card_id AND h.source = m.source AND h.variant = m.variant
         AND h.currency = m.currency AND h.recorded_date = m.max_date
      WHERE h.granularity = 'daily'
    )
  `);
  const deleted = await db.run(sql`
    DELETE FROM card_price_history
    WHERE granularity = 'daily' AND recorded_date < ${cutoff}
  `);

  await addJobLog(db, job.id, "info", "retention.aggregated", {
    cutoff,
    deletedDailies: (deleted as { meta?: { changes?: number } }).meta?.changes ?? 0,
  });
}
