/**
 * Minimal TCGCSV client (https://tcgcsv.com — a free daily mirror of TCGplayer's
 * catalog and prices; Pokémon is category 3, Riftbound 89). No key. Usage rules we follow
 * (tcgcsv.com/docs): identifiable User-Agent, check last-updated.txt before
 * syncing, at most one sync per build (~350 requests/day vs. their 10k cap), and
 * product lists — the bulk of the bandwidth — are cached for a week (see
 * handlers/tcgcsv.server.ts).
 */

import type { TcgcsvGroup, TcgcsvPrice, TcgcsvProduct } from "./match";

const API_BASE = "https://tcgcsv.com";
export const POKEMON_CATEGORY = 3;
export const RIFTBOUND_CATEGORY = 89;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const USER_AGENT = "Pokector/1.0 (+https://pokector.com; price sync)";

export class TcgcsvError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TcgcsvError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fetchImpl: typeof fetch = (...args) => fetch(...args);
export function __setTcgcsvFetchForTests(fn: typeof fetch | null): void {
  fetchImpl = fn ?? ((...args) => fetch(...args));
}

async function request(path: string): Promise<Response> {
  let lastError: TcgcsvError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(`${API_BASE}${path}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      lastError = new TcgcsvError(`TCGCSV ${path}: network/timeout`, 0, true);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) return res;
    const retryable = res.status === 429 || res.status >= 500;
    lastError = new TcgcsvError(`TCGCSV ${path}: HTTP ${res.status}`, res.status, retryable);
    if (!retryable) throw lastError;
    await sleep(1000 * 2 ** attempt);
  }
  throw lastError ?? new TcgcsvError(`TCGCSV ${path}: failed`, 0, true);
}

async function results<T>(path: string): Promise<T[]> {
  const body = await (await request(path)).json<{ success?: boolean; results?: T[] }>();
  if (body.success === false || !Array.isArray(body.results)) {
    throw new TcgcsvError(`TCGCSV ${path}: unexpected body`, 200, true);
  }
  return body.results;
}

/** Build date of the current mirror as "YYYY-MM-DD" (from last-updated.txt). */
export async function getBuildDate(): Promise<string> {
  const text = (await (await request("/last-updated.txt")).text()).trim();
  const match = /^(\d{4}-\d{2}-\d{2})T/.exec(text);
  if (!match)
    throw new TcgcsvError(`TCGCSV last-updated.txt: unexpected "${text.slice(0, 40)}"`, 200, true);
  return match[1];
}

export const listGroups = (category = POKEMON_CATEGORY) =>
  results<TcgcsvGroup>(`/tcgplayer/${category}/groups`);

export const listProducts = (groupId: number, category = POKEMON_CATEGORY) =>
  results<TcgcsvProduct>(`/tcgplayer/${category}/${groupId}/products`);

export const listPrices = (groupId: number, category = POKEMON_CATEGORY) =>
  results<TcgcsvPrice>(`/tcgplayer/${category}/${groupId}/prices`);
