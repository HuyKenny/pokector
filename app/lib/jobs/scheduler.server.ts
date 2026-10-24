/**
 * Cron tick router + job dispatcher. Production has ONE cron (see wrangler.jsonc,
 * daily only since 2026-10-22):
 *   - "17 5 * * *" → daily orchestrator: TCGplayer prices (TCGCSV), price
 *     history, snapshots, alerts, retention; the full catalog sync ~weekly (see
 *     CATALOG_SYNC_INTERVAL_MS — the catalog is the dominant D1 write cost)
 * Each invocation processes ONE job; the rest chain through queue wake-ups, and
 * jobs scheduled for later get a delayed wake-up (see nextJobDueAt).
 */

import { handleAutumnSync } from "./handlers/autumn-sync.server";
import { eq, sql } from "drizzle-orm";

import { pruneExpiredCounters } from "../counters.server";
import { pruneExpiredAuthKv } from "../auth/kv-store.server";
import { pruneExpiredEbayCache } from "../affiliate/ebay-api.server";
import { createDb, schema } from "../db/index.server";
import { log } from "../log.server";
import {
  handleCatalogCardsPage,
  handleCatalogSets,
  handlePriceHistoryRecord,
  handleRetentionAggregate,
} from "./handlers/catalog.server";
import { handleImportApply } from "../csv/import.server";
import { handleAlertsEvaluate } from "./handlers/alerts.server";
import { handleTcgdexPricesBatch } from "./handlers/tcgdex.server";
import { handleTcgcsvPricesSet, handleTcgcsvPricesSets } from "./handlers/tcgcsv.server";
import { handleEbayGradedSeed } from "./handlers/ebay-seed.server";
import { handlePortfolioSnapshots } from "./handlers/portfolio.server";
import {
  handleRiftboundCatalogCardsPage,
  handleRiftboundCatalogSets,
  handleRiftboundTcgcsvSet,
  handleRiftboundTcgcsvSets,
} from "./handlers/riftbound.server";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  hasDueJobs,
  nextJobDueAt,
  wakeUp,
  type SyncJob,
  type SyncJobType,
} from "./queue.server";
import { PtcgApiError } from "../ptcg/client.server";
import { TcgcsvError } from "../tcgcsv/client.server";
import { TcgdexError } from "../tcgdex/client.server";

const DAILY_ORCHESTRATOR_CRON = "17 5 * * *";

/** Minimum age of the last full catalog sync before a new one is enqueued.
 * Back to weekly (owner, 2026-10-02: Pokector does not need frequent refreshes;
 * the account should fit the D1 free limits). A run is ~120k row writes — above the
 * free 100k/day — so it must not run daily. 6.5 days so the daily 05:17 tick catches it. */
const CATALOG_SYNC_INTERVAL_MS = 6.5 * 24 * 60 * 60 * 1000;

type JobHandler = (job: SyncJob, env: Env) => Promise<void>;

/** Later phases register snapshots/alerts/import handlers here. */
const HANDLERS: Partial<Record<SyncJobType, JobHandler>> = {
  autumn_sync: handleAutumnSync,
  catalog_sets: handleCatalogSets,
  catalog_cards_page: handleCatalogCardsPage,
  price_history_record: handlePriceHistoryRecord,
  retention_aggregate: handleRetentionAggregate,
  portfolio_snapshots: handlePortfolioSnapshots,
  alerts_evaluate: handleAlertsEvaluate,
  import_apply: handleImportApply,
  ebay_graded_seed: handleEbayGradedSeed,
  tcgdex_prices_batch: handleTcgdexPricesBatch,
  riftbound_catalog_sets: handleRiftboundCatalogSets,
  riftbound_catalog_cards_page: handleRiftboundCatalogCardsPage,
  riftbound_tcgcsv_sets: handleRiftboundTcgcsvSets,
  riftbound_tcgcsv_set: handleRiftboundTcgcsvSet,
  tcgcsv_prices_sets: handleTcgcsvPricesSets,
  tcgcsv_prices_set: handleTcgcsvPricesSet,
};

export function registerJobHandler(type: SyncJobType, handler: JobHandler): void {
  HANDLERS[type] = handler;
}

export async function runScheduledTick(cron: string, env: Env): Promise<void> {
  if (cron === DAILY_ORCHESTRATOR_CRON) {
    await enqueueDailyJobs(env);
  }
  await runJobBatch(env);
}

/** Idempotent per calendar day (idempotency keys include the date). */
export async function enqueueDailyJobs(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const today = new Date().toISOString().slice(0, 10);

  // Housekeeping: drop expired rate-limit/budget counters + Better Auth
  // secondary-storage rows (sessions/verification/rate-limit) — both tiny tables.
  try {
    await pruneExpiredCounters(db);
    await pruneExpiredAuthKv(db);
    await pruneExpiredEbayCache(db);
  } catch (error) {
    log.warn("jobs.daily.counter_prune_failed", { error: String(error) });
  }

  // Full catalog sync runs ~weekly, not daily (owner: weekly is enough,
  // 2026-07-17) — it's the dominant D1 write cost (~82k rows/run). The rest of
  // this orchestrator stays daily (cheap / delta-only). Gate on the age of the
  // most recent full-sync run (any status): this enforces the weekly cadence,
  // prevents overlap with an in-flight run, and survives missed cron ticks.
  if (env.POKEMON_TCG_API_KEY) {
    const [lastRun] = await db
      .select({ startedAt: schema.syncRuns.startedAt })
      .from(schema.syncRuns)
      .where(eq(schema.syncRuns.kind, "catalog_full"))
      .orderBy(sql`${schema.syncRuns.startedAt} DESC`)
      .limit(1);
    const dueForSync =
      !lastRun || lastRun.startedAt.getTime() < Date.now() - CATALOG_SYNC_INTERVAL_MS;
    if (dueForSync) {
      await enqueueJob(db, {
        type: "catalog_sets",
        payload: { kind: "catalog_full" },
        idempotencyKey: `catalog:auto:${today}`,
      });
    } else {
      log.info("jobs.daily.sync_skipped_weekly", { environment: env.ENVIRONMENT });
    }
  } else {
    log.warn("jobs.daily.sync_disabled_no_key", { environment: env.ENVIRONMENT });
  }

  // Daily TCGplayer prices (TCGCSV, no key). Ahead of the history snapshot (+3 h);
  // each set job also records its own history, so a late chain loses nothing.
  await enqueueJob(db, {
    type: "tcgcsv_prices_sets",
    idempotencyKey: `tcgcsv:auto:${today}`,
    runAfter: new Date(Date.now() + 2 * 60 * 1000),
  });

  // Cardmarket EUR prices (TCGdex, rolling ~1,200 cards/day). Starts after the
  // TCGplayer chain; each batch enqueues the next one.
  await enqueueJob(db, {
    type: "tcgdex_prices_batch",
    payload: { day: today, n: 0 },
    idempotencyKey: `tcgdex:${today}:0`,
    runAfter: new Date(Date.now() + 5 * 60 * 1000),
  });

  await enqueueJob(db, {
    type: "price_history_record",
    idempotencyKey: `history:auto:${today}`,
    // After the catalog refresh has had time to land.
    runAfter: new Date(Date.now() + 3 * 60 * 60 * 1000),
  });
  await enqueueJob(db, {
    type: "retention_aggregate",
    idempotencyKey: `retention:auto:${today}`,
    runAfter: new Date(Date.now() + 4 * 60 * 60 * 1000),
  });
  for (const type of ["portfolio_snapshots", "alerts_evaluate"] as const) {
    if (HANDLERS[type]) {
      await enqueueJob(db, {
        type,
        idempotencyKey: `${type}:auto:${today}`,
        runAfter: new Date(Date.now() + 3.5 * 60 * 60 * 1000),
      });
    }
  }

  // Riftbound catalog + prices (TCGCSV, no key; ~30 requests). Once per TCGCSV
  // build; the sets job chains one job per TCGplayer group via wake-ups.
  await enqueueJob(db, {
    type: "riftbound_tcgcsv_sets",
    idempotencyKey: `riftbound-tcgcsv:auto:${today}`,
    runAfter: new Date(Date.now() + 60 * 1000),
  });

  // Proactively seed eBay graded (PSA) prices for the most valuable cards so PSA
  // history builds without needing card views. Before price_history_record (+3h)
  // so the seeded prices are captured in the same day's graded-history snapshot.
  if (env.EBAY_APP_ID && env.EBAY_CERT_ID) {
    await enqueueJob(db, {
      type: "ebay_graded_seed",
      idempotencyKey: `ebay-seed:auto:${today}`,
      runAfter: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });
  }
}

/**
 * Process exactly ONE job per invocation — each queue delivery / cron tick has
 * its own CPU budget on the Free plan. If more work remains, chain a wake-up.
 */
export async function runJobBatch(env: Env): Promise<void> {
  const db = createDb(env.DB);
  const job = await claimNextJob(db);
  if (!job) return;

  const handler = HANDLERS[job.type];
  const startedAt = Date.now();
  try {
    if (!handler) {
      throw new Error(`No handler registered for job type "${job.type}"`);
    }
    await handler(job, env);
    await completeJob(db, job.id);
    log.info("job.completed", {
      jobId: job.id,
      type: job.type,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const retryable =
      error instanceof PtcgApiError || error instanceof TcgcsvError || error instanceof TcgdexError
        ? error.retryable
        : true;
    await failJob(db, job, error, retryable);
  }

  if (await hasDueJobs(db)) {
    await wakeUp(env, "more_jobs_due");
    return;
  }
  const dueAt = await nextJobDueAt(db);
  if (dueAt) {
    // +5 s so the delivery lands after runAfter, not a hair before it.
    await wakeUp(env, "next_job_scheduled", (dueAt.getTime() - Date.now()) / 1000 + 5);
  }
}
