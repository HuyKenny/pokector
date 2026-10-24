/**
 * Minimal TCGdex client (https://api.tcgdex.net/v2/en — community REST API, no
 * key). Only Cardmarket prices come from here: the Pokémon TCG API froze its
 * Cardmarket blocks in 2025 (docs/DECISIONS.md D31). Prices exist per card only,
 * so the sync is rate-limited by design (see handlers/tcgdex.server.ts).
 */

const API_BASE = "https://api.tcgdex.net/v2/en";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ATTEMPTS = 3;
const USER_AGENT = "Pokector/1.0 (+https://pokector.com; price sync)";

export interface TcgdexSetBrief {
  id: string;
  name: string;
}

export interface TcgdexSet extends TcgdexSetBrief {
  cards?: { id: string; localId: string; name: string }[];
}

export interface TcgdexCardmarket {
  updated?: string | null;
  unit?: string | null;
  avg?: number | null;
  low?: number | null;
  trend?: number | null;
}

export interface TcgdexCard {
  id: string;
  pricing?: { cardmarket?: TcgdexCardmarket | null } | null;
}

export class TcgdexError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TcgdexError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fetchImpl: typeof fetch = (...args) => fetch(...args);
export function __setTcgdexFetchForTests(fn: typeof fetch | null): void {
  fetchImpl = fn ?? ((...args) => fetch(...args));
}

/** GET + JSON. A 404 returns null (the card/set simply is not on TCGdex). */
async function getJson<T>(path: string): Promise<T | null> {
  let lastError: TcgdexError | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(`${API_BASE}${path}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      lastError = new TcgdexError(`TCGdex ${path}: network/timeout`, 0, true);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.status === 404) return null;
    if (res.ok) {
      try {
        return await res.json<T>();
      } catch {
        lastError = new TcgdexError(`TCGdex ${path}: invalid JSON`, 200, true);
        continue;
      }
    }
    const retryable = res.status === 429 || res.status >= 500;
    lastError = new TcgdexError(`TCGdex ${path}: HTTP ${res.status}`, res.status, retryable);
    if (!retryable) throw lastError;
    await sleep(1000 * 2 ** attempt);
  }
  throw lastError ?? new TcgdexError(`TCGdex ${path}: failed`, 0, true);
}

export const listSets = async () => (await getJson<TcgdexSetBrief[]>("/sets")) ?? [];

export const getSet = (id: string) => getJson<TcgdexSet>(`/sets/${encodeURIComponent(id)}`);

export const getCard = (id: string) => getJson<TcgdexCard>(`/cards/${encodeURIComponent(id)}`);
