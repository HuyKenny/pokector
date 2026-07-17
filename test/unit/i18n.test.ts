import { describe, expect, it } from "vitest";

import en from "~/lib/i18n/dictionaries/en";
import { getDict } from "~/lib/i18n/dictionaries.server";
import {
  isLocale,
  LANG_TAGS,
  localeFromPathname,
  localePath,
  LOCALES,
  resolveLocale,
  stripLocalePrefix,
} from "~/lib/i18n/locales";
import { interpolate, plural } from "~/lib/i18n/t";

describe("locale helpers", () => {
  it("isLocale accepts known prefixes and rejects others", () => {
    expect(isLocale("de")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("xx")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });

  it("resolveLocale falls back to en for missing/invalid params", () => {
    expect(resolveLocale("de")).toBe("de");
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale("zzz")).toBe("en");
  });

  it("localePath prefixes non-default locales and leaves English bare", () => {
    expect(localePath("en", "/cards")).toBe("/cards");
    expect(localePath("de", "/cards")).toBe("/de/cards");
    expect(localePath("de", "/")).toBe("/de");
    expect(localePath("en", "/")).toBe("/");
    expect(localePath("ja", "/sets/base1")).toBe("/ja/sets/base1");
  });

  it("localeFromPathname reads the first segment", () => {
    expect(localeFromPathname("/de/cards")).toBe("de");
    expect(localeFromPathname("/cards")).toBe("en");
    expect(localeFromPathname("/")).toBe("en");
    expect(localeFromPathname("/xx/cards")).toBe("en");
  });

  it("stripLocalePrefix removes a leading locale segment", () => {
    expect(stripLocalePrefix("/de/cards")).toBe("/cards");
    expect(stripLocalePrefix("/de")).toBe("/");
    expect(stripLocalePrefix("/cards")).toBe("/cards");
  });

  it("every locale has a BCP-47 tag", () => {
    for (const l of LOCALES) expect(LANG_TAGS[l]).toBeTruthy();
    expect(LANG_TAGS.zh).toBe("zh-Hans");
    expect(LANG_TAGS.pt).toBe("pt-BR");
  });
});

describe("interpolate / plural", () => {
  it("substitutes placeholders and leaves unknown ones literal", () => {
    expect(interpolate("{count} cards", { count: 3 })).toBe("3 cards");
    expect(interpolate("hi {name}", {})).toBe("hi {name}");
  });

  it("selects plural forms via CLDR rules", () => {
    const forms = { one: "{count} card", other: "{count} cards" };
    expect(plural("en", 1, forms)).toBe("1 card");
    expect(plural("en", 5, forms)).toBe("5 cards");
  });
});

describe("dictionary parity", () => {
  type Keys = string[];
  function keyPaths(obj: Record<string, unknown>, prefix = ""): Keys {
    const out: Keys = [];
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object") out.push(...keyPaths(v as Record<string, unknown>, path));
      else out.push(path);
    }
    return out;
  }
  function leafValues(obj: Record<string, unknown>): string[] {
    const out: string[] = [];
    for (const v of Object.values(obj)) {
      if (v && typeof v === "object") out.push(...leafValues(v as Record<string, unknown>));
      else out.push(String(v));
    }
    return out;
  }

  const enKeys = keyPaths(en).sort();

  for (const locale of LOCALES) {
    it(`${locale} has exactly the English key set and no empty strings`, () => {
      const dict = getDict(locale) as unknown as Record<string, unknown>;
      expect(keyPaths(dict).sort()).toEqual(enKeys);
      for (const value of leafValues(dict)) expect(value.length).toBeGreaterThan(0);
    });
  }
});
