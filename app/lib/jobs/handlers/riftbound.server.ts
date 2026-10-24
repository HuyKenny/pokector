/**
 * Riftbound catalog + prices sync (JustTCG → D1). Parallel to the Pokémon
 * catalog handlers: one page per job (Workers Free CPU budget), chained via
 * queue wake-ups, idempotent upserts into the riftbound_* tables. Read-only
 * catalog MVP — no collection/portfolio coupling.
 */
import { createDb, schema, type Database } from "../../db/index.server";
import { JustTcgClient, RIFTBOUND_CARDS_PAGE_SIZE } from "../../justtcg/client.server";
import { log } from "../../log.server";
import {
  normalizeRiftboundCard,
  normalizeRiftboundSet,
  resolveRiftboundGameId,
} from "../../riftbound/normalize";
import { enqueueJob, parsePayload, wakeUp, type SyncJob } from "../queue.server";

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
