/**
 * Cron tick router + job dispatcher. Production crons (see wrangler.jsonc):
 *   - every 5 minutes → process ONE due job (fresh CPU budget per invocation;
 *     continuation is chained through queue wake-ups)
 *   - "17 5 * * *" → daily orchestrator: price history, snapshots, alerts,
 *     retention and the full catalog sync every day (see
 *     CATALOG_SYNC_INTERVAL_MS — the catalog is the dominant D1 write cost)
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
import { handleEbayGradedSeed } from "./handlers/ebay-seed.server";
import { handlePortfolioSnapshots } from "./handlers/portfolio.server";
import {
  handleRiftboundCatalogCardsPage,
  handleRiftboundCatalogSets,
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
  riftbound_catalog_sets: handleRiftboundCatalogSets,
  riftbound_catalog_cards_page: handleRiftboundCatalogCardsPage,
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

  // Riftbound catalog + prices (JustTCG) — small catalog, safe to refresh daily.
  // Idempotent per day; the sets job chains its card pages via wake-ups.
  if (env.JUSTTCG_API_KEY) {
    await enqueueJob(db, {
      type: "riftbound_catalog_sets",
      idempotencyKey: `riftbound:auto:${today}`,
      runAfter: new Date(Date.now() + 60 * 1000),
    });
  }

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
    const retryable = error instanceof PtcgApiError ? error.retryable : true;
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
