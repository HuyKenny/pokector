/**
 * Tiny translation helpers (client-safe). No i18n library — dictionaries are
 * plain nested objects delivered via loader data, so this only handles string
 * interpolation and plural selection.
 */

import { LANG_TAGS, type Locale } from "./locales";

/**
 * Replace `{name}` placeholders in a template with values.
 *   interpolate("{count} cards", { count: 3 }) -> "3 cards"
 * Missing keys are left as the literal placeholder (surfaces gaps in dev).
 */
export function interpolate(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/**
 * Select a plural form for `count` using the locale's CLDR plural rules.
 * `forms` maps Intl.PluralRules categories to templates; falls back to "other".
 * The chosen template is interpolated with `{count}` already provided.
 *   plural("de", 2, { one: "{count} Karte", other: "{count} Karten" })
 */
export function plural(
  locale: Locale,
  count: number,
  forms: Partial<Record<Intl.LDMLPluralRule, string>>,
): string {
  const rule = new Intl.PluralRules(LANG_TAGS[locale]).select(count);
  const template = forms[rule] ?? forms.other ?? "";
  return interpolate(template, { count });
}
