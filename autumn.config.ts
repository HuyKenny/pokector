/**
 * Pokector Pro pricing as configuration.
 *
 * This file is the source of truth for what each tier includes. It ships with
 * `npx atmn push` and needs **no Worker deploy** — that is the whole point: a
 * limit that lives in code cannot be tuned once customers are on it.
 *
 * Enforcement reads these features through Autumn in `app/lib/billing/autumn.server.ts`.
 * `app/lib/limits.ts` keeps a copy of the FREE floor only as a local fallback
 * (Autumn outage must never lock people out); `test/unit/billing.test.ts` guards
 * that the two do not drift.
 */
import { feature, item, plan, type Plan } from "atmn";

/* ─────────────────────────────── features ─────────────────────────────── */

/*
 * All five are `metered` + `consumable: false`: they are **concurrent
 * allowances** ("how many may exist"), not monthly quotas. Deleting a binder
 * must free its slot, so the real count lives in our D1 — from Autumn we only
 * read the ceiling.
 */

export const maxBinders = feature({
  id: "max_binders",
  name: "Binders",
  type: "metered",
  consumable: false,
});

export const maxWishlistItems = feature({
  id: "max_wishlist_items",
  name: "Wishlist items",
  type: "metered",
  consumable: false,
});

export const maxActiveAlerts = feature({
  id: "max_active_alerts",
  name: "Active price alerts",
  type: "metered",
  consumable: false,
});

export const maxGradedEntries = feature({
  id: "max_graded_entries",
  name: "Graded card entries",
  type: "metered",
  consumable: false,
});

export const maxPinnedSets = feature({
  id: "max_pinned_sets",
  name: "Pinned sets",
  type: "metered",
  consumable: false,
});

/* ──────────────────────────────── plans ──────────────────────────────── */

/*
 * Every plan sits in the same group, and that is load-bearing.
 *
 * Without a shared group Autumn keeps several subscriptions active at once and
 * **sums their allowances** (verified on the QRFlowy sandbox: a Pro customer
 * got 101 codes instead of 100 — 100 plus 1 from the free tier). One group
 * means the plan is swapped, not added.
 */
const GROUP = "main";

/** Free tier — generous on purpose: the whole collection stays free to track. */
export const free: Plan = plan({
  id: "free",
  name: "Free",
  group: GROUP,
  // Auto-assigned when the customer is created, so even a non-paying user has
  // an Autumn record and therefore an answer to an entitlement query.
  autoEnable: true,
  description: "Track your whole collection, with live prices and set checklists.",
  items: [
    item({ featureId: maxBinders.id, included: 3 }),
    item({ featureId: maxWishlistItems.id, included: 100 }),
    item({ featureId: maxActiveAlerts.id, included: 3 }),
    item({ featureId: maxGradedEntries.id, included: 10 }),
    item({ featureId: maxPinnedSets.id, included: 1 }),
  ],
});

/*
 * Paid allowances are the old abuse ceilings. They are high enough that a real
 * collector never hits them, but finite — "unlimited" would leave us with no
 * defence against a scripted account.
 *
 * The monthly and yearly items MUST stay identical: entitlements are read from
 * features, so a difference in `included` would silently give yearly customers
 * a different product than the one we advertise.
 */
const PRO_ITEMS = [
  item({ featureId: maxBinders.id, included: 100 }),
  item({ featureId: maxWishlistItems.id, included: 2_000 }),
  item({ featureId: maxActiveAlerts.id, included: 1_000 }),
  item({ featureId: maxGradedEntries.id, included: 100_000 }),
  item({ featureId: maxPinnedSets.id, included: 1_000 }),
];

export const pro: Plan = plan({
  id: "pro",
  name: "Pokector Pro",
  group: GROUP,
  // USD: the org's default_currency is `usd` and automatic tax is off, so this
  // is the final amount the customer pays. Matches the previous Stripe price
  // exactly ($3.99/mo) — the migration must not reprice anyone.
  price: { amount: 3.99, interval: "month" },
  description: "Unlimited-scale binders, wishlist, alerts, graded cards and pinned sets.",
  items: PRO_ITEMS,
});

export const proYearly: Plan = plan({
  id: "pro_yearly",
  name: "Pokector Pro (yearly)",
  group: GROUP,
  // $40/yr — the same figure the pricing page has always shown (≈ $3.33/mo).
  price: { amount: 40, interval: "year" },
  description: "Pokector Pro billed yearly — about two months free versus monthly.",
  items: PRO_ITEMS,
});
