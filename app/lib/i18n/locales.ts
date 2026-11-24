/**
 * Locale registry and URL helpers (client-safe — no dictionary imports here so
 * this can be bundled into the client without shipping translations).
 *
 * English is the default and lives at the unprefixed root (`/cards`); the other
 * locales live under a short path prefix (`/de/cards`). The short prefix is what
 * appears in URLs; the full BCP-47 tag (`LANG_TAGS`) is used for <html lang>,
 * hreflang alternates, and Intl formatting.
 *
 * No Accept-Language redirects anywhere: per Google's guidance the locale is
 * determined by the URL only (workers/app.ts does not sniff the header).
 */

export const DEFAULT_LOCALE = "en" as const;

/** Short URL prefixes. Order here is the order hreflang alternates are emitted. */
export const LOCALES = ["en", "de", "es", "ru", "zh", "cs", "fr", "pt", "ja", "vi", "ar"] as const;

export type Locale = (typeof LOCALES)[number];

/** Non-default locales — the ones that get a URL prefix. */
export const PREFIXED_LOCALES = LOCALES.filter((l) => l !== DEFAULT_LOCALE);

/** BCP-47 language tags for <html lang> / hreflang / Intl (full, unlike prefixes). */
export const LANG_TAGS: Record<Locale, string> = {
  en: "en",
  de: "de",
  es: "es",
  ru: "ru",
  zh: "zh-Hans",
  cs: "cs",
  fr: "fr",
  pt: "pt-BR",
  ja: "ja",
  vi: "vi",
  ar: "ar",
};

/** Human-readable endonyms for the language switcher. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  es: "Español",
  ru: "Русский",
  zh: "简体中文",
  cs: "Čeština",
  fr: "Français",
  pt: "Português",
  ja: "日本語",
  vi: "Tiếng Việt",
  ar: "العربية",
};

/** Right-to-left locales (basic RTL support). */
export const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(["ar"]);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

/** Coerce a route param (possibly undefined on the unprefixed English tree) to a Locale. */
export function resolveLocale(param: string | undefined): Locale {
  return isLocale(param) ? param : DEFAULT_LOCALE;
}

/** Best-effort locale from an Accept-Language header (first supported primary
 * subtag), for defaulting a new user's language at registration. Falls back to
 * the default locale. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  for (const part of header.split(",")) {
    const primary = part.split(";")[0].trim().toLowerCase().split("-")[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}

/**
 * Build a locale-aware path from an unprefixed path (always starting with "/").
 * English returns the path unchanged; other locales get the "/xx" prefix.
 *   localePath("de", "/cards")  -> "/de/cards"
 *   localePath("de", "/")       -> "/de"
 *   localePath("en", "/cards")  -> "/cards"
 */
export function localePath(locale: Locale, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return clean;
  return clean === "/" ? `/${locale}` : `/${locale}${clean}`;
}

/** Determine the active locale from a pathname's first segment. */
export function localeFromPathname(pathname: string): Locale {
  const first = pathname.split("/")[1];
  return isLocale(first) ? first : DEFAULT_LOCALE;
}

/** Strip a locale prefix from a pathname, returning the unprefixed path.
 *   stripLocale("/de/cards") -> "/cards";  stripLocale("/de") -> "/" */
export function stripLocalePrefix(pathname: string): string {
  const segments = pathname.split("/");
  if (isLocale(segments[1])) {
    const rest = "/" + segments.slice(2).join("/");
    return rest === "/" ? "/" : rest.replace(/\/$/, "");
  }
  return pathname;
}

/**
 * Unprefixed paths that still have localized pages. Since the static freeze (2026-11-23) only these
 * are built per locale; every other /xx/... URL (card, set, pokemon, riftbound, blog detail) answers a
 * zone 301 to the English page or a 404, so hreflang and the language switcher must not point at them.
 */
export const LOCALIZED_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/cards",
  "/sets",
  "/price-movers",
  "/pokedex",
  "/pokemon-card-collectors",
  "/pokemon-card-grading-calculator",
  "/pricing",
]);

/** True when `path` (unprefixed) has a localized page in every locale. */
export function hasLocalizedPage(path: string): boolean {
  const clean = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return LOCALIZED_PATHS.has(clean || "/");
}

/**
 * hreflang alternates for one unprefixed path: every locale + x-default, as
 * `{ hreflang, href }` pairs for building `<xhtml:link>` sitemap entries or
 * `<link rel=alternate>` tags. `origin` is the site origin (no trailing slash).
 */
export function localeAlternates(
  origin: string,
  path: string,
): { hreflang: string; href: string }[] {
  // Root keeps its trailing slash so the sitemap homepage <loc>/hreflang match
  // the on-page canonical (canonicalUrl keeps "/" for root).
  const href = (p: string) => `${origin}${p === "/" ? "/" : p}`;
  if (!hasLocalizedPage(path)) return [];
  return [
    ...LOCALES.map((l) => ({ hreflang: LANG_TAGS[l], href: href(localePath(l, path)) })),
    { hreflang: "x-default", href: href(path) },
  ];
}
