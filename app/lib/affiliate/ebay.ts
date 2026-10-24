/**
 * eBay Partner Network (EPN) affiliate links. We link to an eBay search for the
 * card so visitors can buy a copy; a sale earns commission on the campaign.
 *
 * The Campaign ID is NOT a secret — it appears in every outbound affiliate link
 * and is safe to ship in the client bundle / config (unlike the eBay Developer
 * API keys, which we don't use here). No API call is made: the link is built
 * from public tracking parameters, so there's nothing to rate-limit or cache.
 */

export interface EbayMarketplace {
  /** eBay site host, e.g. "www.ebay.com". */
  host: string;
  /** EPN `siteid` for the marketplace (US = 0, DE = 77). */
  siteId: string;
  /** EPN `mkrid` rotation id for the marketplace. */
  mkrid: string;
}

/** United States (ebay.com) — matches our English cards + USD pricing. */
export const EBAY_US: EbayMarketplace = {
  host: "www.ebay.com",
  siteId: "0",
  mkrid: "711-53200-19255-0",
};

/** Germany (ebay.de) — kept for an easy EU switch later. */
export const EBAY_DE: EbayMarketplace = {
  host: "www.ebay.de",
  siteId: "77",
  mkrid: "707-53477-19255-0",
};

/**
 * Build an EPN-tracked eBay search URL for `query`. Returns null when no
 * campaign id is configured, so callers hide the button (fail-closed — never
 * emit an untracked link that earns nothing).
 */
export function buildEbaySearchUrl(
  query: string,
  campaignId: string | undefined | null,
  market: EbayMarketplace = EBAY_US,
): string | null {
  const trimmed = query.trim();
  if (!campaignId || trimmed.length === 0) return null;
  const params = new URLSearchParams({
    _nkw: trimmed,
    mkcid: "1", // marketing channel: eBay Partner Network
    mkrid: market.mkrid, // rotation id (per marketplace)
    siteid: market.siteId,
    campid: campaignId,
    toolid: "10001",
    mkevt: "1", // required tracking-event flag
  });
  return `https://${market.host}/sch/i.html?${params.toString()}`;
}

/** Search phrase for a card: name + set (+ "Pokémon" to keep off-category
 * listings out for generically-named cards like "Bill" or "Energy"). */
export function ebayCardQuery(cardName: string, setName: string): string {
  return [cardName, setName, "Pokémon"]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}
