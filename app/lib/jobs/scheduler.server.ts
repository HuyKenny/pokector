/**
 * Cron tick router. Production crons (see wrangler.jsonc):
 *   - every 5 minutes ("star-slash-5") → process due jobs from the D1 job queue
 *   - "17 5 * * *" → daily orchestrator: enqueue catalog sync, price history,
 *     snapshots, alerts, retention — then process a first batch
 *
 * The job queue implementation (claiming with lease, retries, recovery) arrives
 * with the database schema in Phase 4; this router is the final wiring.
 */

import { log } from "../log.server";

const DAILY_ORCHESTRATOR_CRON = "17 5 * * *";

export async function runScheduledTick(cron: string, env: Env): Promise<void> {
  if (cron === DAILY_ORCHESTRATOR_CRON) {
    await enqueueDailyJobs(env);
  }
  await runJobBatch(env);
}

function enqueueDailyJobs(env: Env): Promise<void> {
  // Implemented in Phase 4 together with the sync_jobs schema.
  log.debug("jobs.daily.noop", { environment: env.ENVIRONMENT });
  return Promise.resolve();
}

export function runJobBatch(env: Env): Promise<void> {
  // Implemented in Phase 4 together with the sync_jobs schema.
  log.debug("jobs.batch.noop", { environment: env.ENVIRONMENT });
  return Promise.resolve();
}
