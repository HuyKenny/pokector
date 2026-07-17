/**
 * Daily portfolio snapshot job (SPEC §18). Runs after the price sync window.
 * Idempotent per (user, day); inactive users whose collection AND prices did
 * not change since their last snapshot are skipped to save writes.
 */

import { sql } from "drizzle-orm";

import { createDb } from "../../db/index.server";
import { writePortfolioSnapshot } from "../../portfolio/queries.server";
import { addJobLog, type SyncJob } from "../queue.server";

export async function handlePortfolioSnapshots(job: SyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const today = new Date().toISOString().slice(0, 10);

  // Users needing a snapshot today: have entries AND (no snapshot today yet)
  // AND (collection changed since last snapshot OR any owned card's price was
  // observed since then OR they never had a snapshot).
  const users = await db.all<{ user_id: string }>(sql`
    SELECT DISTINCT e.user_id
    FROM collection_entries e
    WHERE NOT EXISTS (
      SELECT 1 FROM portfolio_snapshots s
      WHERE s.user_id = e.user_id AND s.currency = 'USD' AND s.snapshot_date = ${today}
        AND s.calculated_at >= (
          SELECT MAX(e2.updated_at) FROM collection_entries e2 WHERE e2.user_id = e.user_id
        )
    )
    LIMIT 500
  `);

  let written = 0;
  for (const { user_id } of users) {
    await writePortfolioSnapshot(db, user_id, today);
    written++;
  }

  await addJobLog(db, job.id, "info", "snapshots.written", { users: written, date: today });
}
