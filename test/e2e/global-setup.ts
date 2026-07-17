import { execFileSync } from "node:child_process";

/**
 * Seed the LOCAL D1 with a deterministic slice of catalog data so E2E tests are
 * repeatable without hitting the external API. Idempotent (INSERT OR IGNORE).
 */
export default function globalSetup() {
  const sql = `
    INSERT OR IGNORE INTO pokemon_sets (id, slug, name, name_normalized, series, printed_total, total, release_date, synced_at, active)
    VALUES ('base1','base-base1','Base','base','Base',102,102,'1999-01-09',${Date.now()},1);
    INSERT OR IGNORE INTO pokemon_cards (id, slug, set_id, name, name_normalized, number, number_sort, supertype, rarity, image_small_url, search_text, synced_at, active)
    VALUES ('base1-4','base1-4-charizard','base1','Charizard','charizard','4',4,'Pokémon','Rare Holo','https://images.pokemontcg.io/base1/4.png','charizard base1 4 rare holo fire',${Date.now()},1);
    INSERT OR IGNORE INTO pokemon_cards (id, slug, set_id, name, name_normalized, number, number_sort, supertype, rarity, image_small_url, search_text, synced_at, active)
    VALUES ('base1-2','base1-2-blastoise','base1','Blastoise','blastoise','2',2,'Pokémon','Rare Holo','https://images.pokemontcg.io/base1/2.png','blastoise base1 2 rare holo water',${Date.now()},1);
    INSERT OR IGNORE INTO card_prices_current (card_id, source, variant, currency, normalized_price_minor, market_minor, low_minor, mid_minor, observed_at)
    VALUES ('base1-4','tcgplayer','holofoil','USD',77351,77351,51000,71999,${Date.now()});
    INSERT OR IGNORE INTO card_prices_current (card_id, source, variant, currency, normalized_price_minor, market_minor, observed_at)
    VALUES ('base1-2','tcgplayer','holofoil','USD',23206,23206,${Date.now()});
  `;
  execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", "pokector-staging", "--local", "--command", sql],
    { stdio: "ignore" },
  );
}
