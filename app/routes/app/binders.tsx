import { Form, Link } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/binders";
import { Alert, Button, Card, Input } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb } from "~/lib/db/index.server";
import { createBinder, listBinders } from "~/lib/binders/queries.server";
import { LIMITS } from "~/lib/limits";
import { enforceRateLimit } from "~/lib/security/rate-limit.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "My Binders — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  return { binders: await listBinders(db, session.user.id) };
}

const CreateSchema = z.object({
  intent: z.literal("create"),
  name: z.string().trim().min(1, "Name is required.").max(LIMITS.maxNameLength),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((v) => (v === "" ? null : v)),
});

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  await enforceRateLimit(createDb(env.DB), "apiWrite", session.user.id);
  const parsed = CreateSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) {
    return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const db = createDb(env.DB);
  await createBinder(db, session.user.id, parsed.data.name, parsed.data.description);
  return { ok: true as const, message: `Binder “${parsed.data.name}” created.` };
}

export default function Binders({ loaderData, actionData }: Route.ComponentProps) {
  const { binders } = loaderData;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-fg">My binders</h1>
      {actionData ? (
        <Alert tone={actionData.ok ? "success" : "error"}>{actionData.message}</Alert>
      ) : null}

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-fg">Create a binder</h2>
        <Form method="post" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="create" />
          <div className="min-w-52 flex-1">
            <Input
              label="Name"
              id="binder-name"
              name="name"
              required
              maxLength={LIMITS.maxNameLength}
              placeholder="e.g. Base Set binder"
            />
          </div>
          <div className="min-w-52 flex-1">
            <Input
              label="Description (optional)"
              id="binder-desc"
              name="description"
              maxLength={500}
            />
          </div>
          <Button type="submit">Create binder</Button>
        </Form>
      </Card>

      {binders.length === 0 ? (
        <Card className="text-center">
          <p className="mb-1 text-lg font-medium text-fg">No binders yet</p>
          <p className="text-sm text-fg-muted">
            Binders are visual 9-pocket pages for organizing your collection — create your first one
            above.
          </p>
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {binders.map((binder) => (
            <li key={binder.id}>
              <Link
                to={`/app/binders/${binder.id}`}
                className="flex h-full flex-col gap-2 rounded-(--radius-card) border border-edge bg-surface p-5 hover:border-accent"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-fg">{binder.name}</span>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                      binder.visibility === "private"
                        ? "bg-surface-raised text-fg-muted"
                        : binder.visibility === "unlisted"
                          ? "bg-warning/20 text-fg"
                          : "bg-accent-soft text-accent-strong"
                    }`}
                  >
                    {binder.visibility}
                  </span>
                </div>
                {binder.description ? (
                  <p className="line-clamp-2 text-sm text-fg-muted">{binder.description}</p>
                ) : null}
                <p className="mt-auto text-xs text-fg-faint">
                  {binder.card_count} cards · {binder.page_count} pages
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
