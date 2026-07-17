import { Link } from "react-router";

import type { Route } from "./+types/audit-log";
import { Card } from "~/components/ui";
import { requireAdmin } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { desc } from "drizzle-orm";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Admin · Audit log — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireAdmin(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const rows = await db
    .select()
    .from(schema.adminAuditLogs)
    .orderBy(desc(schema.adminAuditLogs.createdAt))
    .limit(100);
  return { rows: rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() })) };
}

export default function AuditLog({ loaderData }: Route.ComponentProps) {
  const { rows } = loaderData;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-fg">Admin audit log</h1>
        <Link to="/admin" className="text-sm text-accent hover:underline">
          ← Overview
        </Link>
      </div>
      <Card className="!p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-fg-muted">No admin actions recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Admin audit events</caption>
              <thead>
                <tr className="border-b border-edge text-fg-muted">
                  <th scope="col" className="p-3">
                    When
                  </th>
                  <th scope="col" className="p-3">
                    Admin
                  </th>
                  <th scope="col" className="p-3">
                    Action
                  </th>
                  <th scope="col" className="p-3">
                    Target
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-edge/50">
                    <td className="p-3 text-fg-faint">
                      {new Date(r.createdAt).toLocaleString("en-US")}
                    </td>
                    <td className="p-3 font-mono text-xs text-fg-muted">
                      {r.adminUserId.slice(0, 8)}…
                    </td>
                    <td className="p-3 text-fg">{r.action}</td>
                    <td className="p-3 text-fg-muted">
                      {r.targetType ? `${r.targetType}:${(r.targetId ?? "").slice(0, 12)}` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
