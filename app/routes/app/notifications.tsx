import { Form, Link } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/notifications";
import { Button, Card } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { listNotifications, markRead } from "~/lib/notifications/queries.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Notifications — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  const { items, unread } = await listNotifications(db, session.user.id, page);
  return {
    unread,
    page,
    items: items.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      payload: n.payloadJson ? (JSON.parse(n.payloadJson) as { cardSlug?: string }) : null,
      read: n.readAt !== null,
      createdAt: n.createdAt.getTime(),
    })),
  };
}

const ActionSchema = z.object({
  intent: z.literal("read"),
  id: z.union([z.string().uuid(), z.literal("all")]),
});

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const parsed = ActionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { ok: false as const };
  await markRead(createDb(env.DB), session.user.id, parsed.data.id);
  return { ok: true as const };
}

export default function Notifications({ loaderData }: Route.ComponentProps) {
  const { items, unread, page } = loaderData;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-fg">
          Notifications
          {unread > 0 ? (
            <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-sm text-white">
              {unread} new
            </span>
          ) : null}
        </h1>
        {unread > 0 ? (
          <Form method="post">
            <input type="hidden" name="intent" value="read" />
            <input type="hidden" name="id" value="all" />
            <Button type="submit" variant="secondary">
              Mark all as read
            </Button>
          </Form>
        ) : null}
      </div>

      {items.length === 0 ? (
        <Card className="text-center">
          <p className="mb-1 text-lg font-medium text-fg">Nothing here yet</p>
          <p className="text-sm text-fg-muted">
            Price alerts and import results appear here. Configure alerts on your{" "}
            <Link to="/app/wishlist" className="text-accent hover:underline">
              wishlist
            </Link>
            .
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((n) => (
            <li key={n.id}>
              <Card
                className={`flex items-start justify-between gap-4 ${n.read ? "opacity-70" : "border-accent/40"}`}
              >
                <div className="min-w-0">
                  <p className="font-medium text-fg">
                    {!n.read ? (
                      <span
                        aria-label="Unread"
                        className="mr-1.5 inline-block h-2 w-2 rounded-full bg-secondary"
                      />
                    ) : null}
                    {n.title}
                  </p>
                  <p className="text-sm text-fg-muted">{n.message}</p>
                  <p className="mt-1 text-xs text-fg-faint">
                    <time dateTime={new Date(n.createdAt).toISOString()}>
                      {new Date(n.createdAt).toLocaleString("en-US")}
                    </time>
                    {n.payload?.cardSlug ? (
                      <>
                        {" · "}
                        <Link
                          to={`/cards/${n.payload.cardSlug}`}
                          className="text-accent hover:underline"
                        >
                          View card
                        </Link>
                      </>
                    ) : null}
                  </p>
                </div>
                {!n.read ? (
                  <Form method="post">
                    <input type="hidden" name="intent" value="read" />
                    <input type="hidden" name="id" value={n.id} />
                    <Button type="submit" variant="ghost">
                      Mark read
                    </Button>
                  </Form>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {items.length === 20 || page > 1 ? (
        <nav aria-label="Pagination" className="flex justify-center gap-2">
          {page > 1 ? (
            <Link
              to={`/app/notifications?page=${page - 1}`}
              className="rounded-lg border border-edge px-4 py-2 text-sm"
            >
              ← Newer
            </Link>
          ) : null}
          {items.length === 20 ? (
            <Link
              to={`/app/notifications?page=${page + 1}`}
              className="rounded-lg border border-edge px-4 py-2 text-sm"
            >
              Older →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
