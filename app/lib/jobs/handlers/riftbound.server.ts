/**
 * Riftbound catalog + prices sync → D1. Parallel to the Pokémon catalog
 * handlers: small jobs chained via queue wake-ups, idempotent upserts into the
 * riftbound_* tables. Read-only catalog MVP — no collection/portfolio coupling.
 *
 * Daily source is TCGCSV (riftbound_tcgcsv_sets → one riftbound_tcgcsv_set per
 * TCGplayer group, docs/DECISIONS.md D30). The JustTCG handlers below stay for a
 * manual run; their free tier (100 requests/day) is too small for a daily sync.
 */
import { eq, sql } from "drizzle-orm";

import { getCached, setCached } from "../../cache/catalog-cache.server";
import { createDb, schema, type Database } from "../../db/index.server";
import { JustTcgClient, RIFTBOUND_CARDS_PAGE_SIZE } from "../../justtcg/client.server";
import { log } from "../../log.server";
import {
  normalizeRiftboundCard,
  normalizeRiftboundSet,
  resolveRiftboundGameId,
} from "../../riftbound/normalize";
import {
  riftboundCardFromProduct,
  riftboundPriceRows,
  riftboundSetFromGroup,
} from "../../riftbound/tcgcsv";
import {
  getBuildDate,
  listGroups,
  listPrices,
  listProducts,
  RIFTBOUND_CATEGORY,
} from "../../tcgcsv/client.server";
import {
  addJobLog,
  enqueueJob,
  enqueueJobs,
  parsePayload,
  wakeUp,
  type SyncJob,
} from "../queue.server";

type BatchStatement = Parameters<Database["batch"]>[0][number];

async function batchStatements(db: Database, statements: BatchStatement[]) {
  const CHUNK = 20;
  for (let i = 0; i < statements.length; i += CHUNK) {
    await db.batch(statements.slice(i, i + CHUNK) as [BatchStatement, ...BatchStatement[]]);
  }
}

// ── riftbound_catalog_sets ───────────────────────────────────────────────────

export async function handleRiftboundCatalogSets(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const client = JustTcgClient.fromEnv(env);
  const syncedAt = new Date();

  const gameId = resolveRiftboundGameId(await client.listGames());
  if (!gameId) {
    log.warn("riftbound.sync.game_not_found", { environment: env.ENVIRONMENT });
    return; // JustTCG doesn't expose Riftbound yet — nothing to sync.
  }

  const rawSets = await client.listSets(gameId);
  const sets = rawSets
    .map((r) => normalizeRiftboundSet(r, syncedAt, gameId))
    .filter((s): s is NonNullable<typeof s> => s !== null);

  if (sets.length > 0) {
    await batchStatements(
      db,
      sets.map((s) =>
        db
          .insert(schema.riftboundSets)
          .values(s)
          .onConflictDoUpdate({
            target: schema.riftboundSets.id,
            set: {
              slug: s.slug,
              name: s.name,
              code: s.code,
              releaseDate: s.releaseDate,
              imageUrl: s.imageUrl,
              syncedAt,
              active: true,
            },
          }),
      ),
    );
  }

  await enqueueJob(db, {
    type: "riftbound_catalog_cards_page",
    payload: { gameId, offset: 0 },
    idempotencyKey: `riftbound-cards:${job.id}:0`,
  });
  await wakeUp(env, "riftbound_cards_page");
  log.info("riftbound.sync.sets_done", { sets: sets.length, gameId });
}

// ── riftbound_catalog_cards_page ─────────────────────────────────────────────

interface CardsPagePayload {
  gameId: string;
  offset: number;
}

export async function handleRiftboundCatalogCardsPage(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const client = JustTcgClient.fromEnv(env);
  const syncedAt = new Date();
  const today = new Date().toISOString().slice(0, 10);
  const { gameId, offset } = parsePayload<CardsPagePayload>(job);

  const page = await client.listCards({ game: gameId, offset, limit: RIFTBOUND_CARDS_PAGE_SIZE });

  // FK guard: only keep cards whose set was already upserted.
  const knownSetIds = new Set(
    (await db.select({ id: schema.riftboundSets.id }).from(schema.riftboundSets)).map((r) => r.id),
  );

  const normalized = page.data
    .map((r) => normalizeRiftboundCard(r, syncedAt, gameId))
    .filter((n): n is NonNullable<typeof n> => n !== null && knownSetIds.has(n.card.setId));

  const statements: BatchStatement[] = [];
  for (const { card, prices } of normalized) {
    statements.push(
      db
        .insert(schema.riftboundCards)
        .values(card)
        .onConflictDoUpdate({
          target: schema.riftboundCards.id,
          set: {
            slug: card.slug,
            setId: card.setId,
            name: card.name,
            nameNormalized: card.nameNormalized,
            number: card.number,
            numberSort: card.numberSort,
            rarity: card.rarity,
            imageSmallUrl: card.imageSmallUrl,
            imageLargeUrl: card.imageLargeUrl,
            tcgplayerId: card.tcgplayerId,
            searchText: card.searchText,
            sourceUpdatedAt: card.sourceUpdatedAt,
            syncedAt,
            active: true,
          },
        }),
    );
    for (const p of prices) {
      statements.push(
        db
          .insert(schema.riftboundPricesCurrent)
          .values({ cardId: card.id, observedAt: syncedAt, ...p })
          .onConflictDoUpdate({
            target: [
              schema.riftboundPricesCurrent.cardId,
              schema.riftboundPricesCurrent.source,
              schema.riftboundPricesCurrent.variant,
              schema.riftboundPricesCurrent.currency,
            ],
            set: {
              normalizedPriceMinor: p.normalizedPriceMinor,
              lowMinor: p.lowMinor,
              midMinor: p.midMinor,
              highMinor: p.highMinor,
              marketMinor: p.marketMinor,
              sourceUpdatedAt: p.sourceUpdatedAt,
              observedAt: syncedAt,
            },
          }),
      );
      // One history snapshot per (card, source, variant, currency, day).
      statements.push(
        db
          .insert(schema.riftboundPriceHistory)
          .values({
            cardId: card.id,
            source: p.source,
            variant: p.variant,
            currency: p.currency,
            priceMinor: p.normalizedPriceMinor,
            recordedDate: today,
            observedAt: syncedAt,
          })
          .onConflictDoNothing(),
      );
    }
  }
  await batchStatements(db, statements);

  if (page.hasMore && page.data.length > 0) {
    const nextOffset = offset + RIFTBOUND_CARDS_PAGE_SIZE;
    await enqueueJob(db, {
      type: "riftbound_catalog_cards_page",
      payload: { gameId, offset: nextOffset },
      idempotencyKey: `riftbound-cards:${job.id}:${nextOffset}`,
    });
    await wakeUp(env, "riftbound_cards_page");
  } else {
    log.info("riftbound.sync.cards_done", { lastOffset: offset });
  }
}

// ── riftbound_tcgcsv_sets ────────────────────────────────────────────────────

const DAY_SEC = 24 * 60 * 60;
const TCGCSV_BUILD_KEY = "tcgcsv:riftbound:build";

export async function handleRiftboundTcgcsvSets(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const buildDate = await getBuildDate();
  if ((await getCached<string>(db, TCGCSV_BUILD_KEY)) === buildDate) {
    await addJobLog(db, job.id, "info", "riftbound.tcgcsv.build_already_synced", { buildDate });
    return;
  }

  const syncedAt = new Date();
  const groups = await listGroups(RIFTBOUND_CATEGORY);
  const sets = groups.map((g) => riftboundSetFromGroup(g, syncedAt));
  const t = schema.riftboundSets;
  await batchStatements(
    db,
    sets.map((s) =>
      db
        .insert(t)
        .values(s)
        .onConflictDoUpdate({
          target: t.id,
          set: {
            code: s.code,
            releaseDate: sql`coalesce(${t.releaseDate}, excluded.release_date)`,
            syncedAt,
            active: true,
          },
        }),
    ),
  );

  const inserted = await enqueueJobs(
    db,
    groups.map((g, i) => ({
      type: "riftbound_tcgcsv_set" as const,
      payload: { groupId: g.groupId, setId: sets[i].id, buildDate },
      idempotencyKey: `tcgcsv-rb:${buildDate}:${g.groupId}`,
    })),
  );
  await setCached(db, TCGCSV_BUILD_KEY, buildDate, 3 * DAY_SEC);
  await addJobLog(db, job.id, "info", "riftbound.tcgcsv.sets_enqueued", {
    buildDate,
    groups: groups.length,
    inserted,
  });
  await wakeUp(env, "riftbound_tcgcsv_sets_done");
}

// ── riftbound_tcgcsv_set ─────────────────────────────────────────────────────

export interface RiftboundTcgcsvSetPayload {
  groupId: number;
  setId: string;
  buildDate: string;
}

export async function handleRiftboundTcgcsvSet(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const { groupId, setId, buildDate } = parsePayload<RiftboundTcgcsvSetPayload>(job);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const [set] = await db
    .select({
      id: schema.riftboundSets.id,
      slug: schema.riftboundSets.slug,
      name: schema.riftboundSets.name,
    })
    .from(schema.riftboundSets)
    .where(eq(schema.riftboundSets.id, setId));
  if (!set) return;

  const [products, prices] = await Promise.all([
    listProducts(groupId, RIFTBOUND_CATEGORY),
    listPrices(groupId, RIFTBOUND_CATEGORY),
  ]);

  // Cards are matched by TCGplayer product id across the whole catalog: a few
  // JustTCG-era rows sit in a different set than TCGplayer's group.
  const existing = await db
    .select({
      id: schema.riftboundCards.id,
      slug: schema.riftboundCards.slug,
      tcgplayerId: schema.riftboundCards.tcgplayerId,
    })
    .from(schema.riftboundCards);
  const cardByProduct = new Map<string, string>();
  for (const row of existing) if (row.tcgplayerId) cardByProduct.set(row.tcgplayerId, row.id);
  const taken = {
    ids: new Set(existing.map((r) => r.id)),
    slugs: new Set(existing.map((r) => r.slug)),
  };

  const statements: BatchStatement[] = [];
  let added = 0;
  for (const product of products) {
    if (cardByProduct.has(String(product.productId))) continue;
    const card = riftboundCardFromProduct(product, set, taken, now);
    cardByProduct.set(String(product.productId), card.id);
    statements.push(db.insert(schema.riftboundCards).values(card).onConflictDoNothing());
    added++;
  }

  const pc = schema.riftboundPricesCurrent;
  const ph = schema.riftboundPriceHistory;
  let priced = 0;
  for (const [productId, rows] of riftboundPriceRows(prices, buildDate)) {
    const cardId = cardByProduct.get(String(productId));
    if (!cardId) continue;
    priced++;
    for (const p of rows) {
      statements.push(
        db
          .insert(pc)
          .values({ cardId, observedAt: now, ...p })
          .onConflictDoUpdate({
            target: [pc.cardId, pc.source, pc.variant, pc.currency],
            set: {
              normalizedPriceMinor: p.normalizedPriceMinor,
              lowMinor: p.lowMinor,
              midMinor: p.midMinor,
              highMinor: p.highMinor,
              marketMinor: p.marketMinor,
              sourceUpdatedAt: p.sourceUpdatedAt,
              observedAt: now,
            },
            // Never go back in time. JustTCG stored epoch seconds ("17…"), which
            // sort below ISO dates, so the first TCGCSV run replaces them.
            setWhere: sql`${pc.sourceUpdatedAt} IS NULL OR ${pc.sourceUpdatedAt} <= excluded.source_updated_at`,
          }),
      );
      statements.push(
        db
          .insert(ph)
          .values({
            cardId,
            source: p.source,
            variant: p.variant,
            currency: p.currency,
            priceMinor: p.normalizedPriceMinor,
            recordedDate: today,
            observedAt: now,
          })
          .onConflictDoUpdate({
            target: [ph.cardId, ph.source, ph.variant, ph.currency, ph.recordedDate],
            set: { priceMinor: p.normalizedPriceMinor, observedAt: now },
          }),
      );
    }
  }
  await batchStatements(db, statements);

  await addJobLog(db, job.id, "info", "riftbound.tcgcsv.set_synced", {
    setId,
    groupId,
    buildDate,
    products: products.length,
    added,
    priced,
  });
  log.info("riftbound.tcgcsv.set_synced", { setId, added, priced });
  await wakeUp(env, `riftbound_tcgcsv_${groupId}_done`);
}
