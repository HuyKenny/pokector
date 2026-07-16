/**
 * Downloads real Pokémon TCG API responses into test/fixtures/ptcg/ for
 * deterministic tests. Requires POKEMON_TCG_API_KEY in the environment
 * (see docs/SECRETS.md). Run: node scripts/fetch-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = "https://api.pokemontcg.io/v2";
const KEY = process.env.POKEMON_TCG_API_KEY ?? "";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "ptcg");

async function get(path, attempt = 1) {
  const res = await fetch(`${API}${path}`, {
    headers: KEY ? { "X-Api-Key": KEY } : {},
    signal: AbortSignal.timeout(60_000),
  }).catch((err) => {
    if (attempt >= 5) throw err;
    return null;
  });
  if (!res || res.status === 429 || res.status >= 500) {
    if (attempt >= 5) throw new Error(`Failed after 5 attempts: ${path} (${res?.status})`);
    const delay = 2 ** attempt * 1000;
    console.log(`retry ${attempt} for ${path} in ${delay}ms (status ${res?.status ?? "network"})`);
    await new Promise((r) => setTimeout(r, delay));
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
}

mkdirSync(OUT, { recursive: true });

const targets = [
  // All sets (small payload, ~170 records)
  ["sets.json", "/sets?pageSize=250&orderBy=releaseDate"],
  // Base Set: 1st-edition variants, holofoils — rich TCGplayer variant coverage
  ["cards-base1.json", "/cards?q=set.id:base1&pageSize=250"],
  // Modern set page: reverseHolofoil + cardmarket coverage
  ["cards-sv1-page1.json", "/cards?q=set.id:sv1&pageSize=60&page=1"],
];

for (const [file, path] of targets) {
  console.log(`fetching ${path} ...`);
  const data = await get(path);
  writeFileSync(join(OUT, file), JSON.stringify(data, null, 1));
  console.log(`  → ${file}: ${data.data?.length ?? 0} records, totalCount=${data.totalCount}`);
}
console.log("done");
