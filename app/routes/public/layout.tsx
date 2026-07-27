import { Link, Outlet, useLocation, useNavigation } from "react-router";

import type { Route } from "./+types/layout";
import { SiteHeader } from "~/components/site-header";
import { optionalUser } from "~/lib/auth/guards.server";
import { getCloudflare, getMarket } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { getDict } from "~/lib/i18n/dictionaries.server";
import {
  DEFAULT_LOCALE,
  isLocale,
  localePath,
  resolveLocale,
  stripLocalePrefix,
} from "~/lib/i18n/locales";
import { unreadCount } from "~/lib/notifications/queries.server";
import { isPremium } from "~/lib/billing/entitlement.server";
import { RARITY_HUBS } from "~/lib/catalog/rarity-hubs";
import { schema } from "~/lib/db/index.server";
import { eq } from "drizzle-orm";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const session = await optionalUser(context, request);
  const { env } = getCloudflare(context);
  // Signed-in visitors see the account menu + notifications bell even on public
  // pages, so the header is identical everywhere.
  const db = createDb(env.DB);
  let unread = 0;
  let premium = false;
  let profileLocale: string | null = null;
  if (session) {
    const [count, profile] = await Promise.all([
      unreadCount(db, session.user.id),
      db.query.userProfiles.findFirst({
        where: eq(schema.userProfiles.userId, session.user.id),
        columns: { premiumUntil: true, locale: true },
      }),
    ]);
    unread = count;
    premium = isPremium(profile);
    profileLocale = profile?.locale ?? null;
  }
  // Chrome (header/footer) locale. On a `/:locale` URL the prefix wins. On an
  // unprefixed URL (English-only pages, /, and the app boundary) we fall back to
  // the signed-in user's saved language so their nav stays in that language
  // instead of snapping to English. Anonymous visitors stay URL-derived so the
  // CDN-shared cache of these pages is never poisoned with someone's language.
  const locale = isLocale(params.locale)
    ? params.locale
    : session
      ? resolveLocale(profileLocale ?? undefined)
      : DEFAULT_LOCALE;
  return {
    signedIn: session !== null,
    isAdmin: session?.user.role === "admin",
    unread,
    premium,
    locale,
    market: getMarket(context),
    t: getDict(locale).layout,
  };
}

export default function PublicLayout({ loaderData }: Route.ComponentProps) {
  const { signedIn, isAdmin, unread, premium, locale, market, t } = loaderData;
  const navigation = useNavigation();
  const location = useLocation();
  // Unprefixed path so the language switcher can point at the same page in
  // another locale (English-only pages 301 back to their root form — harmless).
  const barePath = stripLocalePrefix(location.pathname);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-(color:--color-on-accent)"
      >
        {t.skipToContent}
      </a>

      <SiteHeader
        signedIn={signedIn}
        isAdmin={isAdmin}
        unread={unread}
        locale={locale}
        market={market}
        barePath={barePath}
        currentPath={location.pathname}
        inApp={false}
        premium={premium}
        t={t}
      />

      <main
        id="main-content"
        className="mx-auto w-full max-w-6xl flex-1 px-4 py-8"
        aria-busy={navigation.state === "loading"}
      >
        <Outlet />
      </main>

      <footer className="border-t border-edge bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-8 text-sm text-fg-muted">
          <div className="grid gap-8 sm:grid-cols-3">
            {/* Explore: topical hub pages (localized). */}
            <nav aria-label={t.footerExplore} className="flex flex-col gap-2">
              <span className="font-semibold text-fg">{t.footerExplore}</span>
              <Link to={localePath(locale, "/cards")} className="hover:text-fg">
                {t.navCards}
              </Link>
              <Link to={localePath(locale, "/sets")} className="hover:text-fg">
                {t.navSets}
              </Link>
              <Link to={localePath(locale, "/price-movers")} className="hover:text-fg">
                {t.navPriceMovers}
              </Link>
              <Link to={localePath(locale, "/pokedex")} className="hover:text-fg">
                {t.navPokedex}
              </Link>
              <Link to={localePath(locale, "/pokemon-card-collectors")} className="hover:text-fg">
                {t.footerCollectors}
              </Link>
              <Link
                to={localePath(locale, "/pokemon-card-grading-calculator")}
                className="hover:text-fg"
              >
                {t.footerGrading}
              </Link>
              {/* EN-first landings (inline copy, EN-only routes); hardcoded labels
                  and plain paths (no locale prefix → avoid a 301 redirect hop). */}
              <Link to="/most-valuable-pokemon-cards" className="hover:text-fg">
                Most valuable cards
              </Link>
              <Link to="/pokemon-sets" className="hover:text-fg">
                All sets in order
              </Link>
              <Link to="/riftbound" className="hover:text-fg">
                Riftbound TCG
              </Link>
              <Link to={localePath(locale, "/pricing")} className="hover:text-fg">
                {t.navPricing}
              </Link>
            </nav>
            {/* Browse by rarity: EN-only landing hubs (crawl discovery + topical
                internal links to the /pokemon-cards/{rarity} pages). */}
            <nav aria-label="Browse by rarity" className="flex flex-col gap-2">
              <span className="font-semibold text-fg">Browse by rarity</span>
              {Object.entries(RARITY_HUBS).map(([slug, hub]) => (
                <Link key={slug} to={`/pokemon-cards/${slug}`} className="hover:text-fg">
                  {hub.label}
                </Link>
              ))}
            </nav>
            {/* Resources: About, legal, blog, RSS (English-only pages). */}
            <nav aria-label={t.footerResources} className="flex flex-col gap-2">
              <span className="font-semibold text-fg">{t.footerResources}</span>
              <Link to="/about" className="hover:text-fg">
                {t.footerAbout}
              </Link>
              <Link to="/methodology" className="hover:text-fg">
                {t.footerMethodology}
              </Link>
              <Link to="/blog" className="hover:text-fg">
                {t.footerBlog}
              </Link>
              <Link to="/contact" className="hover:text-fg">
                {t.footerContact}
              </Link>
              <Link to="/privacy" className="hover:text-fg">
                {t.footerPrivacy}
              </Link>
              <Link to="/terms" className="hover:text-fg">
                {t.footerTerms}
              </Link>
              <Link to="/disclaimer" className="hover:text-fg">
                {t.footerDisclaimer}
              </Link>
              <a href="/rss.xml" className="hover:text-fg">
                {t.footerRss}
              </a>
            </nav>
          </div>
          <p className="max-w-3xl text-xs text-fg-faint">{t.disclaimer}</p>
        </div>
      </footer>
    </div>
  );
}
