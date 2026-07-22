import { createContext, type RouterContextProvider } from "react-router";

import type { Game } from "./game/game";
import type { Market } from "./market/market";

/**
 * Typed React Router v8 contexts provided by the Worker fetch handler
 * (workers/app.ts). Loaders/actions read them via `context.get(...)`.
 */

export interface CloudflareContextValue {
  env: Env;
  ctx: ExecutionContext;
}

export const cloudflareContext = createContext<CloudflareContextValue>();

/** Active price market (us=TCGplayer/USD, eu=Cardmarket/EUR) — resolved per
 * request from the market cookie, falling back to Cloudflare geolocation. */
export const marketContext = createContext<Market>();

/** Remembered game preference (pk_game cookie) — the last game the visitor
 * chose. The ACTIVE game is derived from the URL namespace, not this; the cookie
 * only feeds the logo/home link and the switcher's redirect target. */
export const gameContext = createContext<Game>();

/** Correlation ID attached to logs and error responses. */
export const requestIdContext = createContext<string>();

/** Per-request CSP nonce; stamped on all inline scripts so the strict
 * production/staging CSP can drop 'unsafe-inline'. */
export const nonceContext = createContext<string>();

export function getCloudflare(context: Readonly<RouterContextProvider>): CloudflareContextValue {
  return context.get(cloudflareContext);
}

export function getRequestId(context: Readonly<RouterContextProvider>): string {
  return context.get(requestIdContext);
}

export function getMarket(context: Readonly<RouterContextProvider>): Market {
  return context.get(marketContext);
}

export function getGame(context: Readonly<RouterContextProvider>): Game {
  return context.get(gameContext);
}
