import { redirect, type RouterContextProvider } from "react-router";

import { getCloudflare } from "../context";
import { getSession } from "./auth.server";

export type SessionData = NonNullable<Awaited<ReturnType<typeof getSession>>>;
export type SessionUser = SessionData["user"];

/** Redirects unauthenticated visitors to /login (preserving the return path). */
export async function requireUser(
  context: Readonly<RouterContextProvider>,
  request: Request,
): Promise<SessionData> {
  const { env } = getCloudflare(context);
  const session = await getSession(env, request);
  if (!session) {
    const url = new URL(request.url);
    const returnTo = encodeURIComponent(url.pathname + url.search);
    throw redirect(`/login?returnTo=${returnTo}`);
  }
  return session;
}

/** 404 (not 403) for non-admins — avoids advertising the admin surface. */
export async function requireAdmin(
  context: Readonly<RouterContextProvider>,
  request: Request,
): Promise<SessionData> {
  const session = await requireUser(context, request);
  if (session.user.role !== "admin") {
    throw new Response("Not Found", { status: 404 });
  }
  return session;
}

/** Session or null without redirecting (public pages with optional personalization). */
export async function optionalUser(
  context: Readonly<RouterContextProvider>,
  request: Request,
): Promise<SessionData | null> {
  const { env } = getCloudflare(context);
  return getSession(env, request);
}
