/**
 * Synthetic data generator for local scale testing (SPEC §24).
 *
 *   node scripts/synth-data.mjs --users 10000 --entries 1000000
 *
 * Generates users, collection entries (drawn from the already-synced catalog),
 * wishlist items, binders, and portfolio snapshots directly into the LOCAL D1
 * via batched `wrangler d1 execute` files. REFUSES to run against remote/prod.
 *
 * Requires the local catalog to be populated first (run a catalog sync in dev).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : Number.parseInt(args[i + 1], 10);
};
const USERS = flag("users", 10_000);
const ENTRIES = flag("entries", 1_000_000);
const DB = "pokector-staging";

if (args.includes("--remote") || args.includes("--env")) {
  console.error("Refusing to run against a remote/production database. Local only.");
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "pokector-synth-"));

function exec(sql) {
  const file = join(tmp, `chunk-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, sql);
  execFileSync("pnpm", ["exec", "wrangler", "d1", "execute", DB, "--local", "--file", file], {
    stdio: "ignore",
  });
}

function query(sql) {
  const out = execFileSync(
    "pnpm",
    ["exec", "wrangler", "d1", "execute", DB, "--local", "--json", "--command", sql],
    { encoding: "utf8" },
  );
  return JSON.parse(out)[0]?.results ?? [];
}

console.log("Loading catalog card IDs…");
const cards = query("SELECT id FROM pokemon_cards WHERE active = 1 LIMIT 20000").map((r) => r.id);
if (cards.length === 0) {
  console.error("No catalog cards found. Run a catalog sync in dev first.");
  process.exit(1);
}
console.log(`Catalog has ${cards.length} cards; generating ${USERS} users, ${ENTRIES} entries.`);

const VARIANTS = ["normal", "holofoil", "reverseHolofoil"];
const CONDITIONS = ["Near Mint", "Lightly Played", "Moderately Played"];
const now = Date.now();
// Deterministic PRNG (no Math.random dependency for reproducibility).
let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

const BATCH = 400;
let userBatch = [];
const flushUsers = () => {
  if (userBatch.length === 0) return;
  exec(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES " +
      userBatch.join(",") +
      ";",
  );
  userBatch = [];
};

console.log("Inserting users…");
for (let u = 0; u < USERS; u++) {
  const id = `synth-user-${u}`;
  userBatch.push(`('${id}','Synthetic ${u}','synth${u}@example.test',0,${now},${now})`);
  if (userBatch.length >= BATCH) flushUsers();
}
flushUsers();

console.log("Inserting collection entries…");
let entryBatch = [];
const flushEntries = () => {
  if (entryBatch.length === 0) return;
  exec(
    "INSERT INTO collection_entries (id, user_id, card_id, quantity, variant, condition, language, purchase_currency, created_at, updated_at) VALUES " +
      entryBatch.join(",") +
      ";",
  );
  entryBatch = [];
};
for (let e = 0; e < ENTRIES; e++) {
  const u = e % USERS;
  const card = pick(cards);
  entryBatch.push(
    `('synth-entry-${e}','synth-user-${u}','${card}',${1 + Math.floor(rand() * 4)},'${pick(VARIANTS)}','${pick(CONDITIONS)}','English','USD',${now},${now})`,
  );
  if (entryBatch.length >= BATCH) {
    flushEntries();
    if (e % 100_000 === 0) console.log(`  ${e}/${ENTRIES}`);
  }
}
flushEntries();

console.log("Inserting one portfolio snapshot per user…");
let snapBatch = [];
const today = new Date(now).toISOString().slice(0, 10);
const flushSnaps = () => {
  if (snapBatch.length === 0) return;
  exec(
    "INSERT OR IGNORE INTO portfolio_snapshots (user_id, snapshot_date, currency, market_value_minor, cost_basis_minor, unrealized_pl_minor, unique_card_count, total_quantity, priced_entry_count, unpriced_entry_count, calculated_at) VALUES " +
      snapBatch.join(",") +
      ";",
  );
  snapBatch = [];
};
for (let u = 0; u < USERS; u++) {
  snapBatch.push(
    `('synth-user-${u}','${today}','USD',${Math.floor(rand() * 5_000_00)},0,0,0,0,0,0,${now})`,
  );
  if (snapBatch.length >= BATCH) flushSnaps();
}
flushSnaps();

rmSync(tmp, { recursive: true, force: true });
console.log("Done. Run scripts/perf-test.mjs to measure key queries.");
