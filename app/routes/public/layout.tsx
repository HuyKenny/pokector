import { Link, Outlet, useLocation, useNavigation } from "react-router";

import type { Route } from "./+types/layout";
import { SiteHeader } from "~/components/site-header";
import { optionalUser } from "~/lib/auth/guards.server";
import { getCloudflare, getMarket } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { resolveLocale, stripLocalePrefix } from "~/lib/i18n/locales";
import { unreadCount } from "~/lib/notifications/queries.server";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const session = await optionalUser(context, request);
  const locale = resolveLocale(params.locale);
  const { env } = getCloudflare(context);
  // Signed-in visitors see the account menu + notifications bell even on public
  // pages, so the header is identical everywhere.
  const unread = session ? await unreadCount(createDb(env.DB), session.user.id) : 0;
  return {
    signedIn: session !== null,
    isAdmin: session?.user.role === "admin",
    unread,
    locale,
    market: getMarket(context),
    t: getDict(locale).layout,
  };
}

export default function PublicLayout({ loaderData }: Route.ComponentProps) {
  const { signedIn, isAdmin, unread, locale, market, t } = loaderData;
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
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 text-sm text-fg-muted">
          <div className="flex flex-wrap gap-x-8 gap-y-2">
            {/* Footer targets (About, legal, blog, RSS) are English-only pages. */}
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
          </div>
          <p className="max-w-3xl text-xs text-fg-faint">{t.disclaimer}</p>
        </div>
      </footer>
    </div>
  );
}
