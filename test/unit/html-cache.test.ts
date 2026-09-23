import { describe, expect, it } from "vitest";

import { isCacheable, isStorable } from "../../workers/html-cache";

/**
 * The shared cache is keyed on the URL alone, so every case below is really the
 * same question: could two different visitors get the same bytes? Anything that
 * renders per visitor must answer "no". The staging deploy on 2026-09-23 proved
 * the mechanism works (MISS → HIT); these tests pin the exclusions that make it
 * safe.
 */
const priprava = (cesta: string, init: RequestInit = {}) => {
  const url = new URL(`https://pokector.com${cesta}`);

  return { request: new Request(url, init), url };
};

describe("isCacheable", () => {
  it("accepts anonymous public pages", () => {
    for (const cesta of ["/", "/cards", "/cards/base1-4-charizard", "/de/cards", "/pricing"]) {
      expect(isCacheable(...(Object.values(priprava(cesta)) as [Request, URL]))).toBe(true);
    }
  });

  it("refuses anything but GET", () => {
    expect(
      isCacheable(...(Object.values(priprava("/cards", { method: "POST" })) as [Request, URL])),
    ).toBe(false);
  });

  it("refuses the app, admin and API trees — with and without a trailing slash", () => {
    for (const cesta of [
      "/app",
      "/app/",
      "/app/collection",
      "/admin",
      "/admin/users",
      "/api",
      "/api/",
      "/api/v1/cards",
    ]) {
      expect(isCacheable(...(Object.values(priprava(cesta)) as [Request, URL]))).toBe(false);
    }
  });

  it("refuses public binders, bare and localised", () => {
    expect(isCacheable(...(Object.values(priprava("/binders/abc")) as [Request, URL]))).toBe(false);
    expect(isCacheable(...(Object.values(priprava("/de/binders/abc")) as [Request, URL]))).toBe(
      false,
    );
  });

  it("refuses auth and preference pages, bare and localised", () => {
    for (const cesta of [
      "/login",
      "/de/login",
      "/register",
      "/reset-password",
      "/forgot-password",
      "/logout",
      "/health",
    ]) {
      expect(isCacheable(...(Object.values(priprava(cesta)) as [Request, URL]))).toBe(false);
    }
  });

  it("refuses searches, which are per-query and rate-limited", () => {
    expect(isCacheable(...(Object.values(priprava("/cards?q=charizard")) as [Request, URL]))).toBe(
      false,
    );
  });

  it("refuses requests carrying a personalisation cookie", () => {
    for (const cookie of [
      "pk_market=eu",
      "pk_game=riftbound",
      "pokector.session_token=abc",
      "pokector.session_data=abc",
    ]) {
      const { request, url } = priprava("/cards", { headers: { cookie } });
      expect(isCacheable(request, url)).toBe(false);
    }
  });

  it("still caches when an unrelated cookie is present", () => {
    const { request, url } = priprava("/cards", { headers: { cookie: "_ga=GA1.1.123" } });

    expect(isCacheable(request, url)).toBe(true);
  });
});

describe("isStorable", () => {
  const odpoved = (init: ResponseInit) => new Response("x", init);

  it("stores a 200 with an explicit shared TTL", () => {
    expect(isStorable(odpoved({ headers: { "Cache-Control": "public, s-maxage=300" } }))).toBe(
      true,
    );
  });

  it("refuses private, no-store and missing TTLs", () => {
    for (const cc of ["private, no-store", "private, max-age=300", "public", "no-cache"]) {
      expect(isStorable(odpoved({ headers: { "Cache-Control": cc } }))).toBe(false);
    }
  });

  it("refuses non-200 responses", () => {
    expect(isStorable(odpoved({ status: 404, headers: { "Cache-Control": "s-maxage=300" } }))).toBe(
      false,
    );
  });
});
