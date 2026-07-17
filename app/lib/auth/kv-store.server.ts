/**
 * D1-backed key/value store for Better Auth's `secondaryStorage` (sessions,
 * verification values, rate-limit counters). Replaces the KV implementation:
 * on the Free plan KV caps at 1k writes/day and Better Auth writes on every
 * auth request, so an exhausted KV budget made `env.KV.put` reject and 500 the
 * whole auth handler (register + login dead, 2026-07-18). D1 has far more room.
 *
 * Same resilience philosophy as counters.server.ts: infrastructure failures are
 * logged and swallowed rather than thrown — storage must never take auth down.
 * A dropped write just means the caller (e.g. a session) is retried, not a 500.
 */
import { eq, sql } from "drizzle-orm";

import type { Database } from "../db/index.server";
import * as schema from "../db/schema";

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Value for `key`, or null when missing / expired / on infra failure. */
export async function authKvGet(db: Database, key: string): Promise<string | null> {
  try {
    const row = await db.query.authKv.findFirst({ where: (t, { eq: e }) => e(t.key, key) });
    if (!row) return null;
    if (row.expiresAt !== null && row.expiresAt < nowSeconds()) return null;
    return row.value;
  } catch (error) {
    console.warn(`authKv get failed for ${key}:`, error);
    return null;
  }
}

/** Upsert `key`. `ttlSeconds` omitted/0 ⇒ no expiry (persists until deleted). */
export async function authKvSet(
  db: Database,
  key: string,
  value: string,
  ttlSeconds?: number,
): Promise<void> {
  try {
    const expiresAt = ttlSeconds ? nowSeconds() + ttlSeconds : null;
    await db
      .insert(schema.authKv)
      .values({ key, value, expiresAt })
      .onConflictDoUpdate({ target: schema.authKv.key, set: { value, expiresAt } });
  } catch (error) {
    console.warn(`authKv set failed for ${key}:`, error);
  }
}

/** Delete `key` (no-op on infra failure). */
export async function authKvDelete(db: Database, key: string): Promise<void> {
  try {
    await db.delete(schema.authKv).where(eq(schema.authKv.key, key));
  } catch (error) {
    console.warn(`authKv delete failed for ${key}:`, error);
  }
}

/** Delete expired rows (called from the daily cron). */
export async function pruneExpiredAuthKv(db: Database): Promise<void> {
  await db
    .delete(schema.authKv)
    .where(sql`${schema.authKv.expiresAt} IS NOT NULL AND ${schema.authKv.expiresAt} < ${nowSeconds()}`);
}
