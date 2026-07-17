import { Link, NavLink, Outlet } from "react-router";

import type { Route } from "./+types/layout";
import { PokectorIcon } from "~/components/brand";
import { requireAdmin } from "~/lib/auth/guards.server";

export function meta(_args: Route.MetaArgs) {
  return [{ name: "robots", content: "noindex, nofollow" }];
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "private, no-store" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireAdmin(context, request);
  return { adminName: session.user.name };
}

const NAV = [{ to: "/admin", label: "Overview", end: true }];

export default function AdminLayout(_props: Route.ComponentProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-secondary/40 bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <PokectorIcon className="h-7 w-7" />
            <span className="font-bold text-fg">
              Pokector <span className="text-secondary">Admin</span>
            </span>
          </div>
          <nav aria-label="Administration" className="flex items-center gap-1">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium ${
                    isActive ? "bg-secondary-soft text-secondary" : "text-fg-muted hover:text-fg"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
            <Link
              to="/app"
              className="rounded-lg px-3 py-2 text-sm font-medium text-fg-muted hover:text-fg"
            >
              Back to app
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
