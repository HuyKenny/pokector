/**
 * Plan entitlement. Stripe is the source of truth; `userProfiles` caches the
 * subscription state (kept fresh by the subscription webhook → sync job). The
 * authoritative signal is `premiumUntil`: access is granted through the paid
 * period, so a customer who cancels keeps Pro until the period they paid for
 * ends. The `plan`/`planStatus` columns are for display only.
 */

export type Plan = "free" | "pro";

/** Just the billing fields we read — accepts a full userProfiles row or a subset. */
export interface EntitlementProfile {
  premiumUntil?: Date | null;
}

/** Premium iff the paid period has not yet elapsed. `now` is injectable for tests. */
export function isPremium(profile: EntitlementProfile | null | undefined, now: number = Date.now()): boolean {
  const until = profile?.premiumUntil;
  return until != null && until.getTime() > now;
}

export function planOf(profile: EntitlementProfile | null | undefined, now: number = Date.now()): Plan {
  return isPremium(profile, now) ? "pro" : "free";
}

// ── DB helper (kept out of the pure functions above so those stay unit-testable) ─
import { eq } from "drizzle-orm";
import { schema, type Database } from "../db/index.server";

/** Resolve a user's current plan from their profile's cached entitlement. */
export async function getUserPlan(db: Database, userId: string): Promise<Plan> {
  const [row] = await db
    .select({ premiumUntil: schema.userProfiles.premiumUntil })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .limit(1);
  return planOf(row);
}
