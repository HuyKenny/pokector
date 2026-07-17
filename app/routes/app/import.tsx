import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/import";
import { Alert, Button, Card } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { parseCsv } from "~/lib/csv/parse";
import { validateImportRows } from "~/lib/csv/import";
import { resolveRows, type ResolvedRow } from "~/lib/csv/import.server";
import { LIMITS } from "~/lib/limits";
import { enqueueJob, wakeUp } from "~/lib/jobs/queue.server";
import { enforceRateLimit } from "~/lib/security/rate-limit.server";
import { desc, eq } from "drizzle-orm";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Import CSV — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const recent = await db
    .select({
      id: schema.importJobs.id,
      status: schema.importJobs.status,
      mode: schema.importJobs.mode,
      totalRows: schema.importJobs.totalRows,
      successfulRows: schema.importJobs.successfulRows,
      failedRows: schema.importJobs.failedRows,
      createdAt: schema.importJobs.createdAt,
    })
    .from(schema.importJobs)
    .where(eq(schema.importJobs.userId, session.user.id))
    .orderBy(desc(schema.importJobs.createdAt))
    .limit(5);
  return {
    recent: recent.map((r) => ({ ...r, createdAt: r.createdAt.getTime() })),
    maxRows: LIMITS.maxCsvRows,
  };
}

const PreviewSchema = z.object({
  intent: z.literal("preview"),
  csv: z.string().min(1).max(LIMITS.maxImportBytes),
});
const CommitSchema = z.object({
  intent: z.literal("commit"),
  csv: z.string().min(1).max(LIMITS.maxImportBytes),
  mode: z.enum(["append", "merge"]),
});

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const form = Object.fromEntries(await request.formData());

  if (form.intent === "preview") {
    await enforceRateLimit(createDb(env.DB), "importPreview", session.user.id);
    const parsed = PreviewSchema.safeParse(form);
    if (!parsed.success) return { step: "error" as const, message: "Invalid CSV upload." };
    const csv = parseCsv(parsed.data.csv, LIMITS.maxCsvRows);
    const validation = validateImportRows(csv.header, csv.rows);
    const resolution = await resolveRows(db, validation.rows);
    const allErrors = [...validation.errors, ...resolution.errors].sort(
      (a, b) => a.rowNumber - b.rowNumber,
    );
    return {
      step: "preview" as const,
      csv: parsed.data.csv,
      truncated: csv.truncated,
      resolvedCount: resolution.resolved.length,
      totalRows: csv.rows.length,
      errors: allErrors.slice(0, 100),
      errorCount: allErrors.length,
      sample: resolution.resolved.slice(0, 10).map((r) => ({
        rowNumber: r.rowNumber,
        cardId: r.resolvedCardId,
        quantity: r.quantity,
        variant: r.variant,
        condition: r.condition,
      })),
    };
  }

  if (form.intent === "commit") {
    await enforceRateLimit(createDb(env.DB), "importCommit", session.user.id);
    const parsed = CommitSchema.safeParse(form);
    if (!parsed.success) return { step: "error" as const, message: "Invalid import." };
    const csv = parseCsv(parsed.data.csv, LIMITS.maxCsvRows);
    const validation = validateImportRows(csv.header, csv.rows);
    const resolution = await resolveRows(db, validation.rows);
    if (resolution.resolved.length === 0) {
      return { step: "error" as const, message: "No valid rows to import." };
    }

    const importJobId = crypto.randomUUID();
    const allErrors = [...validation.errors, ...resolution.errors];
    await db.insert(schema.importJobs).values({
      id: importJobId,
      userId: session.user.id,
      status: "pending",
      mode: parsed.data.mode,
      totalRows: resolution.resolved.length,
      errorReportJson: allErrors.length > 0 ? JSON.stringify(allErrors.slice(0, 500)) : null,
    });

    const rows: ResolvedRow[] = resolution.resolved;
    await enqueueJob(db, {
      type: "import_apply",
      payload: { userId: session.user.id, importJobId, mode: parsed.data.mode, rows },
      idempotencyKey: `import:${importJobId}`,
    });
    await wakeUp(env, "import_commit");

    return {
      step: "committed" as const,
      importJobId,
      queued: resolution.resolved.length,
      skipped: allErrors.length,
    };
  }

  return { step: "error" as const, message: "Unknown action." };
}

export default function ImportPage({ loaderData, actionData }: Route.ComponentProps) {
  const { recent, maxRows } = loaderData;
  const navigation = useNavigation();
  const [csvText, setCsvText] = useState("");
  const busy = navigation.state === "submitting";

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      alert("File is larger than 4 MB. Please split it.");
      return;
    }
    setCsvText(await file.text());
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-bold text-fg">Import a CSV</h1>

      {actionData?.step === "error" ? <Alert tone="error">{actionData.message}</Alert> : null}

      {actionData?.step === "committed" ? (
        <Alert tone="success">
          Import queued: {actionData.queued} rows will be added
          {actionData.skipped > 0 ? `, ${actionData.skipped} skipped` : ""}. Progress appears in the
          recent imports list below and you'll get a notification when it finishes.
        </Alert>
      ) : null}

      <Card>
        <Form method="post" className="flex flex-col gap-4">
          <input type="hidden" name="intent" value="preview" />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="csv-file" className="text-sm font-medium text-fg">
              Upload a CSV file
            </label>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void onFile(e.target.files?.[0])}
              className="text-sm text-fg-muted"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="csv-text" className="text-sm font-medium text-fg">
              …or paste CSV content
            </label>
            <textarea
              id="csv-text"
              name="csv"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={8}
              required
              placeholder="pokector_card_id,quantity,variant,condition,purchase_price&#10;base1-4,1,holofoil,Near Mint,350.00"
              className="rounded-lg border border-edge bg-surface px-3 py-2 font-mono text-xs text-fg"
            />
            <p className="text-xs text-fg-faint">
              Up to {maxRows.toLocaleString("en-US")} rows. Cards resolve by{" "}
              <code>pokector_card_id</code> first, then <code>set_id</code> +{" "}
              <code>card_number</code>. See the{" "}
              <Link to="/app/export" className="text-accent hover:underline">
                export page
              </Link>{" "}
              for the exact format.
            </p>
          </div>
          <Button type="submit" disabled={busy || csvText.trim() === ""}>
            {busy ? "Checking…" : "Preview import"}
          </Button>
        </Form>
      </Card>

      {actionData?.step === "preview" ? (
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-fg">Preview</h2>
          <p className="text-sm text-fg-muted">
            <strong className="text-fg">{actionData.resolvedCount}</strong> of{" "}
            {actionData.totalRows} rows resolved to catalog cards
            {actionData.errorCount > 0 ? `, ${actionData.errorCount} with problems` : ""}.
            {actionData.truncated ? " (Row limit reached — extra rows were dropped.)" : ""}
          </p>

          {actionData.errors.length > 0 ? (
            <div className="mt-3">
              <p className="mb-1 text-sm font-medium text-negative">Row problems (first 100):</p>
              <ul className="max-h-40 overflow-auto rounded-lg border border-edge p-2 text-xs text-fg-muted">
                {actionData.errors.map((e, i) => (
                  <li key={i}>
                    Row {e.rowNumber}: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {actionData.resolvedCount > 0 ? (
            <Form method="post" className="mt-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="intent" value="commit" />
              <input type="hidden" name="csv" value={actionData.csv} />
              <div className="flex flex-col gap-1">
                <label htmlFor="mode" className="text-sm font-medium text-fg">
                  Import mode
                </label>
                <select
                  id="mode"
                  name="mode"
                  className="min-h-11 rounded-lg border border-edge bg-surface px-3 text-fg"
                >
                  <option value="append">Append — add every row as a new lot</option>
                  <option value="merge">Merge — add quantity to matching entries</option>
                </select>
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? "Importing…" : `Import ${actionData.resolvedCount} rows`}
              </Button>
            </Form>
          ) : null}
        </Card>
      ) : null}

      {recent.length > 0 ? (
        <Card>
          <h2 className="mb-3 text-lg font-semibold text-fg">Recent imports</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {recent.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-fg">
                  {new Date(job.createdAt).toLocaleString("en-US")} · {job.mode}
                </span>
                <span className="text-fg-muted">
                  {job.status} · {job.successfulRows}/{job.totalRows} imported
                  {job.failedRows > 0 ? ` · ${job.failedRows} failed` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
