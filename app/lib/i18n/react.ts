/**
 * React hooks for locale-aware UI (client-safe). Locale comes from the URL —
 * either the `:locale` route param (localized tree) or absent (English root).
 */

import { useMemo } from "react";
import { useParams } from "react-router";

import { LANG_TAGS, type Locale, localePath, resolveLocale } from "./locales";

/** Active locale, resolved from the `:locale` route param (English when absent). */
export function useLocale(): Locale {
  const params = useParams();
  return resolveLocale(params.locale);
}

/** The BCP-47 tag for the active locale (for Intl formatters). */
export function useLangTag(): string {
  return LANG_TAGS[useLocale()];
}

/**
 * Returns `lp`, a helper that prefixes an unprefixed app path with the active
 * locale. Use for every in-scope internal link so navigation stays in-locale.
 *   const lp = useLocalePath(); <Link to={lp("/cards")} />
 * Links to English-only areas (legal, blog, /app, /logout) should NOT use lp().
 */
export function useLocalePath(): (path: string) => string {
  const locale = useLocale();
  return useMemo(() => (path: string) => localePath(locale, path), [locale]);
}
