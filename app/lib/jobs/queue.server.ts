/**
 * D1-backed job queue (SPEC §15, DECISIONS D4). D1 `sync_jobs` is the single
 * source of truth; Cloudflare Queues messages are only wake-up signals. Claiming
 * uses a lease (`locked_until`) so abandoned jobs recover automatically after
 * expiry. Every handler must be idempotent.
 */

import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { createDb, schema, type Database } from "../db/index.server";
import { log } from "../log.server";
import type { SYNC_JOB_TYPES } from "../db/schema";

export type SyncJobType = (typeof SYNC_JOB_TYPES)[number];
export type SyncJob = typeof schema.syncJobs.$inferSelect;

/** Lease long enough for one API page + upserts, short enough to recover fast. */
const LEASE_MS = 2 * 60 * 1000;
const RETRY_BASE_MS = 60 * 1000;

export interface EnqueueOptions {
  type: SyncJobType;
  payload?: Record<string, unknown>;
  /** At most one open (pending/running) job per key; duplicates are dropped. */
  idempotencyKey?: string;
  runAfter?: Date;
  maxAttempts?: number;
}

export async function enqueueJob(db: Database, options: EnqueueOptions): Promise<string | null> {
  const id = crypto.randomUUID();
  try {
    await db.insert(schema.syncJobs).values({
      id,
      type: options.type,
      status: "pending",
      payloadJson: options.payload ? JSON.stringify(options.payload) : null,
      idempotencyKey: options.idempotencyKey ?? null,
      runAfter: options.runAfter ?? null,
      maxAttempts: options.maxAttempts ?? 5,
    });
    return id;
  } catch (error) {
    // Unique idempotency key conflict → an equivalent job already exists.
    if (error instanceof Error && /UNIQUE/i.test([error.message, String(error.cause)].join(" "))) {
      return null;
    }
    throw error;
  }
}

export async function enqueueJobs(db: Database, jobs: EnqueueOptions[]): Promise<number> {
  let inserted = 0;
  for (const job of jobs) {
    if ((await enqueueJob(db, job)) !== null) inserted++;
  }
  return inserted;
}

/**
 * Claim the next due job (pending past runAfter, or abandoned running job whose
 * lease expired). Single-statement UPDATE…RETURNING keeps the claim atomic.
 */
export async function claimNextJob(db: Database): Promise<SyncJob | null> {
  const now = new Date();
  const lease = new Date(now.getTime() + LEASE_MS);

  const claimed = await db
    .update(schema.syncJobs)
    .set({
      status: "running",
      lockedUntil: lease,
      startedAt: now,
      attemptCount: sql`${schema.syncJobs.attemptCount} + 1`,
    })
    .where(
      inArray(
        schema.syncJobs.id,
        db
          .select({ id: schema.syncJobs.id })
          .from(schema.syncJobs)
          .where(
            or(
              and(
                eq(schema.syncJobs.status, "pending"),
                or(isNull(schema.syncJobs.runAfter), lte(schema.syncJobs.runAfter, now)),
                or(isNull(schema.syncJobs.lockedUntil), lte(schema.syncJobs.lockedUntil, now)),
              ),
              // Abandoned: still "running" but the lease expired (worker died).
              and(eq(schema.syncJobs.status, "running"), lte(schema.syncJobs.lockedUntil, now)),
            ),
          )
          .orderBy(asc(schema.syncJobs.createdAt))
          .limit(1),
      ),
    )
    .returning();

  return claimed[0] ?? null;
}

export async function hasDueJobs(db: Database): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .select({ id: schema.syncJobs.id })
    .from(schema.syncJobs)
    .where(
      or(
        and(
          eq(schema.syncJobs.status, "pending"),
          or(isNull(schema.syncJobs.runAfter), lte(schema.syncJobs.runAfter, now)),
        ),
        and(eq(schema.syncJobs.status, "running"), lte(schema.syncJobs.lockedUntil, now)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Queues reject a `delaySeconds` above 12 hours. */
const MAX_WAKEUP_DELAY_SEC = 12 * 60 * 60;

/**
 * When the next not-yet-due job becomes runnable: the earliest future `runAfter`
 * of a pending job, or the lease expiry of a running one. Null when nothing is
 * waiting. Production has only the daily cron (2026-10-22), so without a delayed
 * wake-up for this moment a job scheduled for later — a retry, the +3 h history
 * snapshot — would sit until the next day's tick.
 */
export async function nextJobDueAt(db: Database): Promise<Date | null> {
  const now = new Date();
  const [row] = await db
    .select({
      at: sql<number | null>`MIN(CASE
        WHEN ${schema.syncJobs.status} = 'pending' THEN ${schema.syncJobs.runAfter}
        ELSE ${schema.syncJobs.lockedUntil} END)`,
    })
    .from(schema.syncJobs)
    .where(
      or(
        and(eq(schema.syncJobs.status, "pending"), gt(schema.syncJobs.runAfter, now)),
        and(eq(schema.syncJobs.status, "running"), gt(schema.syncJobs.lockedUntil, now)),
      ),
    );
  return row?.at != null ? new Date(row.at) : null;
}

/**
 * Static rebuild only (see runScheduledTick): when nothing is due, make the job
 * that would run next due now — the earliest future runAfter, or a running job
 * whose lease has not expired (left by an interrupted run). Order is preserved;
 * only the waiting is skipped. Returns false when no job is waiting at all.
 */
export async function pullNextJobForward(db: Database): Promise<boolean> {
  if (await hasDueJobs(db)) return true;
  const dueAt = await nextJobDueAt(db);
  if (!dueAt) return false;
  const now = new Date();
  await db
    .update(schema.syncJobs)
    .set({ runAfter: now })
    .where(and(eq(schema.syncJobs.status, "pending"), eq(schema.syncJobs.runAfter, dueAt)));
  await db
    .update(schema.syncJobs)
    .set({ lockedUntil: now })
    .where(and(eq(schema.syncJobs.status, "running"), eq(schema.syncJobs.lockedUntil, dueAt)));
  return true;
}

export async function completeJob(db: Database, jobId: string): Promise<void> {
  await db
    .update(schema.syncJobs)
    .set({ status: "completed", completedAt: new Date(), lockedUntil: null, errorMessage: null })
    .where(eq(schema.syncJobs.id, jobId));
}

/** Retry with exponential backoff until maxAttempts, then dead-letter as failed. */
export async function failJob(
  db: Database,
  job: SyncJob,
  error: unknown,
  retryable: boolean,
): Promise<void> {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`.slice(0, 500)
      : String(error).slice(0, 500);
  const exhausted = job.attemptCount >= job.maxAttempts;

  if (!retryable || exhausted) {
    await db
      .update(schema.syncJobs)
      .set({ status: "failed", completedAt: new Date(), lockedUntil: null, errorMessage: message })
      .where(eq(schema.syncJobs.id, job.id));
    log.error("job.failed", {
      jobId: job.id,
      type: job.type,
      attempt: job.attemptCount,
      errorCode: "dead_letter",
    });
    return;
  }

  const delay = RETRY_BASE_MS * 2 ** (job.attemptCount - 1);
  await db
    .update(schema.syncJobs)
    .set({
      status: "pending",
      lockedUntil: null,
      runAfter: new Date(Date.now() + delay),
      errorMessage: message,
    })
    .where(eq(schema.syncJobs.id, job.id));
  log.warn("job.retry_scheduled", {
    jobId: job.id,
    type: job.type,
    attempt: job.attemptCount,
    delayMs: delay,
  });
}

export async function addJobLog(
  db: Database,
  jobId: string,
  level: "debug" | "info" | "warn" | "error",
  event: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.insert(schema.syncJobLogs).values({
    jobId,
    level,
    event,
    metadataJson: metadata ? JSON.stringify(metadata) : null,
  });
}

/** Fire a queue wake-up so the next invocation continues promptly (best effort).
 * `delaySeconds` defers delivery (Queues cap it at 12 h). */
export async function wakeUp(env: Env, reason: string, delaySeconds?: number): Promise<void> {
  try {
    await env.JOBS_QUEUE.send(
      { kind: "wakeup", reason },
      delaySeconds
        ? { delaySeconds: Math.min(Math.ceil(delaySeconds), MAX_WAKEUP_DELAY_SEC) }
        : undefined,
    );
  } catch (error) {
    // Queue unavailable — the daily cron tick picks the job up instead.
    log.warn("jobs.wakeup_failed", {
      reason,
      errorCode: error instanceof Error ? error.name : "UnknownError",
    });
  }
}

export function parsePayload<T>(job: SyncJob): T {
  return (job.payloadJson ? JSON.parse(job.payloadJson) : {}) as T;
}

export { createDb };
