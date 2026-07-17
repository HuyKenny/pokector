import { Link } from "react-router";

import type { Route } from "./+types/export";
import { Card } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import { EXPORT_COLUMNS } from "~/lib/csv/export.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Export Collection — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  await requireUser(context, request);
  return { columns: [...EXPORT_COLUMNS] };
}

export default function ExportPage({ loaderData }: Route.ComponentProps) {
  const { columns } = loaderData;
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold text-fg">Export your collection</h1>
      <Card>
        <p className="mb-4 text-sm text-fg-muted">
          Download your entire collection as a CSV file in the documented Pokector format. The file
          re-imports cleanly and never contains another user's data.
        </p>
        <a
          href="/app/export/download"
          className="inline-flex min-h-11 items-center rounded-lg bg-accent px-5 py-2 font-medium text-white hover:bg-accent-strong"
        >
          Download full collection (CSV)
        </a>
        <p className="mt-4 text-xs text-fg-faint">
          To export a filtered subset, use the “Export CSV” button on the{" "}
          <Link to="/app/collection" className="text-accent hover:underline">
            collection page
          </Link>{" "}
          (it carries your current filters).
        </p>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold text-fg">CSV format</h2>
        <p className="mb-2 text-sm text-fg-muted">Columns, in order:</p>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs text-fg-muted">
          {columns.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
