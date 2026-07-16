import { createContext, type RouterContextProvider } from "react-router";

/**
 * Typed React Router v8 contexts provided by the Worker fetch handler
 * (workers/app.ts). Loaders/actions read them via `context.get(...)`.
 */

export interface CloudflareContextValue {
  env: Env;
  ctx: ExecutionContext;
}

export const cloudflareContext = createContext<CloudflareContextValue>();

/** Correlation ID attached to logs and error responses. */
export const requestIdContext = createContext<string>();

export function getCloudflare(context: RouterContextProvider): CloudflareContextValue {
  return context.get(cloudflareContext);
}

export function getRequestId(context: RouterContextProvider): string {
  return context.get(requestIdContext);
}
