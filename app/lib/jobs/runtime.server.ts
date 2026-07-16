/**
 * Entry points invoked by the Worker's `scheduled` and `queue` handlers.
 *
 * The D1-backed job queue (sync_jobs table) is the single source of truth; queue
 * messages are only wake-up signals (see docs/DECISIONS.md D4). Job handlers are
 * registered by the sync/import/snapshot modules (Phase 4+). Until those phases
 * land, these entry points log the trigger and finish — the wiring is final.
 */

import { log } from "../log.server";

/** Message shape carried by JOBS_QUEUE wake-up signals. */
export interface JobWakeupMessage {
  kind: "wakeup";
  reason: string;
}

export async function onScheduled(
  controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const startedAt = Date.now();
  log.info("cron.tick", { environment: env.ENVIRONMENT, cron: controller.cron });
  const { runScheduledTick } = await import("./scheduler.server");
  await runScheduledTick(controller.cron, env);
  log.info("cron.done", {
    environment: env.ENVIRONMENT,
    cron: controller.cron,
    durationMs: Date.now() - startedAt,
  });
}

export async function onQueueBatch(
  batch: MessageBatch<unknown>,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  log.info("queue.batch", { environment: env.ENVIRONMENT, size: batch.messages.length });
  const { runJobBatch } = await import("./scheduler.server");
  await runJobBatch(env);
  // Wake-up signals carry no state; job state lives in D1, so acking is always safe.
  batch.ackAll();
}
