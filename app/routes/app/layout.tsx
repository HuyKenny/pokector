import { Form, Link, NavLink, Outlet } from "react-router";

import type { Route } from "./+types/layout";
import { PokectorWordmark } from "~/components/brand";
import { requireUser } from "~/lib/auth/guards.server";

export function meta(_args: Route.MetaArgs) {
  return [{ name: "robots", content: "noindex, nofollow" }];
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "private, no-store" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  return {
    user: {
      name: session.user.name,
      email: session.user.email,
      role: session.user.role ?? "user",
    },
  };
}

// Extended as feature phases land (collection, binders, sets, wishlist, …).
const NAV_ITEMS: { to: string; label: string; end?: boolean }[] = [
  { to: "/app", label: "Dashboard", end: true },
  { to: "/app/settings", label: "Settings" },
];

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-edge bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/app" aria-label="Pokector dashboard">
            <PokectorWordmark className="h-7" />
          </Link>
          <nav aria-label="Application" className="hidden items-center gap-1 sm:flex">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive ? "bg-accent-soft text-accent-strong" : "text-fg-muted hover:text-fg"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-fg-muted md:inline" aria-hidden="true">
              {user.name}
            </span>
            {user.role === "admin" ? (
              <Link to="/admin" className="text-sm font-medium text-secondary hover:underline">
                Admin
              </Link>
            ) : null}
            <Form method="post" action="/logout">
              <button
                type="submit"
                className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-fg-muted hover:bg-surface-raised hover:text-fg"
              >
                Sign out
              </button>
            </Form>
          </div>
        </div>
        {/* Mobile nav */}
        <nav
          aria-label="Application (mobile)"
          className="flex gap-1 overflow-x-auto px-4 pb-2 sm:hidden"
        >
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? "bg-accent-soft text-accent-strong" : "text-fg-muted"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
