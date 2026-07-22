/**
 * Tiny TTL cache for expensive, visitor-identical catalog aggregates (price
 * movers, pokédex rollups). Backed by the `catalog_cache` D1 table (not KV — the
 * Free plan caps KV writes). TTL-only: entries expire, nothing invalidates them,
 * so a value can be up to `ttlSec` stale — fine because the underlying catalog
 * data only changes on the daily sync. Best-effort: any DB error degrades to a
 * cache miss (the caller recomputes), never throws.
 */
import { schema, type Database } from "../db/index.server";

const nowSec = () => Math.floor(Date.now() / 1000);

/** Read a cached JSON value by key, or null on miss/expiry/error. */
export async function getCached<T>(db: Database, key: string): Promise<T | null> {
  try {
    const row = await db.query.catalogCache.findFirst({
      where: (t, { eq }) => eq(t.key, key),
    });
    if (!row || row.expiresAt < nowSec()) return null;
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

/** Store a JSON value under key with a TTL (seconds). Best-effort. */
export async function setCached(
  db: Database,
  key: string,
  value: unknown,
  ttlSec: number,
): Promise<void> {
  try {
    const expiresAt = nowSec() + ttlSec;
    const serialized = JSON.stringify(value);
    await db
      .insert(schema.catalogCache)
      .values({ key, value: serialized, expiresAt })
      .onConflictDoUpdate({
        target: schema.catalogCache.key,
        set: { value: serialized, expiresAt },
      });
  } catch {
    // best-effort cache — a failed write just means the next read recomputes
  }
}

/** Get-or-compute: return the cached value, else run `compute`, store, return. */
export async function cached<T>(
  db: Database,
  key: string,
  ttlSec: number,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = await getCached<T>(db, key);
  if (hit !== null) return hit;
  const fresh = await compute();
  await setCached(db, key, fresh, ttlSec);
  return fresh;
}
