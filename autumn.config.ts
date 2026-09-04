/**
 * Pokector Pro pricing as configuration.
 *
 * This is the **customer-facing** catalogue: plan names, prices, and the
 * allowances we advertise. It ships with `npx atmn -p push`, so copy and pricing
 * change without a Worker deploy.
 *
 * It is NOT what the app enforces. Every gate (binders, wishlist, alerts, graded,
 * pinned) reads `limitsFor(plan)` from `app/lib/limits.ts`, so **`PLAN_LIMITS`
 * there is the authority** and the `included` numbers below must be kept equal to
 * it by hand — pushing a different number here changes what customers are told,
 * not what they get. Nothing automated guards that; if you tune a limit, change
 * both files.
 */
import { feature, item, plan, type Plan } from "atmn";

/* ─────────────────────────────── features ─────────────────────────────── */

/*
 * All five are `metered` + `consumable: false`: they are **concurrent
 * allowances** ("how many may exist"), not monthly quotas. They exist so the
 * plan reads correctly on Autumn's side (and in any pricing UI Autumn renders);
 * the enforced ceiling is `PLAN_LIMITS` in `app/lib/limits.ts`.
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
