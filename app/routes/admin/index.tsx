import { count, desc, eq } from "drizzle-orm";
import { Form } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/index";
import { Alert, Button, Card } from "~/components/ui";
import { requireAdmin } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { isEmailConfigured } from "~/lib/email/index.server";
import { enqueueJob, wakeUp } from "~/lib/jobs/queue.server";
import { getDailyBudget, getDailyRequestCount } from "~/lib/ptcg/client.server";
import { enforceRateLimit } from "~/lib/security/rate-limit.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Admin — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireAdmin(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);

  const [cardCount] = await db.select({ n: count() }).from(schema.pokemonCards);
  const [setCount] = await db.select({ n: count() }).from(schema.pokemonSets);
  const [trackedCount] = await db.select({ n: count() }).from(schema.trackedCards);
  const [userCount] = await db.select({ n: count() }).from(schema.user);

  const jobCounts = await db
    .select({ status: schema.syncJobs.status, n: count() })
    .from(schema.syncJobs)
    .groupBy(schema.syncJobs.status);

  const lastRuns = await db
    .select()
    .from(schema.syncRuns)
    .orderBy(desc(schema.syncRuns.startedAt))
    .limit(5);

  const failedJobs = await db
    .select({
      id: schema.syncJobs.id,
      type: schema.syncJobs.type,
      errorMessage: schema.syncJobs.errorMessage,
      attemptCount: schema.syncJobs.attemptCount,
    })
    .from(schema.syncJobs)
    .where(eq(schema.syncJobs.status, "failed"))
    .orderBy(desc(schema.syncJobs.createdAt))
    .limit(10);

  const apiRequestsToday = await getDailyRequestCount(db);

  return {
    environment: env.ENVIRONMENT,
    stats: {
      users: userCount.n,
      cards: cardCount.n,
      sets: setCount.n,
      tracked: trackedCount.n,
    },
    jobCounts: Object.fromEntries(jobCounts.map((row) => [row.status, row.n])) as Record<
      string,
      number
    >,
    lastRuns: lastRuns.map((run) => ({
      id: run.id,
      kind: run.kind,
      status: run.status,
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      completedPages: run.completedPages,
      totalPages: run.totalPages,
      cardsUpserted: run.cardsUpserted,
      pricesUpserted: run.pricesUpserted,
      malformedSkipped: run.malformedSkipped,
      apiRequestCount: run.apiRequestCount,
      errorMessage: run.errorMessage,
    })),
    failedJobs,
    api: {
      requestsToday: apiRequestsToday,
      dailyBudget: getDailyBudget(),
      keyConfigured: Boolean(env.POKEMON_TCG_API_KEY),
    },
    warnings: {
      emailMissing: !isEmailConfigured(env),
      ptcgKeyMissing: !env.POKEMON_TCG_API_KEY,
      turnstileMissing: !env.TURNSTILE_SECRET_KEY,
    },
  };
}

const ActionSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("sync-catalog") }),
  z.object({ intent: z.literal("record-price-history") }),
  z.object({ intent: z.literal("run-retention") }),
  z.object({ intent: z.literal("retry-job"), jobId: z.string().uuid() }),
]);

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireAdmin(context, request);
  const { env } = getCloudflare(context);
  await enforceRateLimit(createDb(env.DB), "adminJobs", session.user.id);

  const parsed = ActionSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { ok: false as const, message: "Invalid action." };
  const db = createDb(env.DB);

  const audit = async (action: string, targetId?: string) => {
    await db.insert(schema.adminAuditLogs).values({
      id: crypto.randomUUID(),
      adminUserId: session.user.id,
      action,
      targetType: "sync_job",
      targetId: targetId ?? null,
      metadataJson: null,
    });
  };

  switch (parsed.data.intent) {
    case "sync-catalog": {
      if (!env.POKEMON_TCG_API_KEY) {
        return {
          ok: false as const,
          message:
            "POKEMON_TCG_API_KEY is not configured. Set it with: wrangler secret put POKEMON_TCG_API_KEY --env " +
            env.ENVIRONMENT,
        };
      }
      const jobId = await enqueueJob(db, {
        type: "catalog_sets",
        payload: { kind: "catalog_full" },
        idempotencyKey: `catalog:manual:${new Date().toISOString().slice(0, 13)}`,
      });
      if (!jobId)
        return {
          ok: false as const,
          message: "A catalog sync was already queued within this hour.",
        };
      await audit("admin.sync_catalog_started", jobId);
      await wakeUp(env, "admin_sync_catalog");
      return { ok: true as const, message: "Catalog sync queued." };
    }
    case "record-price-history": {
      const jobId = await enqueueJob(db, {
        type: "price_history_record",
        idempotencyKey: `history:manual:${new Date().toISOString().slice(0, 13)}`,
      });
      if (!jobId)
        return {
          ok: false as const,
          message: "Price history job already queued within this hour.",
        };
      await audit("admin.price_history_started", jobId);
      await wakeUp(env, "admin_price_history");
      return { ok: true as const, message: "Price-history job queued." };
    }
    case "run-retention": {
      const jobId = await enqueueJob(db, {
        type: "retention_aggregate",
        idempotencyKey: `retention:manual:${new Date().toISOString().slice(0, 10)}`,
      });
      if (!jobId) return { ok: false as const, message: "Retention job already queued today." };
      await audit("admin.retention_started", jobId);
      await wakeUp(env, "admin_retention");
      return { ok: true as const, message: "Retention job queued." };
    }
    case "retry-job": {
      const result = await db
        .update(schema.syncJobs)
        .set({
          status: "pending",
          runAfter: null,
          lockedUntil: null,
          errorMessage: null,
          attemptCount: 0,
        })
        .where(eq(schema.syncJobs.id, parsed.data.jobId))
        .returning({ id: schema.syncJobs.id });
      if (result.length === 0) return { ok: false as const, message: "Job not found." };
      await audit("admin.job_retried", parsed.data.jobId);
      await wakeUp(env, "admin_retry");
      return { ok: true as const, message: "Job re-queued." };
    }
  }
}

export default function AdminOverview({ loaderData, actionData }: Route.ComponentProps) {
  const { stats, jobCounts, lastRuns, failedJobs, api, warnings, environment } = loaderData;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-fg">Admin overview</h1>
        <span className="rounded bg-surface-raised px-2 py-1 text-xs uppercase text-fg-muted">
          {environment}
        </span>
      </div>

      {actionData ? (
        <Alert tone={actionData.ok ? "success" : "error"}>{actionData.message}</Alert>
      ) : null}

      {warnings.ptcgKeyMissing ? (
        <Alert tone="warning">
          Pokémon TCG API key is missing — catalog synchronization is disabled. Set it with{" "}
          <code className="font-mono text-xs">
            wrangler secret put POKEMON_TCG_API_KEY --env {environment}
          </code>
          .
        </Alert>
      ) : null}
      {warnings.emailMissing ? (
        <Alert tone="warning">
          No e-mail provider configured — verification, password-reset, and alert e-mails are
          disabled (honest degraded mode). Set RESEND_API_KEY to enable them.
        </Alert>
      ) : null}
      {warnings.turnstileMissing ? (
        <Alert tone="warning">
          Turnstile secret is missing — captcha verification is not enforced.
        </Alert>
      ) : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Users" value={stats.users} />
        <StatCard label="Catalog cards" value={stats.cards} />
        <StatCard label="Sets" value={stats.sets} />
        <StatCard label="Tracked cards" value={stats.tracked} />
      </div>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-fg">Synchronization</h2>
        <p className="mb-4 text-sm text-fg-muted">
          PTCG API today: <strong>{api.requestsToday}</strong> / {api.dailyBudget} requests
          {api.keyConfigured ? "" : " (key missing)"}
          {" · "}Jobs: pending {jobCounts.pending ?? 0}, running {jobCounts.running ?? 0}, failed{" "}
          {jobCounts.failed ?? 0}, completed {jobCounts.completed ?? 0}
        </p>
        <div className="flex flex-wrap gap-3">
          <Form method="post">
            <input type="hidden" name="intent" value="sync-catalog" />
            <Button type="submit" disabled={!api.keyConfigured}>
              Start catalog sync
            </Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="record-price-history" />
            <Button type="submit" variant="secondary">
              Record price history
            </Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="run-retention" />
            <Button type="submit" variant="secondary">
              Run retention
            </Button>
          </Form>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-fg">Recent sync runs</h2>
        {lastRuns.length === 0 ? (
          <p className="text-sm text-fg-muted">No sync runs yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-edge text-fg-muted">
                  <th className="py-2 pr-4">Kind</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Pages</th>
                  <th className="py-2 pr-4">Cards</th>
                  <th className="py-2 pr-4">Prices</th>
                  <th className="py-2 pr-4">Malformed</th>
                  <th className="py-2 pr-4">API req.</th>
                  <th className="py-2">Started</th>
                </tr>
              </thead>
              <tbody>
                {lastRuns.map((run) => (
                  <tr key={run.id} className="border-b border-edge/50">
                    <td className="py-2 pr-4">{run.kind}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={
                          run.status === "completed"
                            ? "text-positive"
                            : run.status === "failed"
                              ? "text-negative"
                              : "text-warning"
                        }
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {run.completedPages}/{run.totalPages ?? "?"}
                    </td>
                    <td className="py-2 pr-4">{run.cardsUpserted}</td>
                    <td className="py-2 pr-4">{run.pricesUpserted}</td>
                    <td className="py-2 pr-4">{run.malformedSkipped}</td>
                    <td className="py-2 pr-4">{run.apiRequestCount}</td>
                    <td className="py-2">{new Date(run.startedAt).toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-semibold text-fg">Failed jobs</h2>
        {failedJobs.length === 0 ? (
          <p className="text-sm text-fg-muted">No failed jobs. 🎉</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {failedJobs.map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-edge p-3"
              >
                <div className="text-sm">
                  <span className="font-medium text-fg">{job.type}</span>{" "}
                  <span className="text-fg-muted">({job.attemptCount} attempts)</span>
                  <p className="max-w-xl truncate text-xs text-fg-faint">{job.errorMessage}</p>
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="retry-job" />
                  <input type="hidden" name="jobId" value={job.id} />
                  <Button type="submit" variant="secondary">
                    Retry
                  </Button>
                </Form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="!p-4">
      <p className="text-xs uppercase tracking-wide text-fg-muted">{label}</p>
      <p className="text-2xl font-bold text-fg">{value.toLocaleString("en-US")}</p>
    </Card>
  );
}
