/**
 * Minimal JustTCG API client (server-side only; API key sent via `x-api-key`,
 * never leaves the Worker). Powers the Riftbound catalog + prices sync. Raw
 * fetch with timeout + light retry + a daily request-budget guard (D1 counter,
 * mirroring PtcgClient). Disabled (throws "disabled") when no key is configured.
 *
 * NOTE: JustTCG's exact response field names are confirmed live against the
 * owner's key on staging; responses are read defensively (loose objects) and the
 * field extraction lives in app/lib/riftbound/normalize.ts so it's easy to tune.
 */
import { incrementCounter } from "../counters.server";
import { createDb, type Database } from "../db/index.server";

const API_BASE = "https://api.justtcg.com/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
/** Cards per page. JustTCG caps `limit` at 20 on the current plan (larger 
 * values 400); also comfortably within the Workers Free CPU budget per job. */
export const RIFTBOUND_CARDS_PAGE_SIZE = 20;
/** Daily request ceiling (headroom under paid-tier limits). */
const DAILY_BUDGET = 2000;

export type JustTcgErrorKind = "disabled" | "budget_exhausted" | "http" | "network";

export class JustTcgError extends Error {
  constructor(
    readonly kind: JustTcgErrorKind,
    message: string,
    readonly status?: number,
    readonly retryable: boolean = kind === "http" || kind === "network",
  ) {
    super(message);
    this.name = "JustTcgError";
  }
}

/** Loose row shapes — only the fields the normalizer reads are typed, and all
 * optional, because JustTCG's exact schema is confirmed at integration time. */
export type JustTcgRow = Record<string, unknown>;

export interface JustTcgPage<T = JustTcgRow> {
  data: T[];
  /** True when more pages remain (best-effort across possible envelope shapes). */
  hasMore: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let fetchImpl: typeof fetch = (...args) => fetch(...args);
export function __setJustTcgFetchForTests(fn: typeof fetch | null): void {
  fetchImpl = fn ?? ((...args) => fetch(...args));
}

export class JustTcgClient {
  constructor(
    private readonly apiKey: string,
    private readonly db: Database,
  ) {}

  static fromEnv(env: Env): JustTcgClient {
    if (!env.JUSTTCG_API_KEY) {
      throw new JustTcgError(
        "disabled",
        "JUSTTCG_API_KEY is not configured — Riftbound sync is disabled. " +
          "Set it with: wrangler secret put JUSTTCG_API_KEY",
        undefined,
        false,
      );
    }
    return new JustTcgClient(env.JUSTTCG_API_KEY, createDb(env.DB));
  }

  /** GET /games — used to resolve the Riftbound game id/slug. */
  listGames(): Promise<JustTcgRow[]> {
    return this.request(`/games`).then((p) => p.data);
  }

  /** GET /sets?game=… */
  listSets(game: string): Promise<JustTcgRow[]> {
    return this.request(`/sets?game=${encodeURIComponent(game)}`).then((p) => p.data);
  }

  /** GET /cards?game=…&set=…&limit=…&offset=… (offset paging). */
  listCards(params: {
    game: string;
    set?: string;
    limit?: number;
    offset?: number;
  }): Promise<JustTcgPage> {
    const q = new URLSearchParams({ game: params.game });
    if (params.set) q.set("set", params.set);
    q.set("limit", String(params.limit ?? RIFTBOUND_CARDS_PAGE_SIZE));
    q.set("offset", String(params.offset ?? 0));
    return this.request(`/cards?${q.toString()}`);
  }

  private async request(path: string): Promise<JustTcgPage> {
    const budgetKey = `justtcg:budget:${new Date().toISOString().slice(0, 10)}`;
    let lastError: JustTcgError | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const used = await incrementCounter(this.db, budgetKey, 60 * 60 * 48);
      if (used !== null && used > DAILY_BUDGET) {
        throw new JustTcgError("budget_exhausted", "Daily JustTCG budget exhausted", undefined, false);
      }
      let res: Response;
      try {
        res = await fetchImpl(`${API_BASE}${path}`, {
          headers: { "x-api-key": this.apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch {
        lastError = new JustTcgError("network", "JustTCG request failed (network/timeout)", 0, true);
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.ok) {
        const body: unknown = await res.json();
        return normalizeEnvelope(body);
      }
      const retryable = res.status === 429 || res.status >= 500;
      lastError = new JustTcgError("http", `JustTCG ${res.status}`, res.status, retryable);
      if (!retryable) throw lastError;
      await sleep(1000 * 2 ** attempt);
    }
    throw lastError ?? new JustTcgError("network", "JustTCG request failed", 0, true);
  }
}

/** Coerce the various plausible JustTCG envelope shapes into { data, hasMore }.
 * Accepts `{ data: [...] , meta?: { hasMore } }`, a bare array, or `{ results }`. */
function normalizeEnvelope(body: unknown): JustTcgPage {
  if (Array.isArray(body)) return { data: body as JustTcgRow[], hasMore: false };
  if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const data = (Array.isArray(obj.data) ? obj.data : Array.isArray(obj.results) ? obj.results : []) as JustTcgRow[];
    const meta = (obj.meta ?? obj._metadata ?? {}) as Record<string, unknown>;
    const hasMore =
      typeof meta.hasMore === "boolean"
        ? meta.hasMore
        : typeof obj.hasMore === "boolean"
          ? obj.hasMore
          : data.length > 0 && data.length >= RIFTBOUND_CARDS_PAGE_SIZE;
    return { data, hasMore };
  }
  return { data: [], hasMore: false };
}
