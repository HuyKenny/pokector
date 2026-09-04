/**
 * Pokector Pro billing on Autumn (which drives Stripe underneath).
 *
 * Autumn is the source of truth for **which tier** a customer is on; `userProfiles`
 * keeps a mirror in D1 so a slow or failing third party never sits in the request
 * path of a page load. The tier catalogue (names, prices, advertised allowances)
 * lives in `autumn.config.ts` and ships with `atmn -p push`.
 *
 * ## Read order
 * 1. **D1 mirror**, while it is fresher than `MIRROR_TTL_MS`.
 * 2. **Live Autumn query** once the mirror goes stale — in *both* directions.
 *    Refreshing only "free" mirrors was the obvious optimisation and it is wrong:
 *    a cancellation that misses the webhook would then never propagate and the
 *    customer would keep Pro forever (this exact bug was caught on Hlidamo).
 *
 * ## When it breaks
 * Every failure degrades to the **last known mirror**, or to free if we have
 * never synced. Never to "no access": a billing outage must not lock a paying
 * collector out of their own collection.
 *
 * Numeric allowances are deliberately NOT read from here: enforcement uses
 * `limitsFor(plan)` in `app/lib/limits.ts`, which is the single source of truth
 * for every gate. This module only decides *which tier* a customer is on.
 *
 * Direct `fetch` against the REST API rather than `autumn-js`: the SDK is ~450 kB
 * and we need four endpoints.
 */

import { eq } from "drizzle-orm";

import { schema, type Database } from "../db/index.server";
import { log } from "../log.server";

const API = "https://api.useautumn.com/v1";

/** Deliberately short: a slow third party must not become our latency. */
const TIMEOUT_MS = 4000;

/** How long the D1 mirror is trusted before we re-ask Autumn. */
export const MIRROR_TTL_MS = 6 * 60 * 60 * 1000;

export interface AutumnEnv {
  AUTUMN_SECRET_KEY?: string;
  APP_URL: string;
}

export function autumnConfigured(env: AutumnEnv): boolean {
  return typeof env.AUTUMN_SECRET_KEY === "string" && env.AUTUMN_SECRET_KEY.length > 0;
}

/**
 * Plan ids from `autumn.config.ts`. These strings must match exactly — `/attach`
 * rejects an unknown product, and the mirror stores them verbatim.
 */
export const PLANS = { free: "free", pro: "pro", pro_yearly: "pro_yearly" } as const;
export type PlanId = (typeof PLANS)[keyof typeof PLANS];

/** Paid plan ids, i.e. everything that is not the auto-enabled free tier. */
const PAID_PLAN_IDS = new Set<string>([PLANS.pro, PLANS.pro_yearly]);

export interface Entitlements {
  planId: string;
  /** True while a paid plan is active (this is what gates Pro features). */
  premium: boolean;
  /** End of the paid period (ms epoch), null on free. */
  periodEnd: number | null;
  /** Cancellation is scheduled but the paid period is still running. */
  cancelPending: boolean;
  /** Billing interval, for display only. */
  interval: "month" | "year" | null;
  /** There is a Stripe counterpart, so the customer portal has something to open. */
  hasStripeCustomer: boolean;
}

/** The free tier, enforced locally. Mirrors `free` in `autumn.config.ts`; the
 * unit test guards that the two do not drift. */
export const FREE: Entitlements = {
  planId: PLANS.free,
  premium: false,
  periodEnd: null,
  cancelPending: false,
  interval: null,
  hasStripeCustomer: false,
};

/* ───────────────────────────── response shape ───────────────────────────── */

interface AutumnSubscription {
  plan_id?: string;
  status?: string;
  add_on?: boolean;
  auto_enable?: boolean;
  canceled_at?: number | null;
  current_period_end?: number | null;
}

export interface AutumnCustomer {
  id?: string;
  stripe_id?: string | null;
  balances?: Record<string, { granted?: number | null; unlimited?: boolean }>;
  subscriptions?: AutumnSubscription[];
}

/** Statuses that grant access — `past_due` keeps it through Stripe's retries. */
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * Pick the subscription that decides the tier.
 *
 * Not simply "the one without add_on": every customer also carries the free tier,
 * which assigns itself (`auto_enable`). What was actually bought therefore wins,
 * so a forgotten default can never outrank a paid plan.
 */
function primarySubscription(subs: AutumnSubscription[]): AutumnSubscription | null {
  const active = subs.filter(
    (s) => s.add_on !== true && ACTIVE_STATUSES.has(s.status ?? ""),
  );
  if (active.length === 0) return null;
  return active.find((s) => s.auto_enable !== true) ?? active[0];
}

/**
 * Autumn's customer payload → entitlements. Pure, so it is unit-testable without
 * network or D1.
 */
export function parseEntitlements(customer: AutumnCustomer): Entitlements {
  const sub = primarySubscription(customer.subscriptions ?? []);
  const planId = sub?.plan_id ?? PLANS.free;
  const premium = PAID_PLAN_IDS.has(planId);

  return {
    planId,
    premium,
    // Autumn sends `current_period_end` in milliseconds.
    periodEnd: sub?.current_period_end ?? null,
    cancelPending: Boolean(sub?.canceled_at),
    // Derived from the plan, not the subscription: Autumn carries the interval on
    // the product's price, never on the subscription object, so reading it there
    // left every account showing "Billing: —".
    interval: planId === PLANS.pro_yearly ? "year" : planId === PLANS.pro ? "month" : null,
    hasStripeCustomer: Boolean(customer.stripe_id),
  };
}

/* ────────────────────────────── API client ────────────────────────────── */

class AutumnUnavailable extends Error {}

async function call<T>(env: AutumnEnv, path: string, init?: RequestInit): Promise<T> {
  if (!env.AUTUMN_SECRET_KEY) throw new AutumnUnavailable("AUTUMN_SECRET_KEY is not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${env.AUTUMN_SECRET_KEY}`,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      // `message` is whatever Autumn sent; only stringify it when it really is a
      // string, otherwise we would log "[object Object]".
      const detail = typeof body?.message === "string" ? body.message.slice(0, 200) : "";
      throw new AutumnUnavailable(`Autumn returned ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

/** POST /customers is create-or-return; it also assigns the free tier. */
function getOrCreateCustomer(
  env: AutumnEnv,
  userId: string,
  email?: string,
): Promise<AutumnCustomer> {
  return call<AutumnCustomer>(env, "/customers", {
    method: "POST",
    body: JSON.stringify({ id: userId, ...(email ? { email } : {}) }),
  });
}

/* ──────────────────────────────── mirror ──────────────────────────────── */

type MirrorRow = {
  plan: string;
  planInterval: "month" | "year" | null;
  premiumUntil: Date | null;
  stripeCustomerId: string | null;
  billingSyncedAt: Date | null;
};

function fromMirror(row: MirrorRow): Entitlements {
  const premium = PAID_PLAN_IDS.has(row.plan);
  return {
    planId: row.plan,
    premium,
    periodEnd: row.premiumUntil ? row.premiumUntil.getTime() : null,
    cancelPending: false,
    interval: row.planInterval,
    hasStripeCustomer: Boolean(row.stripeCustomerId),
  };
}

/**
 * The `premium_until` value to mirror.
 *
 * A lapsed plan gets a past timestamp so `isPremium` goes false; user data is
 * never touched. But a **premium** customer must never get one: Autumn can
 * report an active subscription with no `current_period_end` (a trial, a
 * manually granted plan, or simply an omitted field), and writing the epoch
 * there would make `isPremium` false at all five gates — a paying customer
 * silently locked out of what they bought. In that case we grant access to just
 * past the mirror TTL, so the next sync is what decides.
 */
export function premiumUntilFor(ent: Entitlements): Date {
  if (!ent.premium) return new Date(0);
  return new Date(ent.periodEnd ?? Date.now() + MIRROR_TTL_MS);
}

async function writeMirror(
  db: Database,
  userId: string,
  ent: Entitlements,
  stripeId: string | null,
): Promise<void> {
  await db
    .update(schema.userProfiles)
    .set({
      // `plan` is the display/gate column; entitlement itself is premiumUntil-based.
      plan: ent.premium ? "pro" : "free",
      planStatus: ent.planId,
      planInterval: ent.interval,
      premiumUntil: premiumUntilFor(ent),
      billingSyncedAt: new Date(),
      ...(stripeId ? { stripeCustomerId: stripeId } : {}),
    })
    .where(eq(schema.userProfiles.userId, userId));
}

/**
 * Pull the authoritative state from Autumn and write the mirror. Called from the
 * webhook and after returning from checkout. Errors are **not** swallowed — the
 * caller decides whether to show a stale value or an error.
 */
export async function syncFromAutumn(
  db: Database,
  env: AutumnEnv,
  userId: string,
  email?: string,
): Promise<Entitlements> {
  const customer = await getOrCreateCustomer(env, userId, email);
  const ent = parseEntitlements(customer);
  await writeMirror(db, userId, ent, customer.stripe_id ?? null);
  return ent;
}

/**
 * A user's entitlements. Mirror first; Autumn only once the mirror is stale —
 * in both directions, so cancellations propagate within the TTL even if a
 * webhook is lost.
 */
export async function getEntitlements(
  db: Database,
  env: AutumnEnv,
  userId: string,
  email?: string,
  /**
   * When given, a stale mirror is refreshed **off the request path**: the caller
   * gets the last known values immediately and the sync runs in the background.
   * Without it the refresh is awaited, which puts Autumn's 4s timeout into the
   * load of whatever page asked. Pass it from every page loader; omit it only
   * where the fresh answer is the point (e.g. returning from checkout).
   */
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Entitlements> {
  const [row] = await db
    .select({
      plan: schema.userProfiles.plan,
      planInterval: schema.userProfiles.planInterval,
      premiumUntil: schema.userProfiles.premiumUntil,
      stripeCustomerId: schema.userProfiles.stripeCustomerId,
      billingSyncedAt: schema.userProfiles.billingSyncedAt,
    })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, userId))
    .limit(1);

  if (!row) return FREE;
  if (!autumnConfigured(env)) return fromMirror(row);

  const syncedAt = row.billingSyncedAt?.getTime() ?? null;
  const fresh = syncedAt !== null && Date.now() - syncedAt < MIRROR_TTL_MS;
  if (fresh) return fromMirror(row);

  if (waitUntil) {
    // Serve the stale mirror now; correct it in the background. Worst case the
    // visitor sees one page with the previous tier, which is the right trade for
    // never blocking a page load on someone else's API.
    waitUntil(
      syncFromAutumn(db, env, userId, email).catch((error: unknown) => {
        log.error("autumn.background_sync_failed", {
          userId,
          error: error instanceof Error ? error.message : "unknown",
        });
      }),
    );
    return syncedAt === null ? FREE : fromMirror(row);
  }

  try {
    return await syncFromAutumn(db, env, userId, email);
  } catch (error) {
    // Silence here would mean silently lost revenue (someone paid and the mirror
    // does not know) or a silently free ride — log it either way.
    log.error("autumn.sync_failed", {
      userId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return syncedAt === null ? FREE : fromMirror(row);
  }
}

/* ─────────────────────────── checkout & portal ─────────────────────────── */

export interface CheckoutResult {
  checkoutUrl: string | null;
  /** The plan was demonstrably already running *before* this call. */
  alreadyActive: boolean;
  /**
   * Autumn returned no payment link although the plan was not running.
   *
   * That means a subscription exists that nobody paid for, and the customer must
   * never be told the payment went through.
   */
  unpaidGrant: boolean;
}

/**
 * Start a checkout for `planId`.
 *
 * `success_url` must always be sent: the organisation default is
 * `https://useautumn.com`, so without it a paying customer lands on Autumn's
 * site instead of ours (verified on this org — its success_url is that default).
 *
 * **A missing `checkout_url` does not mean "already paid."** Reading it that way
 * once granted two unpaid active subscriptions on Hlidamo: Autumn created them
 * with "send an invoice" collection, so they are `active` and unpaid. The only
 * way to tell the cases apart is to read the entitlements *before* attaching.
 */
export async function createCheckout(
  db: Database,
  env: AutumnEnv,
  userId: string,
  planId: Exclude<PlanId, "free">,
  email?: string,
): Promise<CheckoutResult> {
  await getOrCreateCustomer(env, userId, email);

  const before = await getEntitlements(db, env, userId, email);
  const hadPlan = before.planId === planId;

  const body = await call<{ checkout_url?: string }>(env, "/attach", {
    method: "POST",
    body: JSON.stringify({
      customer_id: userId,
      // The field is `product_id`; `plan_id` answers "`product_id` is not provided".
      product_id: planId,
      success_url: `${env.APP_URL}/app/billing?checkout=success`,
    }),
  });

  const checkoutUrl = body.checkout_url ?? null;
  if (checkoutUrl === null && !hadPlan) {
    log.error("autumn.unpaid_grant", { userId, planId, previousPlan: before.planId });
  }

  return {
    checkoutUrl,
    alreadyActive: checkoutUrl === null && hadPlan,
    unpaidGrant: checkoutUrl === null && !hadPlan,
  };
}

/**
 * Stripe customer-portal link. Cancellation happens here too: Autumn's own
 * subscription-management endpoints reject an API key (`no_auth_header` — they
 * want a dashboard session), so we deliberately have no cancel button of our
 * own. Invoices, dunning and receipts belong to Stripe anyway.
 */
export async function billingPortalUrl(
  env: AutumnEnv,
  userId: string,
  returnUrl: string,
): Promise<string | null> {
  try {
    const body = await call<{ url?: string }>(
      env,
      `/customers/${encodeURIComponent(userId)}/billing_portal`,
      { method: "POST", body: JSON.stringify({ return_url: returnUrl }) },
    );
    return body.url ?? null;
  } catch (error) {
    log.warn("autumn.portal_failed", {
      userId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}
