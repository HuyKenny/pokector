/**
 * Proactively seed eBay graded (PSA 9/10) prices for the most valuable cards, so
 * PSA prices + history build up WITHOUT waiting for someone to view each card.
 *
 * Runs one page (~25 cards) per invocation to stay inside the Workers CPU budget,
 * then chains the next page via a queue wake-up until the daily card cap or the
 * shared eBay Browse-call budget is reached. Each card refresh writes ebay_cache
 * + card_graded_prices (via refreshCardGradedPrices); the daily price_history_record
 * job then snapshots card_graded_prices into card_graded_price_history.
 *
 * Card selection advances by EXCLUDING cards with a fresh (≤24 h) ebay_cache row,
 * so each invocation naturally moves to the next most-valuable un-refreshed cards
 * (no OFFSET over a mutating set, and null-result cards aren't re-picked).
 */
import { sql } from "drizzle-orm";

import {
  EBAY_DAILY_REFRESH_CAP,
  ebayRefreshBudgetKey,
  refreshCardGradedPrices,
} from "../../affiliate/ebay-api.server";
import { readCounter } from "../../counters.server";
import { createDb } from "../../db/index.server";
import { addJobLog, enqueueJob, parsePayload, wakeUp, type SyncJob } from "../queue.server";

const PAGE_SIZE = 25;
const MAX_CARDS_PER_DAY = 1000; // × up to 3 Browse calls each, under the daily cap

interface SeedPayload {
  done?: number;
}

export async function handleEbayGradedSeed(job: SyncJob, env: Env): Promise<void> {
  if (!env.EBAY_APP_ID || !env.EBAY_CERT_ID) return; // eBay not configured → no-op
  const db = createDb(env.DB);
  const { done = 0 } = parsePayload<SeedPayload>(job);
  const day = new Date().toISOString().slice(0, 10);
  const nowSec = Math.floor(Date.now() / 1000);

  // Stop if today's shared eBay refresh budget is already spent.
  const used = await readCounter(db, ebayRefreshBudgetKey(day));
  if (used !== null && used >= EBAY_DAILY_REFRESH_CAP) {
    await addJobLog(db, job.id, "info", "ebay_seed.budget_exhausted", { used });
    return;
  }

  const rows = await db.all<{
    id: string;
    name: string;
    number: string;
    set_name: string;
    printed_total: number | null;
  }>(sql`
    SELECT k.id, k.name, k.number, s.name AS set_name, s.printed_total
    FROM card_prices_current p
    JOIN pokemon_cards k ON k.id = p.card_id AND k.active = 1
    JOIN pokemon_sets s ON s.id = k.set_id
    WHERE p.source = 'tcgplayer' AND p.currency = 'USD'
      AND NOT EXISTS (
        SELECT 1 FROM ebay_cache e
        WHERE e.key = ('ebay:prices:v2:' || k.id) AND e.expires_at > ${nowSec}
      )
    ORDER BY p.normalized_price_minor DESC
    LIMIT ${PAGE_SIZE}
  `);

  for (const r of rows) {
    await refreshCardGradedPrices(env, db, {
      id: r.id,
      name: r.name,
      setName: r.set_name,
      number: r.number,
      printedTotal: r.printed_total,
    });
  }
  const total = done + rows.length;
  await addJobLog(db, job.id, "info", "ebay_seed.page", { count: rows.length, total });

  // Chain the next page until the daily card cap or no more un-refreshed cards.
  if (rows.length === PAGE_SIZE && total < MAX_CARDS_PER_DAY) {
    await enqueueJob(db, {
      type: "ebay_graded_seed",
      payload: { done: total },
      idempotencyKey: `ebay-seed:${day}:d${total}`,
      runAfter: new Date(Date.now() + 30 * 1000),
    });
    await wakeUp(env, `ebay_seed_${total}`);
  }
}
