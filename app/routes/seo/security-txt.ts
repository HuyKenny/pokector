import type { Route } from "./+types/security-txt";
import { getCloudflare } from "~/lib/context";

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const expires = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
  const body = [
    `Contact: mailto:${env.SUPPORT_EMAIL}`,
    `Expires: ${expires}`,
    `Canonical: ${env.APP_URL}/.well-known/security.txt`,
    "Preferred-Languages: en",
    "",
  ].join("\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=86400",
    },
  });
}
