import { createRequestHandler, RouterContextProvider } from "react-router";

import { cloudflareContext, requestIdContext } from "../app/lib/context";
import { onQueueBatch, onScheduled } from "../app/lib/jobs/runtime.server";
import { log } from "../app/lib/log.server";
import { applySecurityHeaders } from "../app/lib/security/headers.server";

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    const url = new URL(request.url);
    try {
      const routerContext = new RouterContextProvider();
      routerContext.set(cloudflareContext, { env, ctx });
      routerContext.set(requestIdContext, requestId);
      const response = await requestHandler(request, routerContext);
      const secured = applySecurityHeaders(response, {
        production: env.ENVIRONMENT === "production",
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
