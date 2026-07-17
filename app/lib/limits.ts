/**
 * Configurable abuse limits (SPEC §24) — generous for real collectors, finite
 * for abuse. Adjust here; enforcement sites reference these constants.
 */
export const LIMITS = {
  maxCollectionEntriesPerUser: 100_000,
  maxBindersPerUser: 100,
  maxBinderPages: 100,
  maxWishlistItemsPerUser: 2_000,
  maxCsvRows: 20_000,
  maxImportBytes: 5 * 1024 * 1024,
  maxNotesLength: 1_000,
  maxNameLength: 100,
} as const;
