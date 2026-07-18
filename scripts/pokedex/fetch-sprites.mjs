/**
 * One-time downloader: official front-default Pokémon sprites (#1..#1025) into
 * public/sprites/{dex}.png, served from our own origin ('self') so the strict
 * img CSP needs no change. Committed as static assets.
 *
 * Run once with Node 22:  node scripts/pokedex/fetch-sprites.mjs
 * Source: PokeAPI sprites repo (front-default pixel sprites, ~1-3 KB each).
 */
import { Buffer } from "node:buffer";
import { writeFile, mkdir } from "node:fs/promises";

const MAX_DEX = 1025;
const CONCURRENCY = 16;
const BASE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon";
const OUT_DIR = new URL("../../public/sprites/", import.meta.url);

async function download(id) {
  const res = await fetch(`${BASE}/${id}.png`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`sprite ${id}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(new URL(`${id}.png`, OUT_DIR), buf);
  return true;
}

async function run() {
  await mkdir(OUT_DIR, { recursive: true });
  const ids = Array.from({ length: MAX_DEX }, (_, i) => i + 1);
  let next = 0;
  const missing = [];
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      let attempt = 0;
      for (;;) {
        try {
          const ok = await download(id);
          if (!ok) missing.push(id);
          break;
        } catch (e) {
          if (++attempt >= 4) throw e;
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
      if (id % 100 === 0) console.log(`  …${id}/${MAX_DEX}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`Done. Missing sprites: ${missing.length ? missing.join(", ") : "none"}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
