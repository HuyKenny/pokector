import { eq } from "drizzle-orm";
import { redirect } from "react-router";

import type { Route } from "./+types/locale";
import { optionalUser } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { isLocale, localePath, resolveLocale } from "~/lib/i18n/locales";
import { safeRelativePath } from "~/lib/security/redirect";

/**
 * POST-only language switch. Mirrors /market (JS-free plain form post). For a
 * signed-in user it persists the choice on `userProfiles.locale` — the same
 * source of truth Settings writes and the layouts read — so the language sticks
 * across English-only pages (/about, /blog, /app) instead of snapping back.
 * Anonymous visitors rely on the URL prefix, so we just redirect to the target
 * localized path (no cookie → no CDN cache poisoning of shared public pages).
 */
export async function action({ request, context }: Route.ActionArgs) {
  const form = await request.formData();
  const field = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : "";
  };
  const locale = resolveLocale(field("locale"));
  // barePath is the unprefixed current path; localePath() re-prefixes it.
  const barePath = safePath(field("redirectTo"));

  const session = await optionalUser(context, request);
  if (session) {
    const { env } = getCloudflare(context);
    const db = createDb(env.DB);
    await db
      .update(schema.userProfiles)
      .set({ locale })
      .where(eq(schema.userProfiles.userId, session.user.id));
  }

  return redirect(localePath(locale, barePath));
}

export function loader() {
  return redirect("/");
}

/** Only allow a same-site unprefixed path (no protocol-relative/absolute URLs).
 * A leading locale segment is stripped by treating the value as already bare —
 * callers pass the bare path, so we only guard the shape here. */
function safePath(to: string): string {
  to = safeRelativePath(to);
  // Defensive: if a locale prefix slipped in, drop it so we don't double-prefix.
  const first = to.split("/")[1];
  if (isLocale(first)) {
    const rest = "/" + to.split("/").slice(2).join("/");
    return rest === "/" ? "/" : rest.replace(/\/$/, "");
  }
  return to;
}
