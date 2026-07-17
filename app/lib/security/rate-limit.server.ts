/**
 * KV-backed fixed-window rate limiter for non-auth surfaces (search, import,
 * export, alert config, admin jobs). Better Auth endpoints use its built-in
 * limiter (also KV via secondaryStorage). KV is eventually consistent, so limits
 * are approximate — acceptable for abuse control, not for billing.
 */

export interface RateLimitRule {
  /** Window length in seconds. */
  window: number;
  /** Max requests per window. */
  max: number;
}

export const RATE_LIMITS = {
  search: { window: 60, max: 60 },
  importPreview: { window: 300, max: 10 },
  importCommit: { window: 3600, max: 6 },
  export: { window: 300, max: 5 },
  alertConfig: { window: 60, max: 20 },
  adminJobs: { window: 60, max: 10 },
  publicBinderView: { window: 60, max: 60 },
  apiWrite: { window: 60, max: 60 },
} satisfies Record<string, RateLimitRule>;

export type RateLimitScope = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * `identity` should be a user ID for authenticated scopes or the client IP
 * (cf-connecting-ip) for anonymous ones.
 */
export async function checkRateLimit(
  kv: KVNamespace,
  scope: RateLimitScope,
  identity: string,
): Promise<RateLimitResult> {
  const rule = RATE_LIMITS[scope];
  const windowStart = Math.floor(Date.now() / 1000 / rule.window) * rule.window;
  const key = `rl:${scope}:${identity}:${windowStart}`;

  const current = Number.parseInt((await kv.get(key)) ?? "0", 10);
  if (current >= rule.max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: windowStart + rule.window - Math.floor(Date.now() / 1000),
    };
  }

  // Not atomic (KV has no increment); approximate by design.
  await kv.put(key, String(current + 1), { expirationTtl: Math.max(rule.window * 2, 60) });
  return { allowed: true, remaining: rule.max - current - 1, retryAfterSeconds: 0 };
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/** Throws a 429 Response when over the limit (route-friendly). */
export async function enforceRateLimit(
  kv: KVNamespace,
  scope: RateLimitScope,
  identity: string,
): Promise<void> {
  const result = await checkRateLimit(kv, scope, identity);
  if (!result.allowed) {
    throw new Response(
      JSON.stringify({
        error: { code: "rate_limited", message: "Too many requests. Please slow down." },
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.max(result.retryAfterSeconds, 1)),
        },
      },
    );
  }
}
