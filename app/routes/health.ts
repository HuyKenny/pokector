import type { Route } from "./+types/health";
import { getCloudflare } from "~/lib/context";
import { log } from "~/lib/log.server";

/**
 * Health endpoint (SPEC §25). Exposes component status only — no configuration,
 * no secrets, no internals beyond up/down and last catalog sync freshness.
 */
export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);

  let database = "ok";
  let lastCatalogSync: string | null = null;
  try {
    const row = await env.DB.prepare(
      "SELECT completed_at FROM sync_runs WHERE kind = 'catalog_full' AND status = 'completed' ORDER BY completed_at DESC LIMIT 1",
    ).first<{ completed_at: number | null }>();
    if (row?.completed_at) lastCatalogSync = new Date(row.completed_at).toISOString();
  } catch (error) {
    database = "error";
    log.error("health.db_check_failed", {
      errorCode: error instanceof Error ? error.name : "UnknownError",
    });
  }

  let cache = "ok";
  try {
    await env.KV.get("health:probe");
  } catch {
    cache = "error";
  }

  const healthy = database === "ok" && cache === "ok";
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      environment: env.ENVIRONMENT,
      database,
      cache,
      lastCatalogSync,
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
