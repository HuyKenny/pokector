/**
 * Password hashing via native node:crypto scrypt (nodejs_compat).
 *
 * Better Auth's default hasher is pure-JS scrypt (@noble/hashes), which is known to
 * exceed Workers CPU limits (upstream issues #8860/#8456) — a hard blocker on the
 * 10 ms Free-plan budget. Native scrypt runs in the runtime, outside JS CPU
 * accounting. Format: `scrypt$N$r$p$<salt b64url>$<hash b64url>`.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function scryptAsync(
  password: string,
  salt: Buffer,
  n: number,
  r: number,
  p: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_LENGTH,
      { N: n, r, p, maxmem: 128 * n * r * 2 },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password, salt, N, R, P);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
  const parts = data.hash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number.parseInt(parts[1], 10);
  const r = Number.parseInt(parts[2], 10);
  const p = Number.parseInt(parts[3], 10);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (salt.length !== SALT_LENGTH || expected.length !== KEY_LENGTH) return false;
  const actual = await scryptAsync(data.password, salt, n, r, p);
  return timingSafeEqual(actual, expected);
}
