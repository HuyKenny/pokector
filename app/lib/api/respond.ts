/**
 * Consistent JSON API envelope + helpers (SPEC §20). Every response carries a
 * request ID; errors use a stable `{ error: { code, message } }` shape and
 * never leak stack traces.
 */

export interface ApiErrorBody {
  error: { code: string; message: string };
  requestId?: string;
}

export function apiJson<T>(data: T, init: ResponseInit = {}, requestId?: string): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (requestId) headers.set("X-Request-Id", requestId);
  if (!headers.has("Cache-Control"))
    headers.set("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function apiError(
  status: number,
  code: string,
  message: string,
  requestId?: string,
): Response {
  const body: ApiErrorBody = { error: { code, message }, requestId };
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Clamp a page-size query param to a hard maximum. */
export function pageSizeParam(url: URL, fallback: number, max: number): number {
  const raw = Number.parseInt(url.searchParams.get("pageSize") ?? "", 10);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return Math.min(raw, max);
}
