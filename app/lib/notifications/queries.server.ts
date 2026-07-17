/** In-app notifications (SPEC §13/§8). */

import { and, count, desc, eq, isNull, sql } from "drizzle-orm";

import { schema, type Database } from "../db/index.server";

export async function createNotification(
  db: Database,
  userId: string,
  input: {
    type: "price_alert" | "import_finished" | "system";
    title: string;
    message: string;
    payload?: Record<string, unknown>;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(schema.notifications).values({
    id,
    userId,
    type: input.type,
    title: input.title,
    message: input.message,
    payloadJson: input.payload ? JSON.stringify(input.payload) : null,
  });
  return id;
}

export async function listNotifications(db: Database, userId: string, page = 1, pageSize = 20) {
  const [items, [{ unread }]] = await Promise.all([
    db
      .select({
        id: schema.notifications.id,
        type: schema.notifications.type,
        title: schema.notifications.title,
        message: schema.notifications.message,
        payloadJson: schema.notifications.payloadJson,
        readAt: schema.notifications.readAt,
        createdAt: schema.notifications.createdAt,
      })
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(pageSize)
      .offset((Math.max(1, page) - 1) * pageSize),
    db
      .select({ unread: count() })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt))),
  ]);
  return { items, unread };
}

export async function unreadCount(db: Database, userId: string): Promise<number> {
  const row = await db.get<{ n: number }>(sql`
    SELECT COUNT(*) AS n FROM notifications WHERE user_id = ${userId} AND read_at IS NULL
  `);
  return row?.n ?? 0;
}

export async function markRead(
  db: Database,
  userId: string,
  notificationId: string,
): Promise<void> {
  if (notificationId === "all") {
    await db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  } else {
    await db
      .update(schema.notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(schema.notifications.id, notificationId), eq(schema.notifications.userId, userId)),
      );
  }
}
