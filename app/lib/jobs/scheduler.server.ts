/**
 * Cron tick router + job dispatcher. Production crons (see wrangler.jsonc):
 *   - every 5 minutes → process ONE due job (fresh CPU budget per invocation;
 *     continuation is chained through queue wake-ups)
 *   - "17 5 * * *" → daily orchestrator: enqueue catalog sync, price history,
 *     snapshots, alerts, retention
 */

import { and, eq, gte } from "drizzle-orm";

import { createDb, schema } from "../db/index.server";
import { log } from "../log.server";
import {
  handleCatalogCardsPage,
  handleCatalogSets,
  handlePriceHistoryRecord,
  handleRetentionAggregate,
} from "./handlers/catalog.server";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  hasDueJobs,
  wakeUp,
  type SyncJob,
  type SyncJobType,
} from "./queue.server";
import { PtcgApiError } from "../ptcg/client.server";

const DAILY_ORCHESTRATOR_CRON = "17 5 * * *";

type JobHandler = (job: SyncJob, env: Env) => Promise<void>;

/** Later phases register snapshots/alerts/import handlers here. */
const HANDLERS: Partial<Record<SyncJobType, JobHandler>> = {
  catalog_sets: handleCatalogSets,
  catalog_cards_page: handleCatalogCardsPage,
  price_history_record: handlePriceHistoryRecord,
  retention_aggregate: handleRetentionAggregate,
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

  // Full catalog sync only when the PTCG API key exists AND no run is in flight.
  if (env.POKEMON_TCG_API_KEY) {
    const active = await db
      .select({ id: schema.syncRuns.id })
      .from(schema.syncRuns)
      .where(
        and(
          eq(schema.syncRuns.status, "running"),
          // Distributed-lock-with-expiry equivalent: a run older than 12 h is
          // considered abandoned and does not block a fresh daily sync.
          gte(schema.syncRuns.startedAt, new Date(Date.now() - 12 * 60 * 60 * 1000)),
        ),
      )
      .limit(1);
    if (active.length === 0) {
      await enqueueJob(db, {
        type: "catalog_sets",
        payload: { kind: "catalog_full" },
        idempotencyKey: `catalog:auto:${today}`,
      });
    } else {
      log.warn("jobs.daily.sync_skipped_running", { environment: env.ENVIRONMENT });
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
  }
}
