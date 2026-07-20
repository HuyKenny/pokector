/**
 * Subscription sync job (DECISIONS: Pokector Pro). The Stripe webhook acks fast
 * and enqueues this job keyed by the Stripe event id (queue dedupe = idempotency).
 * Here we fetch the authoritative subscription state from Stripe and write the
 * entitlement cache onto `userProfiles`. Idempotent: re-running produces the same
 * row state.
 */

import { eq } from "drizzle-orm";

import { createDb, schema } from "../../db/index.server";
import { getSubscription } from "../../billing/stripe.server";
import { log } from "../../log.server";
import { parsePayload, type SyncJob } from "../queue.server";

interface SubscriptionSyncPayload {
  eventType: string;
  subscriptionId?: string;
  customerId?: string;
  /** From checkout `client_reference_id` or subscription `metadata.userId`. */
  userId?: string;
}

/** Stripe statuses that grant access (past_due keeps access during the retry window). */
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function handleSubscriptionSync(job: SyncJob, env: Env): Promise<void> {
  const payload = parsePayload<SubscriptionSyncPayload>(job);
  const db = createDb(env.DB);

  if (!payload.subscriptionId) {
    // e.g. a checkout that didn't produce a subscription — nothing to sync.
    log.info("subscription.sync_skip_no_subscription", { eventType: payload.eventType });
    return;
  }

  const sub = await getSubscription(env, payload.subscriptionId);
  const customerId = payload.customerId ?? sub.customer;

  // Resolve the target user: prefer the explicit userId (checkout ref / sub
  // metadata), else map by the Stripe customer id already stored on a profile.
  let userId = payload.userId ?? sub.metadata?.userId;
  if (!userId) {
    const [row] = await db
      .select({ userId: schema.userProfiles.userId })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.stripeCustomerId, customerId))
      .limit(1);
    userId = row?.userId;
  }
  if (!userId) {
    log.warn("subscription.sync_unresolved_user", {
      eventType: payload.eventType,
      subscriptionId: sub.id,
    });
    return;
  }

  const active = ACTIVE_STATUSES.has(sub.status);
  const interval = sub.items.data[0]?.price.recurring?.interval;
  // premiumUntil = paid-period end while active; a canceled/unpaid sub gets a past
  // timestamp so entitlement lapses (existing user data is never touched).
  const premiumUntil = active ? new Date(sub.current_period_end * 1000) : new Date(0);

  await db
    .update(schema.userProfiles)
    .set({
      plan: active ? "pro" : "free",
      planStatus: sub.status,
      planInterval: interval === "year" ? "year" : interval === "month" ? "month" : null,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      premiumUntil,
    })
    .where(eq(schema.userProfiles.userId, userId));

  log.info("subscription.synced", {
    eventType: payload.eventType,
    subscriptionStatus: sub.status,
    active,
  });
}
