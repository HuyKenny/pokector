/**
 * Configurable abuse limits (SPEC §24) — generous for real collectors, finite
 * for abuse. Adjust here; enforcement sites reference these constants.
 *
 * These are NON-tiered (same for free + Pro): the whole collection stays free to
 * track, exports stay free, notes/name/import caps are abuse-only. Tiered caps
 * (binders, wishlist, alerts, graded, pinned sets) live in PLAN_LIMITS below.
 */
export const LIMITS = {
  maxCollectionEntriesPerUser: 100_000,
  maxBinderPages: 100,
  maxCsvRows: 20_000,
  maxImportBytes: 5 * 1024 * 1024,
  maxNotesLength: 1_000,
  maxNameLength: 100,
} as const;

import type { Plan } from "./billing/entitlement.server";

/**
 * Per-plan caps — the "invest smarter" split. Pokector Pro sells depth + scale;
 * the free tier is generous but meters power-user features. Pro values are the
 * old abuse ceilings (binders/wishlist) or effectively-unlimited abuse guards.
 */
export interface PlanLimits {
  maxBinders: number;
  maxWishlistItems: number;
  maxActiveAlerts: number;
  maxGradedEntries: number;
  maxPinnedSets: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxBinders: 3,
    maxWishlistItems: 100,
    maxActiveAlerts: 3,
    maxGradedEntries: 10,
    maxPinnedSets: 1,
  },
  pro: {
    maxBinders: 100,
    maxWishlistItems: 2_000,
    maxActiveAlerts: 1_000,
    maxGradedEntries: 100_000,
    maxPinnedSets: 1_000,
  },
};

export function limitsFor(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

/** Consistent 422 body for a hit limit, carrying an `upgrade` hint for the UI. */
export function limitResponse(message: string, upgrade = true): Response {
  return new Response(JSON.stringify({ error: { code: "limit", message, upgrade } }), {
    status: 422,
    headers: { "Content-Type": "application/json" },
  });
}
