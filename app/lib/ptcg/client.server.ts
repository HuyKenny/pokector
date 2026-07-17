/**
 * Typed Pokémon TCG API v2 client (SPEC §15). Server-side only: the API key is
 * sent via X-Api-Key and never leaves the Worker. Includes timeout, retries with
 * exponential backoff + jitter, 429/Retry-After handling, response validation,
 * request counting, and a daily request budget guard (D1 counter — one KV write
 * per API call previously burned through the Free plan's 1k KV writes/day).
 */

import { incrementCounter, readCounter } from "../counters.server";
import { createDb, type Database } from "../db/index.server";
import { log } from "../log.server";
import { PtcgListResponseSchema } from "./types";

const API_BASE = "https://api.pokemontcg.io/v2";
/** Cards per page. Deliberately small: one page must be processable within the
 * Workers Free 10 ms CPU budget (see docs/DECISIONS.md D14). */
export const CARDS_PAGE_SIZE = 50;
export const SETS_PAGE_SIZE = 250;
/** Daily request ceiling (the keyed plan allows 20k/day; keep headroom). */
const DAILY_BUDGET = 15000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 4;

export type PtcgErrorKind =
  "disabled" | "budget_exhausted" | "http" | "network" | "invalid_response";

export class PtcgApiError extends Error {
  constructor(
    readonly kind: PtcgErrorKind,
    message: string,
    readonly status?: number,
    readonly retryable: boolean = kind === "http" || kind === "network",
  ) {
    super(message);
    this.name = "PtcgApiError";
  }
}

function budgetKey(): string {
  return `ptcg:budget:${new Date().toISOString().slice(0, 10)}`;
}

export async function getDailyRequestCount(db: Database): Promise<number> {
  return (await readCounter(db, budgetKey())) ?? 0;
}

export function getDailyBudget(): number {
  return DAILY_BUDGET;
}

async function consumeBudget(db: Database): Promise<void> {
  const used = await incrementCounter(db, budgetKey(), 60 * 60 * 48);
  // null = counter infra failure → proceed (the PTCG API rate-limits upstream
  // anyway); the guard exists to keep us under quota, not to gate correctness.
  if (used !== null && used > DAILY_BUDGET) {
    throw new PtcgApiError(
      "budget_exhausted",
      `Daily Pokémon TCG API budget (${DAILY_BUDGET}) exhausted`,
      undefined,
      false,
    );
  }
}

function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number.parseInt(retryAfterHeader, 10);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 60_000);
  }
  const base = 1000 * 2 ** attempt;
  return base + Math.floor(Math.random() * base * 0.5);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Injectable fetch so automated tests can serve deterministic fixtures. */
let fetchImpl: typeof fetch = (...args) => fetch(...args);

export function __setPtcgFetchForTests(fn: typeof fetch | null): void {
  fetchImpl = fn ?? ((...args) => fetch(...args));
}

export interface PtcgPage {
  items: unknown[];
  totalCount: number;
}

export class PtcgClient {
  constructor(
    private readonly apiKey: string,
    private readonly db: Database,
    private readonly signal?: AbortSignal,
  ) {}

  static fromEnv(env: Env, signal?: AbortSignal): PtcgClient {
    if (!env.POKEMON_TCG_API_KEY) {
      throw new PtcgApiError(
        "disabled",
        "POKEMON_TCG_API_KEY is not configured — real catalog synchronization is disabled. " +
          "Set it with: wrangler secret put POKEMON_TCG_API_KEY",
        undefined,
        false,
      );
    }
    return new PtcgClient(env.POKEMON_TCG_API_KEY, createDb(env.DB), signal);
  }

  async getSetsPage(page: number): Promise<PtcgPage> {
    return this.request(`/sets?page=${page}&pageSize=${SETS_PAGE_SIZE}&orderBy=releaseDate`);
  }

  async getCardsPage(page: number): Promise<PtcgPage> {
    return this.request(`/cards?page=${page}&pageSize=${CARDS_PAGE_SIZE}&orderBy=id`);
  }

  private async request(path: string): Promise<PtcgPage> {
    let lastError: PtcgApiError | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await consumeBudget(this.db);
      const startedAt = Date.now();
      let response: Response;
      try {
        response = await fetchImpl(`${API_BASE}${path}`, {
          headers: { "X-Api-Key": this.apiKey, Accept: "application/json" },
          signal: this.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        lastError = new PtcgApiError(
          "network",
          `Network failure calling PTCG API: ${error instanceof Error ? error.name : "unknown"}`,
        );
        log.warn("ptcg.network_error", { path, attempt, durationMs: Date.now() - startedAt });
        await sleep(backoffMs(attempt, null));
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = new PtcgApiError(
          "http",
          `PTCG API responded ${response.status}`,
          response.status,
        );
        log.warn("ptcg.retryable_status", { path, attempt, status: response.status });
        await sleep(backoffMs(attempt, response.headers.get("Retry-After")));
        continue;
      }

      if (!response.ok) {
        // 4xx other than 429: not retryable.
        throw new PtcgApiError(
          "http",
          `PTCG API responded ${response.status}`,
          response.status,
          false,
        );
      }

      let json: unknown;
      try {
        json = await response.json();
      } catch {
        lastError = new PtcgApiError("invalid_response", "PTCG API returned unparsable JSON");
        await sleep(backoffMs(attempt, null));
        continue;
      }

      const parsed = PtcgListResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new PtcgApiError(
          "invalid_response",
          "PTCG API response failed validation",
          undefined,
          false,
        );
      }

      log.info("ptcg.request", {
        path,
        status: response.status,
        durationMs: Date.now() - startedAt,
        count: parsed.data.data.length,
      });
      return { items: parsed.data.data, totalCount: parsed.data.totalCount };
    }

    throw lastError ?? new PtcgApiError("network", "PTCG API request failed");
  }
}
