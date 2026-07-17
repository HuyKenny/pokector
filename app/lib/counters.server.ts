/**
 * Atomic short-lived counters backed by D1 (see schema.counters for why not
 * KV). One SQL UPSERT per increment — atomic, unlike the old KV read-then-put.
 *
 * Infrastructure failures return `null` instead of throwing: callers decide
 * what failing open means for them (rate limits allow the request, the PTCG
 * budget guard proceeds). Abuse control must never be the thing that takes
 * the site down — that is exactly how search 500ed on 2026-07-17.
 */
import { sql } from "drizzle-orm";

import type { Database } from "~/lib/db/index.server";
import * as schema from "~/lib/db/schema";

/**
 * Increment `key` by 1 and return the new value, creating the row (expiring
 * `ttlSeconds` from now) if missing or previously expired. Returns null on
 * infrastructure failure.
 */
export async function incrementCounter(
  db: Database,
  key: string,
  ttlSeconds: number,
): Promise<number | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const rows = await db
      .insert(schema.counters)
      .values({ key, value: 1, expiresAt: now + ttlSeconds })
      .onConflictDoUpdate({
        target: schema.counters.key,
        // A row past its expiry restarts at 1 with a fresh window.
        set: {
          value: sql`CASE WHEN ${schema.counters.expiresAt} < ${now} THEN 1 ELSE ${schema.counters.value} + 1 END`,
          expiresAt: sql`CASE WHEN ${schema.counters.expiresAt} < ${now} THEN ${now + ttlSeconds} ELSE ${schema.counters.expiresAt} END`,
        },
      })
      .returning({ value: schema.counters.value });
    return rows[0]?.value ?? null;
  } catch (error) {
    console.warn(`counter increment failed for ${key}:`, error);
    return null;
  }
}

/** Current value of `key` (0 when missing/expired, null on infra failure). */
export async function readCounter(db: Database, key: string): Promise<number | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const row = await db.query.counters.findFirst({
      where: (t, { eq }) => eq(t.key, key),
    });
    if (!row || row.expiresAt < now) return 0;
    return row.value;
  } catch (error) {
    console.warn(`counter read failed for ${key}:`, error);
    return null;
  }
}

/** Delete expired counter rows (called from the daily cron). */
export async function pruneExpiredCounters(db: Database): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db.delete(schema.counters).where(sql`${schema.counters.expiresAt} < ${now}`);
}
