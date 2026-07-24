/**
 * Same-site relative-path guard (open-redirect defense). Client-safe (pure, no
 * server imports) so it can be shared by loaders/actions and client navigation.
 *
 * Accepts only a path that starts with a single "/" and cannot be reinterpreted
 * as an absolute or protocol-relative URL after the browser normalizes it:
 *  - rejects "//host" (protocol-relative → offsite),
 *  - rejects "/\host": browsers normalize "\" → "/", so "/\host" becomes "//host"
 *    → offsite redirect (the bypass the plain `!startsWith("//")` check missed),
 *  - rejects control chars (Tab/CR/LF …) that browsers strip, which can turn
 *    "/<TAB>/host" into "//host".
 * Anything failing the check falls back to `fallback`.
 */
// Control chars (\x00-\x1f) + backslash — the chars browsers strip/normalize.
// eslint-disable-next-line no-control-regex -- intentional
const UNSAFE_CHARS = /[\x00-\x1f\x5c]/;

export function safeRelativePath(to: string | null | undefined, fallback = "/"): string {
  if (!to || !to.startsWith("/")) return fallback;
  if (to.startsWith("//")) return fallback;
  if (UNSAFE_CHARS.test(to)) return fallback;
  return to;
}
