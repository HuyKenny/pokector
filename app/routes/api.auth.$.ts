import type { Route } from "./+types/api.auth.$";
import { getAuth } from "~/lib/auth/auth.server";
import { getCloudflare } from "~/lib/context";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  return getAuth(env).handler(request);
}

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  return getAuth(env).handler(request);
}
