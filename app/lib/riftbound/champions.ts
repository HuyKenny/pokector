/**
 * Curated Riftbound champion hubs (/riftbound/champions/{slug}). `term` is the
 * name substring matched against card names (verified format e.g.
 * "Ahri - Nine-Tailed Fox (Signature)"). English-only.
 */
export interface Champion {
  name: string;
  term: string;
}

export const RIFTBOUND_CHAMPIONS: Record<string, Champion> = {
  ahri: { name: "Ahri", term: "Ahri" },
  kaisa: { name: "Kai'Sa", term: "Kai'Sa" },
  irelia: { name: "Irelia", term: "Irelia" },
  draven: { name: "Draven", term: "Draven" },
  vex: { name: "Vex", term: "Vex" },
  "miss-fortune": { name: "Miss Fortune", term: "Miss Fortune" },
  jinx: { name: "Jinx", term: "Jinx" },
  lux: { name: "Lux", term: "Lux" },
  yasuo: { name: "Yasuo", term: "Yasuo" },
  garen: { name: "Garen", term: "Garen" },
  darius: { name: "Darius", term: "Darius" },
  viktor: { name: "Viktor", term: "Viktor" },
  "lee-sin": { name: "Lee Sin", term: "Lee Sin" },
  volibear: { name: "Volibear", term: "Volibear" },
  jhin: { name: "Jhin", term: "Jhin" },
  zed: { name: "Zed", term: "Zed" },
  ashe: { name: "Ashe", term: "Ashe" },
  teemo: { name: "Teemo", term: "Teemo" },
};

export const RIFTBOUND_CHAMPION_PATHS = Object.keys(RIFTBOUND_CHAMPIONS).map(
  (slug) => `/riftbound/champions/${slug}`,
);
