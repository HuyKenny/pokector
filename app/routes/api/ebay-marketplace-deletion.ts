/**
 * eBay Marketplace Account Deletion / Closure notification endpoint (required
 * for production keyset compliance). We store NO eBay user data, so deletion
 * notifications are simply acknowledged.
 *
 * - GET  ?challenge_code=…  → endpoint validation: respond with
 *   SHA-256(challengeCode + verificationToken + endpointURL) as hex.
 * - POST notification       → 200 ack (nothing to delete on our side).
 *
 * Configure the endpoint URL + verification token in the eBay developer console
 * (Alerts & Notifications). The token is the `EBAY_VERIFICATION_TOKEN` secret.
 */
import type { Route } from "./+types/ebay-marketplace-deletion";
import { getCloudflare } from "~/lib/context";
import { log } from "~/lib/log.server";

const PATH = "/api/ebay/marketplace-deletion";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const challengeCode = new URL(request.url).searchParams.get("challenge_code");
  const token = env.EBAY_VERIFICATION_TOKEN;
  if (!token || !challengeCode) {
    return new Response("Not configured", { status: 500 });
  }
  // The endpoint URL MUST match exactly what is registered in the eBay console.
  const endpoint = `${env.APP_URL}${PATH}`;
  const challengeResponse = await sha256Hex(challengeCode + token + endpoint);
  return Response.json({ challengeResponse });
}

export function action({ context }: Route.ActionArgs) {
  const { env } = getCloudflare(context);
  // We hold no eBay user data (only application-scope Browse lookups) — nothing
  // to delete. Acknowledge so eBay marks the notification delivered.
  log.info("ebay.marketplace_deletion_ack", { environment: env.ENVIRONMENT });
  return new Response(null, { status: 200 });
}
