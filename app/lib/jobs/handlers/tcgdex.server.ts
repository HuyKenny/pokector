/**
 * Cardmarket (EUR) prices from TCGdex (docs/DECISIONS.md D31). The Pokémon TCG
 * API stopped updating its Cardmarket blocks, and TCGdex only serves prices one
 * card per request, so this is a rolling refresh instead of a full daily sync:
 * each day runs BATCHES_PER_DAY chained jobs of BATCH_SIZE cards, picking the
 * cards whose Cardmarket price is oldest (value as tie-break) — the whole
 * catalog cycles in roughly two weeks, the most valuable cards first.
 *
 *   tcgdex_prices_batch — fetch the next BATCH_SIZE cards, upsert EUR rows,
 *                         record history, chain the next batch
 */

import { eq, inArray, sql } from "drizzle-orm";

import { getCached, setCached } from "../../cache/catalog-cache.server";
import { createDb, schema, type Database } from "../../db/index.server";
import { log } from "../../log.server";
import type { CardVariant } from "../../pricing/normalize";
import { getCard, getSet, listSets } from "../../tcgdex/client.server";
import { normalizeCardNumber } from "../../tcgcsv/match";
import { cardIdsByNumber, cardmarketRows, matchSetsToTcgdex } from "../../tcgdex/match";
import { addJobLog, enqueueJob, parsePayload, wakeUp, type SyncJob } from "../queue.server";
import { recordHistoryForCards } from "./catalog.server";

type BatchStatement = Parameters<Database["batch"]>[0][number];

const DAY_SEC = 24 * 60 * 60;
export const TCGDEX_BATCH_SIZE = 40;
export const TCGDEX_BATCHES_PER_DAY = 30;
/** Parallel requests inside one job — polite to a community API. */
const CONCURRENCY = 4;
const SETS_KEY = "tcgdex:sets";
const SET_MAP_TTL_SEC = 14 * DAY_SEC;
/** A card handled today is not picked again today; one TCGdex has no price for
 * (or whose set it does not know) is skipped for a week. */
const SEEN_TTL_SEC = 20 * 60 * 60;
const MISS_TTL_SEC = 7 * DAY_SEC;
const ID_CHUNK = 90;

export interface TcgdexBatchPayload {
  day: string;
  n: number;
}

async function getSetMapping(db: Database): Promise<Record<string, string>> {
  const cachedMapping = await getCached<Record<string, string>>(db, SETS_KEY);
  if (cachedMapping) return cachedMapping;
  const sets = await db
    .select({ id: schema.pokemonSets.id, name: schema.pokemonSets.name })
    .from(schema.pokemonSets)
    .where(eq(schema.pokemonSets.active, true));
  const mapping = matchSetsToTcgdex(sets, await listSets());
  await setCached(db, SETS_KEY, mapping, SET_MAP_TTL_SEC);
  return mapping;
}

async function getCardIdMap(db: Database, tcgdexSetId: string): Promise<Record<string, string>> {
  const key = `tcgdex:set:${tcgdexSetId}`;
  const cachedMap = await getCached<Record<string, string>>(db, key);
  if (cachedMap) return cachedMap;
  const map = cardIdsByNumber((await getSet(tcgdexSetId))?.cards ?? []);
  await setCached(db, key, map, SET_MAP_TTL_SEC);
  return map;
}

/** Run `fn` over `items` with at most `limit` in flight, keeping order. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out = Array.from<R>({ length: items.length });
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function handleTcgdexPricesBatch(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const { day, n } = parsePayload<TcgdexBatchPayload>(job);
  const now = new Date();

  const candidates = await db.all<{ id: string; set_id: string; number: string }>(sql`
    SELECT c.id, c.set_id, c.number
    FROM pokemon_cards c
    WHERE c.active = 1
      AND NOT EXISTS (
        SELECT 1 FROM catalog_cache s
        WHERE s.key = 'tcgdex:seen:' || c.id AND s.expires_at > unixepoch()
      )
    ORDER BY
      COALESCE((SELECT MAX(p.source_updated_at) FROM card_prices_current p
                WHERE p.card_id = c.id AND p.source = 'cardmarket'), '') ASC,
      COALESCE((SELECT MAX(p.normalized_price_minor) FROM card_prices_current p
                WHERE p.card_id = c.id AND p.source = 'tcgplayer'), 0) DESC
    LIMIT ${TCGDEX_BATCH_SIZE}
  `);

  const mapping = await getSetMapping(db);
  // Sequential on purpose: each set's card list is fetched once, then cached.
  const tcgdexIds = new Map<string, string>();
  for (const card of candidates) {
    const tcgdexSetId = mapping[card.set_id];
    if (!tcgdexSetId) continue;
    const id = (await getCardIdMap(db, tcgdexSetId))[normalizeCardNumber(card.number)];
    if (id) tcgdexIds.set(card.id, id);
  }

  const fetched = await mapLimited(
    candidates.filter((c) => tcgdexIds.has(c.id)),
    CONCURRENCY,
    async (card) => ({
      cardId: card.id,
      data: await getCard(tcgdexIds.get(card.id)!),
    }),
  );

  // Variants each card already carries a price for (any source), else "normal".
  const known = new Map<string, Set<CardVariant>>();
  const pc = schema.cardPricesCurrent;
  for (let i = 0; i < fetched.length; i += ID_CHUNK) {
    const ids = fetched.slice(i, i + ID_CHUNK).map((f) => f.cardId);
    const rows = await db
      .select({ cardId: pc.cardId, variant: pc.variant })
      .from(pc)
      .where(inArray(pc.cardId, ids));
    for (const r of rows) known.set(r.cardId, (known.get(r.cardId) ?? new Set()).add(r.variant));
  }

  const statements: BatchStatement[] = [];
  const pricedCardIds: string[] = [];
  const priced = new Set<string>();
  for (const { cardId, data } of fetched) {
    const rows = cardmarketRows(data?.pricing?.cardmarket, [...(known.get(cardId) ?? [])]);
    if (rows.length === 0) continue;
    priced.add(cardId);
    pricedCardIds.push(cardId);
    for (const price of rows) {
      statements.push(
        db
          .insert(pc)
          .values({ cardId, observedAt: now, ...price })
          .onConflictDoUpdate({
            target: [pc.cardId, pc.source, pc.variant, pc.currency],
            set: {
              normalizedPriceMinor: price.normalizedPriceMinor,
              lowMinor: price.lowMinor,
              midMinor: null,
              highMinor: null,
              marketMinor: null,
              directLowMinor: null,
              trendMinor: price.trendMinor,
              averageSellMinor: price.averageSellMinor,
              sourceUpdatedAt: price.sourceUpdatedAt,
              observedAt: now,
            },
            // Never go back in time.
            setWhere: sql`${pc.sourceUpdatedAt} IS NULL OR ${pc.sourceUpdatedAt} <= excluded.source_updated_at`,
          }),
      );
    }
  }

  // Mark every candidate as handled so a card that cannot be updated (no TCGdex
  // price, older date than stored) does not sit at the front of the queue.
  const nowSec = Math.floor(now.getTime() / 1000);
  const marks = candidates.map((card) =>
    db
      .insert(schema.catalogCache)
      .values({
        key: `tcgdex:seen:${card.id}`,
        value: "1",
        expiresAt: nowSec + (priced.has(card.id) ? SEEN_TTL_SEC : MISS_TTL_SEC),
      })
      .onConflictDoUpdate({
        target: schema.catalogCache.key,
        set: {
          value: "1",
          expiresAt: nowSec + (priced.has(card.id) ? SEEN_TTL_SEC : MISS_TTL_SEC),
        },
      }),
  );
  for (const chunk of [statements, marks]) {
    for (let i = 0; i < chunk.length; i += 20) {
      await db.batch(chunk.slice(i, i + 20) as [BatchStatement, ...BatchStatement[]]);
    }
  }
  if (pricedCardIds.length > 0) {
    await recordHistoryForCards(db, pricedCardIds, now, { replaceToday: true });
  }

  await addJobLog(db, job.id, "info", "tcgdex.batch_done", {
    day,
    n,
    picked: candidates.length,
    mapped: tcgdexIds.size,
    priced: pricedCardIds.length,
  });
  log.info("tcgdex.batch_done", { n, picked: candidates.length, priced: pricedCardIds.length });

  if (candidates.length > 0 && n + 1 < TCGDEX_BATCHES_PER_DAY) {
    await enqueueJob(db, {
      type: "tcgdex_prices_batch",
      payload: { day, n: n + 1 },
      idempotencyKey: `tcgdex:${day}:${n + 1}`,
    });
    await wakeUp(env, `tcgdex_batch_${n + 1}`);
  }
}
