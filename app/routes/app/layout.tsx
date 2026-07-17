import { Form, Link, NavLink, Outlet } from "react-router";

import type { Route } from "./+types/layout";
import { PokectorWordmark } from "~/components/brand";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { unreadCount } from "~/lib/notifications/queries.server";

export function meta(_args: Route.MetaArgs) {
  return [{ name: "robots", content: "noindex, nofollow" }];
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "private, no-store" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const unread = await unreadCount(createDb(env.DB), session.user.id);
  return {
    user: {
      name: session.user.name,
      email: session.user.email,
      role: session.user.role ?? "user",
    },
    unread,
  };
}

/** Public browse nav — identical to the signed-out header so the top bar looks
 * the same whether or not you're logged in (owner request 2026-07-18). These
 * are the unprefixed English public routes (the app area is English-only). */
const BROWSE_NAV: { to: string; label: string }[] = [
  { to: "/cards", label: "Cards" },
  { to: "/sets", label: "Sets" },
  { to: "/price-movers", label: "Price movers" },
  { to: "/blog", label: "Blog" },
];

/** Personal area — tucked under the user-name dropdown, not the top bar. */
const ACCOUNT_NAV: { to: string; label: string; end?: boolean }[] = [
  { to: "/app", label: "Dashboard", end: true },
  { to: "/app/collection", label: "Collection" },
  { to: "/app/binders", label: "Binders" },
  { to: "/app/sets", label: "Sets" },
  { to: "/app/wishlist", label: "Wishlist" },
  { to: "/app/settings", label: "Settings" },
];

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { user, unread } = loaderData;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-edge bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" aria-label="Pokector home">
            <PokectorWordmark className="h-8" />
          </Link>
          <nav
            aria-label="Browse"
            className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto"
          >
            {BROWSE_NAV.map((item) => (
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
          <div className="ms-auto flex items-center gap-2">
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
            <UserMenu name={user.name} isAdmin={user.role === "admin"} unread={unread} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}

/**
 * User-name dropdown holding the personal-area links. Opens on hover
 * (`group-hover`) and on keyboard focus (`group-focus-within`) — no JS, so it
 * works with SSR and the keyboard. On touch, tapping the button focuses it and
 * reveals the menu.
 */
function UserMenu({ name, isAdmin, unread }: { name: string; isAdmin: boolean; unread: number }) {
  return (
    <div className="group relative">
      <button
        type="button"
        aria-haspopup="menu"
        className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-fg-muted hover:text-fg group-focus-within:text-fg"
      >
        <span className="max-w-32 truncate">{name}</span>
        <span aria-hidden="true" className="text-xs">
          ▾
        </span>
      </button>
      <div className="invisible absolute end-0 z-50 mt-1 w-52 rounded-lg border border-edge bg-surface py-1 opacity-0 shadow-(--shadow-card) transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
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
          <Link
            to="/app/notifications"
            className="px-4 py-2 text-sm text-fg hover:bg-surface-raised"
          >
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
  );
}
