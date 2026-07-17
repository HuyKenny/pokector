import type { Route } from "./+types/account-export";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { enforceRateLimit } from "~/lib/security/rate-limit.server";
import { eq } from "drizzle-orm";

/**
 * Full account data export as JSON (SPEC §7 / GDPR portability). User-scoped;
 * returns everything the user owns. Password hashes / session tokens are never
 * included.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  await enforceRateLimit(createDb(env.DB), "export", session.user.id);
  const db = createDb(env.DB);
  const userId = session.user.id;

  const [profile, collection, binders, binderSlots, wishlist, goals, snapshots, notifications] =
    await Promise.all([
      db.query.userProfiles.findFirst({ where: eq(schema.userProfiles.userId, userId) }),
      db.select().from(schema.collectionEntries).where(eq(schema.collectionEntries.userId, userId)),
      db.select().from(schema.binders).where(eq(schema.binders.userId, userId)),
      db
        .select({
          binderId: schema.binderSlots.binderId,
          collectionEntryId: schema.binderSlots.collectionEntryId,
          cardId: schema.binderSlots.cardId,
          pageNumber: schema.binderSlots.pageNumber,
          side: schema.binderSlots.side,
          slotNumber: schema.binderSlots.slotNumber,
        })
        .from(schema.binderSlots)
        .innerJoin(schema.binders, eq(schema.binderSlots.binderId, schema.binders.id))
        .where(eq(schema.binders.userId, userId)),
      db.select().from(schema.wishlistItems).where(eq(schema.wishlistItems.userId, userId)),
      db.select().from(schema.setGoals).where(eq(schema.setGoals.userId, userId)),
      db
        .select()
        .from(schema.portfolioSnapshots)
        .where(eq(schema.portfolioSnapshots.userId, userId)),
      db.select().from(schema.notifications).where(eq(schema.notifications.userId, userId)),
    ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    account: { id: userId, email: session.user.email, name: session.user.name },
    profile,
    collection,
    binders,
    binderSlots,
    wishlist,
    setGoals: goals,
    portfolioSnapshots: snapshots,
    notifications,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="pokector-account-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
