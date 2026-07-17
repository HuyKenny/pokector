/**
 * Measures key query timings + EXPLAIN QUERY PLAN on the LOCAL D1 (SPEC §24).
 *   node scripts/perf-test.mjs
 * Run after scripts/synth-data.mjs to see behavior at scale. Prints a table and
 * flags any hot-path query that is NOT using an index (SCAN of a big table).
 */
import { execFileSync } from "node:child_process";

const DB = "pokector-staging";

function query(sql) {
  const out = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", DB, "--local", "--json", "--command", sql],
    { encoding: "utf8" },
  );
  return JSON.parse(out)[0]?.results ?? [];
}

const sampleUser = query("SELECT user_id FROM collection_entries LIMIT 1")[0]?.user_id;
if (!sampleUser) {
  console.error("No collection data. Run scripts/synth-data.mjs first.");
  process.exit(1);
}

const CASES = [
  {
    name: "catalog search (name prefix)",
    sql: "SELECT id FROM pokemon_cards WHERE active=1 AND name_normalized LIKE 'char%' LIMIT 24",
  },
  {
    name: "cards by set",
    sql: "SELECT id FROM pokemon_cards WHERE set_id='base1' ORDER BY number_sort LIMIT 24",
  },
  {
    name: "collection by user (page)",
    sql: `SELECT id FROM collection_entries WHERE user_id='${sampleUser}' ORDER BY updated_at DESC LIMIT 25`,
  },
  {
    name: "portfolio sum (user)",
    sql: `SELECT COUNT(*) FROM collection_entries e LEFT JOIN card_prices_current p ON p.card_id=e.card_id AND p.variant=e.variant AND p.source='tcgplayer' AND p.currency='USD' WHERE e.user_id='${sampleUser}'`,
  },
  {
    name: "snapshots by user+date",
    sql: `SELECT market_value_minor FROM portfolio_snapshots WHERE user_id='${sampleUser}' AND currency='USD' ORDER BY snapshot_date DESC LIMIT 30`,
  },
];

console.log(`Sample user: ${sampleUser}\n`);
for (const c of CASES) {
  const plan = query(`EXPLAIN QUERY PLAN ${c.sql}`)
    .map((r) => r.detail)
    .join(" | ");
  const t0 = performance.now();
  query(c.sql);
  const ms = (performance.now() - t0).toFixed(1);
  const fullScan = /SCAN (?!.*USING)/.test(plan) && !plan.includes("pokemon_sets");
  console.log(`• ${c.name}: ${ms} ms (incl. wrangler overhead)`);
  console.log(`    plan: ${plan}`);
  if (fullScan) console.log("    ⚠ possible full scan — check indexes");
}
console.log(
  "\nNote: timings include wrangler CLI startup (~hundreds of ms). The query plan is the" +
    " signal — every hot path should show SEARCH … USING INDEX, not SCAN.",
);
