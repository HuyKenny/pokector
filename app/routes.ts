import { index, layout, prefix, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  // ── Public site (shared header/footer layout) ──────────────────────────────
  layout("routes/public/layout.tsx", [
    index("routes/public/home.tsx"),
    route("cards", "routes/public/cards.tsx"),
    route("cards/:slug", "routes/public/cards.$slug.tsx"),
    route("sets", "routes/public/sets.tsx"),
    route("sets/:slug", "routes/public/sets.$slug.tsx"),
    route("price-movers", "routes/public/price-movers.tsx"),
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
      route("cards/:slug", "routes/public/cards.$slug.tsx", { id: "l10n/public/cards.$slug" }),
      route("sets", "routes/public/sets.tsx", { id: "l10n/public/sets" }),
      route("sets/:slug", "routes/public/sets.$slug.tsx", { id: "l10n/public/sets.$slug" }),
      route("price-movers", "routes/public/price-movers.tsx", { id: "l10n/public/price-movers" }),
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

  // ── SEO / machine endpoints ────────────────────────────────────────────────
  route("health", "routes/health.ts"),
  route("robots.txt", "routes/seo/robots.ts"),
  route("sitemap.xml", "routes/seo/sitemap-index.ts"),
  route("sitemap-static.xml", "routes/seo/sitemap-static.ts"),
  route("sitemap-sets.xml", "routes/seo/sitemap-sets.ts"),
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
  route("api/v1/cards/:id", "routes/api/v1.cards.$id.ts"),
  route("api/v1/sets", "routes/api/v1.sets.ts"),
  route("api/v1/sets/:id", "routes/api/v1.sets.$id.ts"),
  route("api/v1/price-movers", "routes/api/v1.price-movers.ts"),
  // Quick-add API (public card page CTAs)
  route("api/v1/collection/quick-add", "routes/api/collection-quick-add.ts"),
  route("api/v1/wishlist/quick-add", "routes/api/wishlist-quick-add.ts"),

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
      route("notifications", "routes/app/notifications.tsx"),
      route("import", "routes/app/import.tsx"),
      route("export", "routes/app/export.tsx"),
      route("export/download", "routes/app/export.download.ts"),
      route("account-export", "routes/app/account-export.ts"),
      route("onboarding", "routes/app/onboarding.tsx"),
      route("settings", "routes/app/settings.tsx"),
    ]),
  ]),

  // ── 404 ────────────────────────────────────────────────────────────────────
  route("*", "routes/catchall.tsx"),
] satisfies RouteConfig;
