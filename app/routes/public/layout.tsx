import { Form, Link, NavLink, Outlet, useNavigation } from "react-router";

import type { Route } from "./+types/layout";
import { PokectorWordmark } from "~/components/brand";
import { optionalUser } from "~/lib/auth/guards.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await optionalUser(context, request);
  return { signedIn: session !== null };
}

const NAV = [
  { to: "/cards", label: "Cards" },
  { to: "/sets", label: "Sets" },
  { to: "/price-movers", label: "Price movers" },
  { to: "/blog", label: "Blog" },
];

export default function PublicLayout({ loaderData }: Route.ComponentProps) {
  const { signedIn } = loaderData;
  const navigation = useNavigation();

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-accent focus:px-3 focus:py-2 focus:text-(color:--color-on-accent)"
      >
        Skip to content
      </a>
      <header className="border-b border-edge bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" aria-label="Pokector home">
            <PokectorWordmark className="h-8" />
          </Link>
          <nav
            aria-label="Main"
            className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto"
          >
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
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
          <div className="ml-auto flex items-center gap-2">
            <Form method="get" action="/cards" role="search" className="hidden md:block">
              <label htmlFor="header-search" className="sr-only">
                Search cards
              </label>
              <input
                id="header-search"
                type="search"
                name="q"
                placeholder="Search cards…"
                className="w-44 rounded-lg border border-edge bg-canvas px-3 py-2 text-sm text-fg placeholder:text-fg-faint"
              />
            </Form>
            {signedIn ? (
              <Link
                to="/app"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
              >
                My collection
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-lg px-3 py-2 text-sm font-medium text-fg-muted hover:text-fg"
                >
                  Sign in
                </Link>
                <Link
                  to="/register"
                  className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-(color:--color-on-accent) hover:bg-accent-strong"
                >
                  Get started
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
            <Link to="/about" className="hover:text-fg">
              About
            </Link>
            <Link to="/methodology" className="hover:text-fg">
              Data &amp; methodology
            </Link>
            <Link to="/blog" className="hover:text-fg">
              Blog
            </Link>
            <Link to="/contact" className="hover:text-fg">
              Contact
            </Link>
            <Link to="/privacy" className="hover:text-fg">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-fg">
              Terms
            </Link>
            <Link to="/disclaimer" className="hover:text-fg">
              Disclaimer
            </Link>
            <a href="/rss.xml" className="hover:text-fg">
              RSS
            </a>
          </div>
          <p className="max-w-3xl text-xs text-fg-faint">
            Pokector is an independent collection tracker and is not affiliated with, endorsed by,
            sponsored by, or officially connected to Nintendo, The Pokémon Company, Game Freak,
            Creatures, TCGplayer, Cardmarket, or the Pokémon TCG API. Pokémon and Pokémon character
            names are trademarks of Nintendo. Card images and catalog data are provided by their
            respective sources. Displayed prices are estimates for raw (ungraded) cards and are not
            financial advice.
          </p>
        </div>
      </footer>
    </div>
  );
}
