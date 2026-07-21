import { Form, Link } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/users";
import { Alert, Button, Card } from "~/components/ui";
import { requireAdmin } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { MARKETS } from "~/lib/market/market";
import { writePortfolioSnapshot } from "~/lib/portfolio/queries.server";
import { desc, like, sql } from "drizzle-orm";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Admin · Users — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireAdmin(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const q = new URL(request.url).searchParams.get("q")?.trim().toLowerCase() ?? "";

  const users = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      emailVerified: schema.user.emailVerified,
      createdAt: schema.user.createdAt,
      entryCount: sql<number>`(SELECT COUNT(*) FROM collection_entries e WHERE e.user_id = ${schema.user.id})`,
    })
    .from(schema.user)
    .where(q ? like(schema.user.email, `%${q}%`) : sql`1=1`)
    .orderBy(desc(schema.user.createdAt))
    .limit(50);

  return {
    q,
    users: users.map((u) => ({
      ...u,
      role: u.role ?? "user",
      createdAt: u.createdAt.getTime(),
    })),
  };
}

const ActionSchema = z.object({
  intent: z.literal("recalc-portfolio"),
  userId: z.string().min(1),
});

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireAdmin(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const parsed = ActionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { ok: false as const, message: "Invalid action." };

  // Recompute today's snapshot for every market currency (USD + EUR).
  const today = new Date().toISOString().slice(0, 10);
  for (const market of MARKETS) {
    await writePortfolioSnapshot(db, parsed.data.userId, today, market);
  }
  await db.insert(schema.adminAuditLogs).values({
    id: crypto.randomUUID(),
    adminUserId: session.user.id,
    action: "admin.recalc_portfolio",
    targetType: "user",
    targetId: parsed.data.userId,
    metadataJson: null,
  });
  return { ok: true as const, message: "Portfolio recalculated for user." };
}

export default function AdminUsers({ loaderData, actionData }: Route.ComponentProps) {
  const { users, q } = loaderData;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-fg">Users</h1>
        <Link to="/admin" className="text-sm text-accent hover:underline">
          ← Overview
        </Link>
      </div>
      {actionData ? (
        <Alert tone={actionData.ok ? "success" : "error"}>{actionData.message}</Alert>
      ) : null}

      <Form method="get" role="search" className="flex gap-2">
        <label htmlFor="q" className="sr-only">
          Search by e-mail
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Search by e-mail…"
          className="min-h-11 flex-1 rounded-lg border border-edge bg-surface px-3 text-fg"
        />
        <Button type="submit">Search</Button>
      </Form>

      <Card className="!p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">User accounts</caption>
            <thead>
              <tr className="border-b border-edge text-fg-muted">
                <th scope="col" className="p-3">
                  E-mail
                </th>
                <th scope="col" className="p-3">
                  Name
                </th>
                <th scope="col" className="p-3">
                  Role
                </th>
                <th scope="col" className="p-3">
                  Verified
                </th>
                <th scope="col" className="p-3">
                  Entries
                </th>
                <th scope="col" className="p-3">
                  Joined
                </th>
                <th scope="col" className="p-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-edge/50">
                  <td className="p-3 font-medium text-fg">{u.email}</td>
                  <td className="p-3 text-fg-muted">{u.name}</td>
                  <td className="p-3">
                    <span
                      className={
                        u.role === "admin" ? "font-semibold text-secondary" : "text-fg-muted"
                      }
                    >
                      {u.role}
                    </span>
                  </td>
                  <td className="p-3 text-fg-muted">{u.emailVerified ? "yes" : "no"}</td>
                  <td className="p-3 text-fg-muted">{u.entryCount}</td>
                  <td className="p-3 text-fg-faint">
                    {new Date(u.createdAt).toLocaleDateString("en-US")}
                  </td>
                  <td className="p-3">
                    <Form method="post">
                      <input type="hidden" name="intent" value="recalc-portfolio" />
                      <input type="hidden" name="userId" value={u.id} />
                      <Button type="submit" variant="ghost">
                        Recalc portfolio
                      </Button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-fg-faint">
        Role changes are performed only via the audited <code>pnpm admin:grant</code> CLI — never
        from this UI. Password hashes and session tokens are never shown.
      </p>
    </div>
  );
}
