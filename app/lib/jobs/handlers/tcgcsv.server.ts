/**
 * Daily TCGplayer prices from TCGCSV (docs/DECISIONS.md D29). The Pokémon TCG
 * API stopped refreshing prices (last TCGplayer update 2026-10-15) and has never
 * priced the 2026 sets, so this is now the primary TCGplayer feed; the weekly
 * PTCG sync still supplies the catalog and only writes a price when it is not
 * older than the one stored.
 *
 *   tcgcsv_prices_sets — once per TCGCSV build: map sets → TCGplayer groups and
 *                        enqueue one tcgcsv_prices_set job per mapped set
 *   tcgcsv_prices_set  — fetch the set's prices (+ products when the cached
 *                        card→product map is stale), upsert, record history
 */

import { and, eq, sql } from "drizzle-orm";

import { getCached, setCached } from "../../cache/catalog-cache.server";
import { createDb, schema, type Database } from "../../db/index.server";
import { log } from "../../log.server";
import { getBuildDate, listGroups, listPrices, listProducts } from "../../tcgcsv/client.server";
import { buildPriceRows, matchCardsToProducts, matchSetsToGroups } from "../../tcgcsv/match";
import { addJobLog, enqueueJobs, parsePayload, wakeUp, type SyncJob } from "../queue.server";
import { recordHistoryForCards } from "./catalog.server";

type BatchStatement = Parameters<Database["batch"]>[0][number];

const DAY_SEC = 24 * 60 * 60;
const BUILD_KEY = "tcgcsv:build";
/** Product lists are ~80 % of the bandwidth and rarely change: refetch weekly,
 * daily for sets released in the last 45 days (TCGplayer still adds products). */
const PRODUCT_MAP_TTL_SEC = 7 * DAY_SEC;
const NEW_SET_PRODUCT_MAP_TTL_SEC = DAY_SEC - 60 * 60;
const NEW_SET_WINDOW_MS = 45 * DAY_SEC * 1000;
/** Unchanged prices are rewritten only when the stored date is this old, so the
 * shown "updated" date stays recent without rewriting ~30k identical rows daily. */
const UNCHANGED_REFRESH_DAYS = 3;
/** D1 caps bound parameters per statement at 100. */
const ID_CHUNK = 90;

// ── tcgcsv_prices_sets ───────────────────────────────────────────────────────

export async function handleTcgcsvPricesSets(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const buildDate = await getBuildDate();
  if ((await getCached<string>(db, BUILD_KEY)) === buildDate) {
    await addJobLog(db, job.id, "info", "tcgcsv.build_already_synced", { buildDate });
    return;
  }

  const groups = await listGroups();
  const sets = await db
    .select({ id: schema.pokemonSets.id, name: schema.pokemonSets.name })
    .from(schema.pokemonSets)
    .where(eq(schema.pokemonSets.active, true));
  const mapping = matchSetsToGroups(sets, groups);

  const inserted = await enqueueJobs(
    db,
    [...mapping].map(([setId, groupIds]) => ({
      type: "tcgcsv_prices_set" as const,
      payload: { setId, groupIds, buildDate },
      idempotencyKey: `tcgcsv:${buildDate}:${setId}`,
    })),
  );
  await setCached(db, BUILD_KEY, buildDate, 3 * DAY_SEC);

  const unmapped = sets.filter((s) => !mapping.has(s.id)).map((s) => s.id);
  await addJobLog(db, job.id, "info", "tcgcsv.sets_enqueued", {
    buildDate,
    groups: groups.length,
    mapped: mapping.size,
    inserted,
    unmapped,
  });
  await wakeUp(env, "tcgcsv_sets_done");
}

// ── tcgcsv_prices_set ────────────────────────────────────────────────────────

export interface TcgcsvPricesSetPayload {
  setId: string;
  groupIds: number[];
  buildDate: string;
}

interface ProductMap {
  groupIds: number[];
  cardCount: number;
  cards: Record<string, number>;
}

export async function handleTcgcsvPricesSet(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const { setId, groupIds, buildDate } = parsePayload<TcgcsvPricesSetPayload>(job);
  const now = new Date();

  const [set] = await db
    .select({ releaseDate: schema.pokemonSets.releaseDate })
    .from(schema.pokemonSets)
    .where(eq(schema.pokemonSets.id, setId));
  const cards = await db
    .select({
      id: schema.pokemonCards.id,
      number: schema.pokemonCards.number,
      name: schema.pokemonCards.name,
    })
    .from(schema.pokemonCards)
    .where(and(eq(schema.pokemonCards.setId, setId), eq(schema.pokemonCards.active, true)));
  if (cards.length === 0) return;

  const mapKey = `tcgcsv:products:${setId}`;
  let productMap = await getCached<ProductMap>(db, mapKey);
  const stale =
    !productMap ||
    productMap.cardCount !== cards.length ||
    productMap.groupIds.join(",") !== groupIds.join(",");
  if (stale) {
    const products = (await Promise.all(groupIds.map((id) => listProducts(id)))).flat();
    productMap = {
      groupIds,
      cardCount: cards.length,
      cards: matchCardsToProducts(cards, products),
    };
    const isNew =
      set?.releaseDate != null && Date.parse(set.releaseDate) > now.getTime() - NEW_SET_WINDOW_MS;
    await setCached(
      db,
      mapKey,
      productMap,
      isNew ? NEW_SET_PRODUCT_MAP_TTL_SEC : PRODUCT_MAP_TTL_SEC,
    );
  }
  const map = productMap as ProductMap;

  const prices = (await Promise.all(groupIds.map((id) => listPrices(id)))).flat();
  const rows = buildPriceRows(map.cards, prices, buildDate);

  const t = schema.cardPricesCurrent;
  const statements: BatchStatement[] = rows.map(({ cardId, price }) =>
    db
      .insert(t)
      .values({ cardId, observedAt: now, ...price })
      .onConflictDoUpdate({
        target: [t.cardId, t.source, t.variant, t.currency],
        set: {
          normalizedPriceMinor: price.normalizedPriceMinor,
          lowMinor: price.lowMinor,
          midMinor: price.midMinor,
          highMinor: price.highMinor,
          marketMinor: price.marketMinor,
          directLowMinor: price.directLowMinor,
          trendMinor: null,
          averageSellMinor: null,
          sourceUpdatedAt: price.sourceUpdatedAt,
          observedAt: now,
        },
        // Never go back in time; skip identical rows unless their date is old.
        setWhere: sql`(${t.sourceUpdatedAt} IS NULL OR ${t.sourceUpdatedAt} <= excluded.source_updated_at)
          AND (
            ${t.normalizedPriceMinor} IS NOT excluded.normalized_price_minor
            OR ${t.lowMinor} IS NOT excluded.low_minor
            OR ${t.midMinor} IS NOT excluded.mid_minor
            OR ${t.highMinor} IS NOT excluded.high_minor
            OR ${t.marketMinor} IS NOT excluded.market_minor
            OR ${t.directLowMinor} IS NOT excluded.direct_low_minor
            OR ${t.sourceUpdatedAt} IS NULL
            OR ${t.sourceUpdatedAt} <= date(excluded.source_updated_at, ${`-${UNCHANGED_REFRESH_DAYS} days`})
          )`,
      }),
  );
  for (let i = 0; i < statements.length; i += 20) {
    const chunk = statements.slice(i, i + 20);
    await db.batch(chunk as [BatchStatement, ...BatchStatement[]]);
  }

  const pricedCardIds = [...new Set(rows.map((r) => r.cardId))];
  for (let i = 0; i < pricedCardIds.length; i += ID_CHUNK) {
    await recordHistoryForCards(db, pricedCardIds.slice(i, i + ID_CHUNK), now, {
      replaceToday: true,
    });
  }

  await addJobLog(db, job.id, "info", "tcgcsv.set_synced", {
    setId,
    buildDate,
    cards: cards.length,
    matched: Object.keys(map.cards).length,
    priced: pricedCardIds.length,
    rows: rows.length,
    productsFetched: stale,
  });
  log.info("tcgcsv.set_synced", { setId, priced: pricedCardIds.length, rows: rows.length });
  await wakeUp(env, `tcgcsv_${setId}_done`);
}
