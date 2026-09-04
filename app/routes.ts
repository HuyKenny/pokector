import { index, layout, prefix, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  // ── Public site (shared header/footer layout) ──────────────────────────────
  layout("routes/public/layout.tsx", [
    index("routes/public/home.tsx"),
    route("cards", "routes/public/cards.tsx"),
    route("cards/compare", "routes/public/cards.compare.tsx"),
    route("cards/:slug", "routes/public/cards.$slug.tsx"),
    route("sets", "routes/public/sets.tsx"),
    route("sets/:slug", "routes/public/sets.$slug.tsx"),
    // Riftbound (second game) — read-only catalog under its own namespace.
    route("riftbound", "routes/public/riftbound.tsx"),
    route("riftbound/cards", "routes/public/riftbound.cards.tsx"),
    route("riftbound/cards/:slug", "routes/public/riftbound.cards.$slug.tsx"),
    route("riftbound/sets", "routes/public/riftbound.sets.tsx"),
    route("riftbound/sets/:slug", "routes/public/riftbound.sets.$slug.tsx"),
    route("riftbound/champions/:name", "routes/public/riftbound.champions.$name.tsx"),
    route("price-movers", "routes/public/price-movers.tsx"),
    route("pokedex", "routes/public/pokedex.tsx"),
    // Per-Pokémon hubs — EN-only (inline copy), unprefixed tree only.
    route("pokemon/:name", "routes/public/pokemon.$name.tsx"),
    route("pokemon-sets", "routes/public/pokemon-sets.tsx"),
    route("pokemon-cards/:attr", "routes/public/pokemon-cards.$attr.tsx"),
    route("pokemon-card-collectors", "routes/public/collectors.tsx"),
    route("pokemon-card-grading-calculator", "routes/public/grading.tsx"),
    route("most-valuable-pokemon-cards", "routes/public/most-valuable-pokemon-cards.tsx"),
    route("pricing", "routes/public/pricing.tsx"),
    route("methodology", "routes/public/methodology.tsx"),
    route("about", "routes/public/about.tsx"),
    route("contact", "routes/public/contact.tsx"),
    route("privacy", "routes/public/privacy.tsx"),
    route("terms", "routes/public/terms.tsx"),
    route("disclaimer", "routes/public/disclaimer.tsx"),
    route("blog", "routes/public/blog.tsx"),
    route("blog/:slug", "routes/public/blog.$slug.tsx"),
    route("binders/:publicSlug", "routes/public/binders.$publicSlug.tsx"),
  ]),

  // ── Localized public site (/:locale — de/es/ru/zh/cs/fr/pt/ja/vi/ar) ────────
  // English stays at the unprefixed root above; this tree duplicates the
  // TRANSLATED public surface under a locale prefix. Legal, blog, /app, /admin
  // are intentionally NOT here (they stay English; /de/terms → 301 /terms via
  // the catchall). Static top-level routes below (sitemap.xml, api, login…)
  // outrank ":locale" by specificity, so they are never shadowed.
  route(":locale", "routes/locale-guard.tsx", [
    layout("routes/public/layout.tsx", { id: "l10n/public/layout" }, [
      index("routes/public/home.tsx", { id: "l10n/public/home" }),
      route("cards", "routes/public/cards.tsx", { id: "l10n/public/cards" }),
      route("cards/compare", "routes/public/cards.compare.tsx", {
        id: "l10n/public/cards.compare",
      }),
      route("cards/:slug", "routes/public/cards.$slug.tsx", { id: "l10n/public/cards.$slug" }),
      route("sets", "routes/public/sets.tsx", { id: "l10n/public/sets" }),
      route("sets/:slug", "routes/public/sets.$slug.tsx", { id: "l10n/public/sets.$slug" }),
      // NOTE: /riftbound/* and /most-valuable-pokemon-cards are EN-only (inline
      // English copy, not translated) → registered ONLY in the unprefixed tree
      // above. Localized requests (/de/riftbound…) 301 to the English URL via the
      // catchall, so we never emit false-language hreflang for untranslated pages.
      route("price-movers", "routes/public/price-movers.tsx", { id: "l10n/public/price-movers" }),
      route("pokedex", "routes/public/pokedex.tsx", { id: "l10n/public/pokedex" }),
      route("pokemon-card-collectors", "routes/public/collectors.tsx", {
        id: "l10n/public/collectors",
      }),
      route("pokemon-card-grading-calculator", "routes/public/grading.tsx", {
        id: "l10n/public/grading",
      }),
      route("pricing", "routes/public/pricing.tsx", { id: "l10n/public/pricing" }),
      route("binders/:publicSlug", "routes/public/binders.$publicSlug.tsx", {
        id: "l10n/public/binders.$publicSlug",
      }),
    ]),
    route("login", "routes/auth/login.tsx", { id: "l10n/auth/login" }),
    route("register", "routes/auth/register.tsx", { id: "l10n/auth/register" }),
    route("forgot-password", "routes/auth/forgot-password.tsx", {
      id: "l10n/auth/forgot-password",
    }),
    route("reset-password", "routes/auth/reset-password.tsx", { id: "l10n/auth/reset-password" }),
  ]),

  // ── Preferences ────────────────────────────────────────────────────────────
  route("market", "routes/market.ts"), // POST: switch price market (cookie)
  route("locale", "routes/locale.ts"), // POST: switch UI language (profile, signed-in)
  route("game", "routes/game.ts"), // POST: switch trading-card game (cookie)

  // ── SEO / machine endpoints ────────────────────────────────────────────────
  route("health", "routes/health.ts"),
  route("robots.txt", "routes/seo/robots.ts"),
  route("sitemap.xml", "routes/seo/sitemap-index.ts"),
  route("sitemap-static.xml", "routes/seo/sitemap-static.ts"),
  route("sitemap-sets.xml", "routes/seo/sitemap-sets.ts"),
  route("sitemap-riftbound.xml", "routes/seo/sitemap-riftbound.ts"),
  route("sitemap-pokemon.xml", "routes/seo/sitemap-pokemon.ts"),
  route("sitemap-blog.xml", "routes/seo/sitemap-blog.ts"),
  route("sitemap-cards/:chunk", "routes/seo/sitemap-cards.ts"),
  route("rss.xml", "routes/seo/rss.ts"),
  route(".well-known/security.txt", "routes/seo/security-txt.ts"),

  // ── Auth ───────────────────────────────────────────────────────────────────
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("login", "routes/auth/login.tsx"),
  route("register", "routes/auth/register.tsx"),
  route("forgot-password", "routes/auth/forgot-password.tsx"),
  route("reset-password", "routes/auth/reset-password.tsx"),
  route("logout", "routes/auth/logout.ts"),

  // ── Versioned JSON API (public, cacheable) ─────────────────────────────────
  route("api/v1/cards", "routes/api/v1.cards.ts"),
  route("api/v1/cards/suggest", "routes/api/v1.cards.suggest.ts"),
  route("api/v1/cards/:id", "routes/api/v1.cards.$id.ts"),
  route("api/v1/sets", "routes/api/v1.sets.ts"),
  route("api/v1/sets/:id", "routes/api/v1.sets.$id.ts"),
  route("api/v1/price-movers", "routes/api/v1.price-movers.ts"),
  // Quick-add API (public card page CTAs)
  route("api/v1/collection/quick-add", "routes/api/collection-quick-add.ts"),
  route("api/v1/wishlist/quick-add", "routes/api/wishlist-quick-add.ts"),
  // Pokédex personal overlay (owned counts + favourites) — fetched client-side
  route("api/v1/pokedex/me", "routes/api/pokedex-me.ts"),
  route("api/v1/pokedex/favorite", "routes/api/pokedex-favorite.ts"),
  // eBay Marketplace Account Deletion compliance webhook
  route("api/ebay/marketplace-deletion", "routes/api/ebay-marketplace-deletion.ts"),

  // ── Administration ─────────────────────────────────────────────────────────
  layout("routes/admin/layout.tsx", [
    ...prefix("admin", [
      index("routes/admin/index.tsx"),
      route("users", "routes/admin/users.tsx"),
      route("audit-log", "routes/admin/audit-log.tsx"),
    ]),
  ]),

  // ── Authenticated application ──────────────────────────────────────────────
  layout("routes/app/layout.tsx", [
    ...prefix("app", [
      index("routes/app/index.tsx"),
      route("collection", "routes/app/collection.tsx"),
      route("collection/search", "routes/app/collection-search.ts"),
      route("binders", "routes/app/binders.tsx"),
      route("binders/:binderId", "routes/app/binders.$binderId.tsx"),
      route("sets", "routes/app/sets.tsx"),
      route("sets/:setSlug", "routes/app/sets.$setSlug.tsx"),
      route("sets/:setSlug/export-missing", "routes/app/sets.$setSlug.export-missing.ts"),
      route("wishlist", "routes/app/wishlist.tsx"),
      route("sales", "routes/app/sales.tsx"),
      route("notifications", "routes/app/notifications.tsx"),
      route("import", "routes/app/import.tsx"),
      route("export", "routes/app/export.tsx"),
      route("export/download", "routes/app/export.download.ts"),
      route("account-export", "routes/app/account-export.ts"),
      route("onboarding", "routes/app/onboarding.tsx"),
      route("settings", "routes/app/settings.tsx"),
      route("billing", "routes/app/billing.tsx"),
    ]),
  ]),

  // ── 404 ────────────────────────────────────────────────────────────────────
  route("*", "routes/catchall.tsx"),
] satisfies RouteConfig;
