/**
 * Autumn entitlement sync job.
 *
 * The webhook acks fast and enqueues this, keyed by the Autumn event id (queue
 * dedupe = idempotency). Here we read the authoritative customer state from
 * Autumn and write the D1 entitlement mirror. Idempotent: re-running produces
 * the same row.
 */

import { syncFromAutumn } from "../../billing/autumn.server";
import { createDb } from "../../db/index.server";
import { log } from "../../log.server";
import { parsePayload, type SyncJob } from "../queue.server";

interface AutumnSyncPayload {
  /** Autumn customer id, which is our user id. */
  userId?: string;
  eventType?: string;
}

export async function handleAutumnSync(job: SyncJob, env: Env): Promise<void> {
  const payload = parsePayload<AutumnSyncPayload>(job);
  if (!payload.userId) {
    log.info("autumn.sync_skip_no_customer", { eventType: payload.eventType });
    return;
  }

  const db = createDb(env.DB);
  const ent = await syncFromAutumn(db, env, payload.userId);

  log.info("autumn.synced", {
    eventType: payload.eventType,
    planId: ent.planId,
    premium: ent.premium,
  });
}
