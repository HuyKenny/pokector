/**
 * Svix webhook signature verification.
 *
 * Autumn delivers webhooks through Svix. Implemented here with WebCrypto rather
 * than the Svix SDK: the algorithm is one HMAC and a constant-time compare, and
 * the SDK would add weight to a Worker for that.
 *
 * The scheme:
 *  1. signed content is `{svix-id}.{svix-timestamp}.{raw body}`
 *  2. the secret is `whsec_<base64>`; the base64 part decodes to the HMAC key
 *  3. HMAC-SHA256, base64-encoded
 *  4. `svix-signature` is a space-separated list of `v<n>,<signature>` — a match
 *     against any `v1` entry is a pass, which is how Svix rotates secrets
 *  5. a timestamp outside the tolerance is rejected, to bound replay
 *
 * Verified against a self-generated signature in
 * `test/unit/svix.test.ts`, including every rejection path.
 */

export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SvixRejection =
  | "missing_headers"
  | "malformed_secret"
  | "timestamp_out_of_tolerance"
  | "no_v1_signature"
  | "signature_mismatch";

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export function svixHeaders(headers: Headers): SvixHeaders {
  return {
    id: headers.get("svix-id"),
    timestamp: headers.get("svix-timestamp"),
    signature: headers.get("svix-signature"),
  };
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Constant-time comparison of two base64 signatures. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signSvix(
  secret: string,
  id: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const key = await crypto.subtle.importKey(
    "raw",
    base64Decode(raw) as unknown as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = `${id}.${timestamp}.${body}`;
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signed));
  return base64Encode(new Uint8Array(mac));
}

export async function verifySvix(input: {
  secret: string;
  headers: SvixHeaders;
  body: string;
  toleranceSeconds?: number;
  now?: number;
}): Promise<{ ok: true } | { ok: false; reason: SvixRejection }> {
  const { id, timestamp, signature } = input.headers;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };

  const seconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(seconds)) return { ok: false, reason: "timestamp_out_of_tolerance" };
  const tolerance = (input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS) * 1000;
  const drift = Math.abs((input.now ?? Date.now()) - seconds * 1000);
  if (drift > tolerance) return { ok: false, reason: "timestamp_out_of_tolerance" };

  let expected: string;
  try {
    expected = await signSvix(input.secret, id, timestamp, input.body);
  } catch {
    return { ok: false, reason: "malformed_secret" };
  }

  // Space-separated `v1,<sig>` entries. More than one appears while a secret is
  // being rotated, and matching any is the documented behaviour.
  const candidates = signature
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .map((part) => part.slice("v1,".length));

  if (candidates.length === 0) return { ok: false, reason: "no_v1_signature" };
  for (const candidate of candidates) {
    if (timingSafeEqual(candidate, expected)) return { ok: true };
  }
  return { ok: false, reason: "signature_mismatch" };
}
