import { eq } from "drizzle-orm";
import { Outlet, useLocation } from "react-router";

import type { Route } from "./+types/layout";
import { SiteHeader } from "~/components/site-header";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare, getMarket } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { resolveLocale, stripLocalePrefix } from "~/lib/i18n/locales";
import { unreadCount } from "~/lib/notifications/queries.server";
import { getEntitlements } from "~/lib/billing/autumn.server";

export function meta(_args: Route.MetaArgs) {
  return [{ name: "robots", content: "noindex, nofollow" }];
}

export function headers(_args: Route.HeadersArgs) {
  return { "Cache-Control": "private, no-store" };
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  // getEntitlements reads the Autumn mirror and refreshes it once past its TTL —
  // this is the hook that lets a cancellation propagate even if a webhook is lost.
  const [unread, profile, entitlements] = await Promise.all([
    unreadCount(db, session.user.id),
    db.query.userProfiles.findFirst({
      where: eq(schema.userProfiles.userId, session.user.id),
      columns: { locale: true },
    }),
    getEntitlements(db, env, session.user.id, session.user.email),
  ]);
  // Header nav follows the user's chosen language (Settings); legacy "en-US"
  // and unknown values resolve to English.
  const locale = resolveLocale(profile?.locale);
  return {
    unread,
    isAdmin: session.user.role === "admin",
    premium: entitlements.premium,
    locale,
    market: getMarket(context),
    t: getDict(locale).layout,
  };
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { unread, isAdmin, premium, locale, market, t } = loaderData;
  const location = useLocation();
  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        signedIn
        isAdmin={isAdmin}
        unread={unread}
        locale={locale}
        market={market}
        barePath={stripLocalePrefix(location.pathname)}
        currentPath={location.pathname}
        inApp
        premium={premium}
        t={t}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
