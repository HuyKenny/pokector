import { createRequestHandler, RouterContextProvider } from "react-router";

import {
  cloudflareContext,
  gameContext,
  marketContext,
  nonceContext,
  requestIdContext,
} from "../app/lib/context";
import { DEFAULT_GAME, gameFromCookieHeader } from "../app/lib/game/game";
import { marketFromCookieHeader, marketFromCountry } from "../app/lib/market/market";
import { onQueueBatch, onScheduled } from "../app/lib/jobs/runtime.server";
import { log } from "../app/lib/log.server";
import { applySecurityHeaders } from "../app/lib/security/headers.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

/** Canonical host + trailing-slash policy (SPEC §23): www → apex, no trailing
 * slash except root. HTTP→HTTPS is enforced by Cloudflare at the edge. */
function canonicalRedirect(url: URL, env: Env): Response | null {
  const canonicalHost = new URL(env.APP_URL).host;
  let changed = false;

  if (url.host === `www.${canonicalHost}`) {
    url.host = canonicalHost;
    changed = true;
  }
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
    changed = true;
  }
  return changed ? Response.redirect(url.toString(), 301) : null;
}

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const url = new URL(request.url);
    try {
      if (request.method === "GET" || request.method === "HEAD") {
        const redirect = canonicalRedirect(url, env);
        if (redirect) return redirect;
      }
      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
      const routerContext = new RouterContextProvider();
      routerContext.set(cloudflareContext, { env, ctx });
      routerContext.set(requestIdContext, requestId);
      routerContext.set(nonceContext, nonce);
      // Market = explicit cookie choice, else Cloudflare geolocation default.
      const market =
        marketFromCookieHeader(request.headers.get("cookie")) ??
        marketFromCountry(request.cf?.country);
      routerContext.set(marketContext, market);
      // Remembered game preference (active game is URL-derived; this is only the
      // "where to land" hint for the logo/home link and the game switcher).
      routerContext.set(
        gameContext,
        gameFromCookieHeader(request.headers.get("cookie")) ?? DEFAULT_GAME,
      );
      const response = await requestHandler(request, routerContext);
      const secured = applySecurityHeaders(response, {
        secure: env.ENVIRONMENT !== "development",
        production: env.ENVIRONMENT === "production",
        nonce,
      });
      secured.headers.set("X-Request-Id", requestId);
      log.info("request", {
        requestId,
        environment: env.ENVIRONMENT,
        route: url.pathname,
        status: secured.status,
        durationMs: Date.now() - startedAt,
      });
      return secured;
    } catch (error) {
      log.error("request.unhandled", {
        requestId,
        environment: env.ENVIRONMENT,
        route: url.pathname,
        errorCode: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message : String(error),
      });
      return new Response(`Internal Server Error (request ${requestId})`, {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },

  scheduled(controller, env, ctx) {
    ctx.waitUntil(onScheduled(controller, env, ctx));
  },

  async queue(batch, env, ctx) {
    await onQueueBatch(batch, env, ctx);
  },
} satisfies ExportedHandler<Env>;
