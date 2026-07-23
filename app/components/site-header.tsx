import { useState } from "react";
import { Form, Link, NavLink, useLocation } from "react-router";

import { PokectorWordmark } from "~/components/brand";
import { Flag } from "~/components/flags";
import { HeaderSearch } from "~/components/header-search";
import { GAME_NAME, GAMES, type Game, gameFromPathname, gamePath } from "~/lib/game/game";
import type { Dict } from "~/lib/i18n/dictionaries.server";
import { LOCALE_NAMES, LOCALES, type Locale, localePath } from "~/lib/i18n/locales";
import { MARKET_CURRENCY, MARKETS, type Market } from "~/lib/market/market";

type LayoutDict = Dict["layout"];

/** Shared look for the market / game / language dropdown triggers: a compact
 * bordered pill with a chevron that flips when the <details> is open. Keeping
 * them identical makes the top-right controls read as one tidy control cluster
 * instead of loose floating text. */
const SWITCHER_SUMMARY =
  "flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-edge bg-surface px-2.5 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:bg-surface-raised hover:text-fg [&::-webkit-details-marker]:hidden";

/** Personal-area links (English — the /app area is English-only by design). */
const ACCOUNT_NAV: { to: string; label: string; end?: boolean }[] = [
  { to: "/app", label: "Dashboard", end: true },
  { to: "/app/collection", label: "Collection" },
  { to: "/app/binders", label: "Binders" },
  { to: "/app/sets", label: "Sets" },
  { to: "/app/wishlist", label: "Wishlist" },
  { to: "/app/sales", label: "Sales & P/L" },
  { to: "/app/billing", label: "Subscription" },
  { to: "/app/settings", label: "Settings" },
];

interface SiteHeaderProps {
  signedIn: boolean;
  /** Unread notification count (0 when signed out). */
  unread: number;
  locale: Locale;
  market: Market;
  /** Unprefixed current path — for the language switcher targets. */
  barePath: string;
  /** Current path — for the market switcher redirect. */
  currentPath: string;
  /** True on /app pages: language switcher hidden (language lives in Settings). */
  inApp: boolean;
  isAdmin?: boolean;
  /** True when the signed-in user is on Pokector Pro (shows the badge, hides upgrade). */
  premium?: boolean;
  t: LayoutDict;
}

/**
 * The one site header, shared by the public and authenticated layouts. Identical
 * everywhere — wordmark, primary nav, search, market switcher, and (public only)
 * language switcher — with a single difference by auth state: signed-out shows
 * Sign in / Get started; signed-in shows the notifications bell + a "My
 * collection" account menu. Collapses to a hamburger menu below `lg`.
 */
export function SiteHeader({
  signedIn,
  unread,
  locale,
  market,
  barePath,
  currentPath,
  inApp,
  isAdmin = false,
  premium = false,
  t,
}: SiteHeaderProps) {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  // Close the mobile menu on navigation (adjust-state-during-render, not an effect).
  const [prevPath, setPrevPath] = useState(location.pathname);
  if (location.pathname !== prevPath) {
    setPrevPath(location.pathname);
    setMenuOpen(false);
  }

  // Active game is URL-derived (cache-safe). Riftbound is a catalog-only MVP, so
  // its nav is just Cards + Sets; Pokédex/price-movers stay Pokémon-only.
  const activeGame = gameFromPathname(location.pathname);
  const nav =
    activeGame === "riftbound"
      ? [
          { to: localePath(locale, gamePath("riftbound", "/cards")), label: t.navCards },
          { to: localePath(locale, gamePath("riftbound", "/sets")), label: t.navSets },
          { to: localePath(locale, "/pricing"), label: t.navPricing },
        ]
      : [
          { to: localePath(locale, "/cards"), label: t.navCards },
          { to: localePath(locale, "/sets"), label: t.navSets },
          { to: localePath(locale, "/price-movers"), label: t.navPriceMovers },
          { to: localePath(locale, "/pokedex"), label: t.navPokedex },
          { to: localePath(locale, "/pricing"), label: t.navPricing },
          // Blog lives in the footer (Resources) to keep the header uncluttered.
        ];

  const authButtons = signedIn ? null : (
    <>
      <Link
        to={localePath(locale, "/login")}
        className="rounded-lg px-3 py-2 text-center text-sm font-medium text-fg-muted hover:text-fg"
      >
        {t.signIn}
      </Link>
      <Link
        to={localePath(locale, "/register")}
        className="rounded-lg bg-accent px-4 py-2 text-center text-sm font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
      >
        {t.getStarted}
      </Link>
    </>
  );

  return (
    <header className="border-b border-edge bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link to={localePath(locale, gamePath(activeGame, "/"))} aria-label={t.homeAria}>
          <PokectorWordmark className="h-8" />
        </Link>

        {/* Desktop nav (≥ lg) */}
        <nav aria-label={t.navMain} className="hidden gap-1 lg:flex">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === localePath(locale, "/")}
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

        {/* Desktop controls (≥ lg) */}
        <div className="ms-auto hidden items-center gap-2 lg:flex">
          <HeaderSearch
            label={t.searchCards}
            placeholder={t.searchCardsPlaceholder}
            resultsLabel={t.searchResults}
            viewAll={t.searchViewAll}
            noResults={t.searchNoResults}
            locale={locale}
          />
          <MarketSwitcher
            current={market}
            redirectTo={currentPath}
            label={t.marketLabel}
            regionLabel={{ us: t.marketUs, eu: t.marketEu }}
          />
          {!inApp ? (
            <>
              <GameSwitcher current={activeGame} locale={locale} label={t.gameLabel} />
              <LanguageSwitcher current={locale} barePath={barePath} label={t.languageLabel} />
            </>
          ) : null}
          {signedIn ? (
            <>
              <NotificationsBell unread={unread} />
              <AccountMenu
                label={t.myCollection}
                isAdmin={isAdmin}
                unread={unread}
                premium={premium}
                t={t}
              />
            </>
          ) : (
            authButtons
          )}
        </div>

        {/* Mobile hamburger (< lg) */}
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-controls="site-mobile-menu"
          aria-label={t.menu}
          className="ms-auto inline-flex h-10 w-10 items-center justify-center rounded-lg text-fg-muted hover:bg-surface-raised hover:text-fg lg:hidden"
        >
          {menuOpen ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      {/* Mobile menu (< lg) */}
      {menuOpen ? (
        <div id="site-mobile-menu" className="border-t border-edge px-4 py-4 lg:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            <HeaderSearch
              block
              label={t.searchCards}
              placeholder={t.searchCardsPlaceholder}
              resultsLabel={t.searchResults}
              viewAll={t.searchViewAll}
              noResults={t.searchNoResults}
              locale={locale}
            />
            <nav aria-label={t.navMain} className="flex flex-col">
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === localePath(locale, "/")}
                  className={({ isActive }) =>
                    `rounded-lg px-3 py-2.5 text-sm font-medium ${
                      isActive
                        ? "bg-accent-soft text-accent-strong"
                        : "text-fg-muted hover:bg-surface-raised hover:text-fg"
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>

            {signedIn ? (
              <nav aria-label="Your account" className="flex flex-col border-t border-edge pt-3">
                {ACCOUNT_NAV.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `rounded-lg px-3 py-2.5 text-sm font-medium ${
                        isActive
                          ? "bg-accent-soft text-accent-strong"
                          : "text-fg-muted hover:bg-surface-raised hover:text-fg"
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
                <Link
                  to="/app/notifications"
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-fg-muted hover:bg-surface-raised hover:text-fg"
                >
                  Notifications{unread > 0 ? ` (${unread > 9 ? "9+" : unread})` : ""}
                </Link>
                {isAdmin ? (
                  <Link
                    to="/admin"
                    className="rounded-lg px-3 py-2.5 text-sm font-medium text-secondary hover:bg-surface-raised"
                  >
                    Admin
                  </Link>
                ) : null}
              </nav>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-edge pt-3">
              <MarketSwitcher
                current={market}
                redirectTo={currentPath}
                label={t.marketLabel}
                regionLabel={{ us: t.marketUs, eu: t.marketEu }}
              />
              {!inApp ? (
                <>
                  <GameSwitcher current={activeGame} locale={locale} label={t.gameLabel} />
                  <LanguageSwitcher current={locale} barePath={barePath} label={t.languageLabel} />
                </>
              ) : null}
            </div>

            {signedIn ? (
              <Form method="post" action="/logout">
                <button
                  type="submit"
                  className="w-full rounded-lg border border-edge px-4 py-2 text-sm font-medium text-fg-muted hover:bg-surface-raised hover:text-fg"
                >
                  Sign out
                </button>
              </Form>
            ) : (
              <div className="flex flex-col gap-2">{authButtons}</div>
            )}
          </div>
        </div>
      ) : null}
    </header>
  );
}

function NotificationsBell({ unread }: { unread: number }) {
  return (
    <Link
      to="/app/notifications"
      className="relative rounded-lg px-2 py-2 text-sm font-medium text-fg-muted hover:text-fg"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
    >
      <span aria-hidden="true">🔔</span>
      {unread > 0 ? (
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-secondary px-1 text-[10px] font-bold text-(color:--color-on-secondary)"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Signed-in account dropdown. Opens on hover (`group-hover`) and keyboard focus
 * (`group-focus-within`) — no JS, SSR-friendly. A transparent pt-1 bridges the
 * button→card gap so the menu doesn't close as the cursor crosses it.
 */
function AccountMenu({
  label,
  isAdmin,
  unread,
  premium,
  t,
}: {
  label: string;
  isAdmin: boolean;
  unread: number;
  premium: boolean;
  t: LayoutDict;
}) {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-haspopup="menu"
        className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
      >
        {premium ? (
          <span className="rounded bg-(color:--color-on-accent)/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
            {t.proBadge}
          </span>
        ) : null}
        <span className="max-w-32 truncate">{label}</span>
        <span aria-hidden="true" className="text-xs">
          ▾
        </span>
      </button>
      <div className="invisible absolute end-0 top-full z-50 w-52 pt-1 opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <div className="rounded-lg border border-edge bg-surface py-1 shadow-(--shadow-card)">
          {premium ? null : (
            <Link
              to="/app/billing"
              className="mx-1 mb-1 block rounded bg-accent-soft px-3 py-2 text-sm font-semibold text-accent-strong hover:bg-accent-soft/70"
            >
              ⭐ {t.upgradeToPro}
            </Link>
          )}
          <nav aria-label="Your account" className="flex flex-col py-1">
            {ACCOUNT_NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `px-4 py-2 text-sm ${
                    isActive
                      ? "bg-accent-soft font-medium text-accent-strong"
                      : "text-fg hover:bg-surface-raised"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <Link to="/app/notifications" className="px-4 py-2 text-sm text-fg hover:bg-surface-raised">
              Notifications{unread > 0 ? ` (${unread > 9 ? "9+" : unread})` : ""}
            </Link>
            {isAdmin ? (
              <Link
                to="/admin"
                className="px-4 py-2 text-sm font-medium text-secondary hover:bg-surface-raised"
              >
                Admin
              </Link>
            ) : null}
          </nav>
          <div className="my-1 border-t border-edge" />
          <Form method="post" action="/logout">
            <button
              type="submit"
              className="w-full px-4 py-2 text-start text-sm text-fg-muted hover:bg-surface-raised hover:text-fg"
            >
              Sign out
            </button>
          </Form>
        </div>
      </div>
    </div>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 text-fg-faint transition-transform duration-150 group-open:rotate-180 ${className}`}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 6h18M3 12h18M3 18h18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Native <details> disclosure — works without JS. Each entry posts to /locale,
 * which (for signed-in users) persists the choice on the profile and then
 * redirects to the same page in the target locale, so the language sticks across
 * English-only pages instead of snapping back. Authoritative hreflang lives in
 * <head> (pageMeta), so switching to POST here costs no SEO signal. */
function LanguageSwitcher({
  current,
  barePath,
  label,
}: {
  current: Locale;
  barePath: string;
  label: string;
}) {
  return (
    <details className="group relative">
      <summary aria-label={label} className={SWITCHER_SUMMARY}>
        <Flag code={current} className="h-3.5 w-5 rounded-[2px] border border-edge/40" />
        <span className="uppercase">{current}</span>
        <ChevronIcon />
      </summary>
      <ul className="absolute end-0 z-50 mt-1 max-h-80 w-44 overflow-auto rounded-lg border border-edge bg-surface py-1 shadow-(--shadow-card)">
        {LOCALES.map((l) => (
          <li key={l}>
            <form method="post" action="/locale">
              <input type="hidden" name="locale" value={l} />
              <input type="hidden" name="redirectTo" value={barePath} />
              <button
                type="submit"
                lang={l}
                aria-current={l === current ? "true" : undefined}
                className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-surface-raised ${
                  l === current ? "font-semibold text-accent" : "text-fg"
                }`}
              >
                <Flag code={l} className="h-3.5 w-5 shrink-0 rounded-[2px] border border-edge/40" />
                {LOCALE_NAMES[l]}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Trading-card game switcher — JS-free form POST to /game (persists the pk_game
 * cookie) that lands the visitor on the chosen game's catalog, locale preserved.
 * Pokémon is the unprefixed default; Riftbound lives under /riftbound. */
function GameSwitcher({
  current,
  locale,
  label,
}: {
  current: Game;
  locale: Locale;
  label: string;
}) {
  return (
    <details className="group relative">
      <summary aria-label={`${label}: ${GAME_NAME[current]}`} className={SWITCHER_SUMMARY} title={GAME_NAME[current]}>
        <span aria-hidden="true">🎴</span>
        <ChevronIcon />
      </summary>
      <ul className="absolute end-0 z-50 mt-1 w-44 overflow-hidden rounded-lg border border-edge bg-surface py-1 shadow-(--shadow-card)">
        {GAMES.map((g) => (
          <li key={g}>
            <form method="post" action="/game">
              <input type="hidden" name="game" value={g} />
              <input type="hidden" name="redirectTo" value={localePath(locale, gamePath(g, "/cards"))} />
              <button
                type="submit"
                aria-current={g === current ? "true" : undefined}
                className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-surface-raised ${
                  g === current ? "font-semibold text-accent" : "text-fg"
                }`}
              >
                {GAME_NAME[g]}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Market (price world) switcher — persists a cookie via a JS-free form POST to
 * /market so SEO/canonicals stay untouched. */
function MarketSwitcher({
  current,
  redirectTo,
  label,
  regionLabel,
}: {
  current: Market;
  redirectTo: string;
  label: string;
  regionLabel: Record<Market, string>;
}) {
  return (
    <details className="group relative">
      <summary aria-label={label} className={SWITCHER_SUMMARY}>
        <Flag code={current} className="h-3.5 w-5 rounded-[2px] border border-edge/40" />
        <span>{MARKET_CURRENCY[current]}</span>
        <ChevronIcon />
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
                <Flag code={m} className="h-3.5 w-5 shrink-0 rounded-[2px] border border-edge/40" />
                <span>{regionLabel[m]}</span>
                <span className="ms-auto text-xs text-fg-faint">{MARKET_CURRENCY[m]}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </details>
  );
}
