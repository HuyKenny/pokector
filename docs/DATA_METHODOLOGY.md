# Pokector — Data Methodology

This document is the internal source for the public `/methodology` page. It must stay
truthful — no fabricated data, ever.

## Sources

- **Catalog**: Pokémon TCG API (`https://api.pokemontcg.io/v2`), English-language cards
  and sets. Pokector stores a synchronized copy in its own database; visitor searches
  never hit the external API.
- **Prices — primary (USD)**: TCGplayer prices from TCGCSV (`https://tcgcsv.com`, a daily
  mirror of TCGplayer's price files), refreshed daily since 2026-10-24 — see DECISIONS D29.
  Cards are matched to TCGplayer products by set → group and card number; uncertain matches
  stay unpriced. The Pokémon TCG API's TCGplayer blocks remain a fallback and never
  overwrite a newer price.
- **Prices — secondary (EUR)**: Cardmarket price blocks as provided by the Pokémon TCG API
  (frozen at the API's side since 2025-11-18).
  Never merged with USD without explicit conversion (not implemented — displayed
  separately).

## Price normalization

Per card + variant (`normal`, `holofoil`, `reverseHolofoil`, `firstEditionNormal`,
`firstEditionHolofoil` — only variants actually present in source data):

- TCGplayer normalized value = `market` → else `mid` → else `low`.
- Cardmarket normalized value = `trendPrice` → else `averageSellPrice` → else `lowPrice`.
- All stored values are integer minor units (cents), parsed from source decimals with
  a string-based decimal parser (no binary floating point).
- Stored per source: low/mid/high/market/directLow (TCGplayer), trend/averageSell
  (Cardmarket), the selected normalized value, the source's own `updatedAt`, and
  Pokector's observation timestamp.

## Missing prices

A card variant without a source price is **unpriced**: it contributes zero to market
value but is counted and shown as "unpriced" (never silently valued at 0, never
silently switched to another variant). Users may explicitly change an entry's variant.

## Condition

Condition (NM/LP/MP/HP/Damaged) is user metadata. Displayed market value is an
estimated **raw near-mint-market** price and is **not** adjusted by condition. This is
stated on card pages and the methodology page.

## Price history

- History exists only from real observations Pokector recorded — tracking starts when
  a card first becomes tracked (in any collection/wishlist, popular, or needed for
  movers). No backfill, no synthetic history.
- At most one observation per (card, source, variant, currency, calendar day),
  enforced by a unique constraint. Charts carry the last known value forward and state
  the tracking start date.
- Retention: daily observations kept ≥400 days, then aggregated to monthly points; the
  only value in a period is never deleted.

## Portfolio

- Market value = Σ (normalized current price × quantity) over priced entries.
- Cost basis = Σ (purchase price × quantity) over entries with a recorded purchase price.
- Unrealized P/L and ROI computed **only** over entries having both purchase price and
  current price (missing purchase price ≠ 0). Coverage percentages shown for both
  valuation and cost basis.
- Daily snapshots per user+currency start the day the user starts tracking; no
  earlier dates are ever generated.

## Price movers

7-day / 30-day movers require a minimum real history window (≥2 observations spanning
the period). Until enough history exists the page states so and shows nothing —
changes are never fabricated.

## Currency

Default portfolio valuation: USD (TCGplayer). Cardmarket EUR shown as separate
informational values. No implicit FX conversion.
