import { redirect } from "react-router";

import type { Route } from "./+types/logout";
import { getAuth } from "~/lib/auth/auth.server";
import { getCloudflare } from "~/lib/context";

/** POST-only sign-out (state change must not be a GET). */
export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  const auth = getAuth(env);
  const response = await auth.api.signOut({ headers: request.headers, asResponse: true });
  const headers = new Headers();
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") headers.append("Set-Cookie", value);
  });
  return redirect("/", { headers });
}

export function loader() {
  return redirect("/");
}
