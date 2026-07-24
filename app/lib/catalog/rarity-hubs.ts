/**
 * Config for the rarity / attribute landing hubs (/pokemon-cards/{slug}).
 * Each maps to a real filter over the catalog (rarity values verified against the
 * DB, or a release-date cutoff for "vintage"). English-only, curated set.
 */
export interface RarityHub {
  label: string; // short nav label
  title: string; // <title>
  h1: string;
  description: string; // meta description
  blurb: string; // on-page intro paragraph
  rarities?: string[];
  releaseBefore?: string; // ISO date; cards from sets released before this
}

export const RARITY_HUBS: Record<string, RarityHub> = {
  "gold-star": {
    label: "Gold Star",
    title: "Gold Star Pokémon Cards — List & Values | Pokector",
    h1: "Gold Star Pokémon Cards",
    description:
      "Every Gold Star Pokémon card ranked by value, with live market prices. The rare ★ Gold Star cards from the EX era are some of the most collectible pulls in the hobby.",
    blurb:
      "Gold Star cards — marked with a gold ★ next to the HP — are ultra-rare alternate-art Pokémon from the EX era (2004–2007), pulled at roughly 1 in 72 packs. They remain among the most sought-after modern-vintage chase cards.",
    rarities: ["Rare Holo Star"],
  },
  promo: {
    label: "Promo",
    title: "Pokémon Promo Cards — List & Values | Pokector",
    h1: "Pokémon Promo Cards",
    description:
      "Pokémon promo (Black Star Promo) cards ranked by value, with live market prices. Event, box-topper and special-release promos across every era.",
    blurb:
      "Promo cards are special releases handed out at events, in tins and collection boxes, or as pre-release promos — many are exclusive prints that never appear in main sets, and the rarer ones carry strong premiums.",
    rarities: ["Promo"],
  },
  "illustration-rare": {
    label: "Illustration Rare",
    title: "Illustration Rare Pokémon Cards (Alt Arts) — Values | Pokector",
    h1: "Illustration Rare Pokémon Cards",
    description:
      "Illustration Rare and Special Illustration Rare Pokémon cards ranked by value — the sought-after 'alt art' cards from Scarlet & Violet — with live market prices.",
    blurb:
      "Illustration Rares and Special Illustration Rares (the 'alt arts') feature full-bleed artwork and are the top chase cards of the Scarlet & Violet era, regularly commanding the highest prices in a set.",
    rarities: ["Illustration Rare", "Special Illustration Rare"],
  },
  "secret-rare": {
    label: "Secret Rare",
    title: "Secret Rare Pokémon Cards — List & Values | Pokector",
    h1: "Secret Rare Pokémon Cards",
    description:
      "Secret Rare Pokémon cards ranked by value, with live market prices. The cards numbered above a set's printed total — the hidden chase cards.",
    blurb:
      "Secret Rares are numbered above a set's printed total (like 201/195) and sit at the very top of a set's rarity ladder — gold, rainbow and special-art cards that are the hardest pulls.",
    rarities: ["Rare Secret"],
  },
  "rainbow-rare": {
    label: "Rainbow Rare",
    title: "Rainbow Rare Pokémon Cards — List & Values | Pokector",
    h1: "Rainbow Rare Pokémon Cards",
    description:
      "Rainbow Rare Pokémon cards ranked by value, with live market prices. The textured rainbow-hued secret rares of the Sun & Moon and Sword & Shield eras.",
    blurb:
      "Rainbow Rares are the pastel, textured secret rares of the Sun & Moon and Sword & Shield eras — hyper-rare versions of popular V, VMAX, GX and EX cards that remain collector favourites.",
    rarities: ["Rare Rainbow"],
  },
  "gold-hyper-rare": {
    label: "Gold / Hyper Rare",
    title: "Gold (Hyper Rare) Pokémon Cards — List & Values | Pokector",
    h1: "Gold & Hyper Rare Pokémon Cards",
    description:
      "Gold and Hyper Rare Pokémon cards ranked by value, with live market prices. The metallic gold secret rares — usually the highest number in a set.",
    blurb:
      "Hyper Rares (the gold cards) are metallic, gold-etched secret rares — typically the highest-numbered card in a modern set — and a staple of every collector's chase list.",
    rarities: ["Hyper Rare"],
  },
  shiny: {
    label: "Shiny",
    title: "Shiny Pokémon Cards — List & Values | Pokector",
    h1: "Shiny Pokémon Cards",
    description:
      "Shiny Pokémon cards ranked by value, with live market prices — the alternate-colour Shiny Vault and shiny rares across sets.",
    blurb:
      "Shiny Pokémon cards show the rare alternate colouring of a Pokémon, from the Shiny Vault subsets to shiny GX and Ultra Rares — a distinct and popular collecting niche.",
    rarities: ["Rare Shiny", "Shiny Rare", "Rare Shiny GX", "Shiny Ultra Rare"],
  },
  vintage: {
    label: "Vintage",
    title: "Vintage Pokémon Cards — List & Values | Pokector",
    h1: "Vintage Pokémon Cards",
    description:
      "Vintage Pokémon cards (WOTC + EX era, pre-2007) ranked by value, with live market prices — Base Set, first editions and the original holos collectors chase.",
    blurb:
      "Vintage Pokémon cards come from the game's early years — the WOTC era (Base Set through e-Card) and the EX era up to 2007. These older, low-supply cards include the hobby's blue-chip holos.",
    releaseBefore: "2007-01-01",
  },
};

export const RARITY_HUB_PATHS = Object.keys(RARITY_HUBS).map((slug) => `/pokemon-cards/${slug}`);
