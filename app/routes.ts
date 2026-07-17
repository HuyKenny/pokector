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

  // ── Quick-add API (public card page CTAs) ──────────────────────────────────
  route("api/v1/collection/quick-add", "routes/api/collection-quick-add.ts"),
  route("api/v1/wishlist/quick-add", "routes/api/wishlist-quick-add.ts"),

  // ── Administration ─────────────────────────────────────────────────────────
  layout("routes/admin/layout.tsx", [...prefix("admin", [index("routes/admin/index.tsx")])]),

  // ── Authenticated application ──────────────────────────────────────────────
  layout("routes/app/layout.tsx", [
    ...prefix("app", [
      index("routes/app/index.tsx"),
      route("collection", "routes/app/collection.tsx"),
      route("collection/search", "routes/app/collection-search.ts"),
      route("onboarding", "routes/app/onboarding.tsx"),
      route("settings", "routes/app/settings.tsx"),
    ]),
  ]),

  // ── 404 ────────────────────────────────────────────────────────────────────
  route("*", "routes/catchall.tsx"),
] satisfies RouteConfig;
