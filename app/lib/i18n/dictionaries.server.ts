/**
 * Server-only dictionary registry. The `.server` suffix guarantees this module
 * (and therefore all 11 translation objects) is never bundled into the client —
 * components receive only the small namespace slices their loaders return, so
 * the browser never downloads 11 languages.
 *
 * getDict() is a plain property lookup (no runtime parsing) to stay well inside
 * the Workers Free 10 ms CPU budget.
 */

import type { Dict } from "./dictionaries/en";
import en from "./dictionaries/en";
import de from "./dictionaries/de";
import es from "./dictionaries/es";
import ru from "./dictionaries/ru";
import zh from "./dictionaries/zh";
import cs from "./dictionaries/cs";
import fr from "./dictionaries/fr";
import pt from "./dictionaries/pt";
import ja from "./dictionaries/ja";
import vi from "./dictionaries/vi";
import ar from "./dictionaries/ar";

import type { Locale } from "./locales";

const DICTIONARIES: Record<Locale, Dict> = { en, de, es, ru, zh, cs, fr, pt, ja, vi, ar };

export function getDict(locale: Locale): Dict {
  return DICTIONARIES[locale];
}

export type { Dict };
