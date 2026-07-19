import { Form, Link, NavLink, Outlet, useLocation, useNavigation } from "react-router";

import type { Route } from "./+types/layout";
import { PokectorWordmark } from "~/components/brand";
import { optionalUser } from "~/lib/auth/guards.server";
import { getMarket } from "~/lib/context";
import { getDict } from "~/lib/i18n/dictionaries.server";
import {
  LOCALE_NAMES,
  LOCALES,
  localePath,
  resolveLocale,
  stripLocalePrefix,
} from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { MARKET_CURRENCY, MARKET_FLAG, MARKETS, type Market } from "~/lib/market/market";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const session = await optionalUser(context, request);
  const locale = resolveLocale(params.locale);
  const d = getDict(locale);
  return { signedIn: session !== null, locale, market: getMarket(context), t: d.layout };
}

export default function PublicLayout({ loaderData }: Route.ComponentProps) {
  const { signedIn, locale, market, t } = loaderData;
  const navigation = useNavigation();
  const lp = useLocalePath();
  const location = useLocation();
  // Unprefixed path so the language switcher can point at the same page in
  // another locale (English-only pages 301 back to their root form — harmless).
  const barePath = stripLocalePrefix(location.pathname);

  const nav = [
    { to: lp("/cards"), label: t.navCards },
    { to: lp("/sets"), label: t.navSets },
    { to: lp("/price-movers"), label: t.navPriceMovers },
    { to: lp("/pokedex"), label: t.navPokedex },
    { to: "/blog", label: t.navBlog }, // blog is English-only
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-(color:--color-on-accent)"
      >
        {t.skipToContent}
      </a>
      <header className="border-b border-edge bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to={lp("/")} aria-label={t.homeAria}>
            <PokectorWordmark className="h-8" />
          </Link>
          <nav
            aria-label={t.navMain}
            className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto"
          >
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === lp("/")}
                className={({ isActive }) =>
                  `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive ? "bg-accent-soft text-accent-strong" : "text-fg-muted hover:text-fg"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <Form method="get" action={lp("/cards")} role="search" className="hidden md:block">
              <label htmlFor="header-search" className="sr-only">
                {t.searchCards}
              </label>
              <input
                id="header-search"
                type="search"
                name="q"
                placeholder={t.searchCardsPlaceholder}
                className="w-44 rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-fg placeholder:text-fg-faint"
              />
            </Form>
            <MarketSwitcher current={market} redirectTo={location.pathname} label={t.marketLabel} />
            <LanguageSwitcher current={locale} barePath={barePath} label={t.languageLabel} />
            {signedIn ? (
              <Link
                to="/app"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
              >
                {t.myCollection}
              </Link>
            ) : (
              <>
                <Link
                  to={lp("/login")}
                  className="rounded-lg px-3 py-2 text-sm font-medium text-fg-muted hover:text-fg"
                >
                  {t.signIn}
                </Link>
                <Link
                  to={lp("/register")}
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
                >
                  {t.getStarted}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

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

/** Native <details> disclosure — works without JS (SSR-friendly) and keeps the
 * header light. Each entry links to the same page in the target locale. */
function LanguageSwitcher({
  current,
  barePath,
  label,
}: {
  current: (typeof LOCALES)[number];
  barePath: string;
  label: string;
}) {
  return (
    <details className="relative">
      <summary
        aria-label={label}
        className="flex cursor-pointer list-none items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-fg-muted hover:text-fg"
      >
        <span aria-hidden="true">🌐</span>
        <span className="uppercase">{current}</span>
      </summary>
      <ul className="absolute end-0 z-50 mt-1 max-h-80 w-40 overflow-auto rounded-lg border border-edge bg-surface py-1 shadow-(--shadow-card)">
        {LOCALES.map((l) => (
          <li key={l}>
            <a
              href={localePath(l, barePath)}
              hrefLang={l}
              aria-current={l === current ? "true" : undefined}
              className={`block px-3 py-2 text-sm hover:bg-surface-raised ${
                l === current ? "font-semibold text-accent" : "text-fg"
              }`}
            >
              {LOCALE_NAMES[l]}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Market (price world) switcher — mirrors LanguageSwitcher but persists a
 * cookie via a JS-free form POST to /market instead of changing the URL, so
 * SEO/canonical stay untouched. Each option carries the source + currency. */
const MARKET_META: Record<Market, { source: string; label: string }> = {
  us: { source: "TCGplayer", label: "USD" },
  eu: { source: "Cardmarket", label: "EUR" },
};

function MarketSwitcher({
  current,
  redirectTo,
  label,
}: {
  current: Market;
  redirectTo: string;
  label: string;
}) {
  return (
    <details className="relative">
      <summary
        aria-label={label}
        className="flex cursor-pointer list-none items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-fg-muted hover:text-fg"
      >
        <span aria-hidden="true">{MARKET_FLAG[current]}</span>
        <span>{MARKET_CURRENCY[current]}</span>
      </summary>
      <ul className="absolute end-0 z-50 mt-1 w-48 overflow-hidden rounded-lg border border-edge bg-surface py-1 shadow-(--shadow-card)">
        {MARKETS.map((m) => (
          <li key={m}>
            <form method="post" action="/market">
              <input type="hidden" name="market" value={m} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <button
                type="submit"
                aria-current={m === current ? "true" : undefined}
                className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-surface-raised ${
                  m === current ? "font-semibold text-accent" : "text-fg"
                }`}
              >
                <span aria-hidden="true">{MARKET_FLAG[m]}</span>
                <span>{MARKET_META[m].source}</span>
                <span className="ms-auto text-xs text-fg-faint">{MARKET_META[m].label}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </details>
  );
}
