import { describe, expect, it } from "vitest";

import { buildEbaySearchUrl, ebayCardQuery, EBAY_DE, EBAY_US } from "./ebay";

describe("buildEbaySearchUrl", () => {
  it("builds a US EPN-tracked search link with all tracking params", () => {
    const url = buildEbaySearchUrl("Charizard Base Pokémon", "5339136550");
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.host).toBe("www.ebay.com");
    expect(parsed.pathname).toBe("/sch/i.html");
    expect(parsed.searchParams.get("_nkw")).toBe("Charizard Base Pokémon");
    expect(parsed.searchParams.get("campid")).toBe("5339136550");
    expect(parsed.searchParams.get("mkcid")).toBe("1");
    expect(parsed.searchParams.get("mkrid")).toBe(EBAY_US.mkrid);
    expect(parsed.searchParams.get("siteid")).toBe("0");
    expect(parsed.searchParams.get("toolid")).toBe("10001");
    expect(parsed.searchParams.get("mkevt")).toBe("1");
  });

  it("honors an alternate marketplace", () => {
    const url = buildEbaySearchUrl("Pikachu", "5339136550", EBAY_DE);
    const parsed = new URL(url!);
    expect(parsed.host).toBe("www.ebay.de");
    expect(parsed.searchParams.get("siteid")).toBe("77");
    expect(parsed.searchParams.get("mkrid")).toBe(EBAY_DE.mkrid);
  });

  it("fails closed without a campaign id or query", () => {
    expect(buildEbaySearchUrl("Charizard", undefined)).toBeNull();
    expect(buildEbaySearchUrl("Charizard", "")).toBeNull();
    expect(buildEbaySearchUrl("   ", "5339136550")).toBeNull();
  });
});

describe("ebayCardQuery", () => {
  it("combines name + set + Pokémon and trims", () => {
    expect(ebayCardQuery("Charizard", "Base")).toBe("Charizard Base Pokémon");
    expect(ebayCardQuery("  Pikachu ", " Jungle ")).toBe("Pikachu Jungle Pokémon");
  });
});
