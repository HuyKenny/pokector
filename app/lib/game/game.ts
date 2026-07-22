/**
 * Game registry + helpers (client-safe — no server imports, so it bundles into
 * the client like market.ts / locales.ts).
 *
 * A "game" is which trading-card game the visitor is browsing. Pokémon is the
 * default and lives at the unprefixed root (`/cards`, `/sets`); other games live
 * under a URL namespace (`/riftbound/cards`). The *active* game is derived from
 * the URL (namespace), which keeps public pages CDN-cache-correct; the `pk_game`
 * cookie only remembers the last choice so the logo/home link and the switcher
 * land the visitor back in their preferred game.
 */

export const GAMES = ["pokemon", "riftbound"] as const;
export type Game = (typeof GAMES)[number];

export const DEFAULT_GAME: Game = "pokemon";

/** Cookie that remembers the visitor's chosen game. */
export const GAME_COOKIE = "pk_game";

/** URL namespace prefix per game. The default game is unprefixed (SEO: it keeps
 * the existing `/cards` `/sets` URLs); others get a `/xxx` segment. */
export const GAME_PREFIX: Record<Game, string> = {
  pokemon: "",
  riftbound: "/riftbound",
};

/** Endonym-ish label for the switcher (localized labels live in the dicts). */
export const GAME_NAME: Record<Game, string> = {
  pokemon: "Pokémon",
  riftbound: "Riftbound",
};

export function isGame(value: unknown): value is Game {
  return typeof value === "string" && (GAMES as readonly string[]).includes(value);
}

/** Coerce an arbitrary string (cookie value, form field) to a Game. */
export function resolveGame(value: string | null | undefined): Game {
  return isGame(value) ? value : DEFAULT_GAME;
}

/** Read the game cookie out of a raw Cookie header. */
export function gameFromCookieHeader(cookieHeader: string | null): Game | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.split("=");
    if (k?.trim() === GAME_COOKIE) return isGame(v?.trim()) ? (v.trim() as Game) : null;
  }
  return null;
}

/** The active game for a pathname: `/riftbound/...` → riftbound, else the
 * default (Pokémon). This is the authoritative signal for what's rendered. */
export function gameFromPathname(pathname: string): Game {
  const first = pathname.split("/")[1];
  return first === "riftbound" ? "riftbound" : DEFAULT_GAME;
}

/** Build a game-namespaced path from an unprefixed path (always starts with "/").
 *   gamePath("riftbound", "/cards") -> "/riftbound/cards"
 *   gamePath("pokemon", "/cards")   -> "/cards"
 *   gamePath("riftbound", "/")      -> "/riftbound" */
export function gamePath(game: Game, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  const prefix = GAME_PREFIX[game];
  if (!prefix) return clean;
  return clean === "/" ? prefix : `${prefix}${clean}`;
}
