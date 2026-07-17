import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "~/lib/auth/scrypt.server";

describe("scrypt password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(await verifyPassword({ hash, password: "correct horse battery staple" })).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("password-one");
    expect(await verifyPassword({ hash, password: "password-two" })).toBe(false);
  });

  it("produces unique salts", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
  });

  it("normalizes unicode (NFKC) consistently", async () => {
    // "é" composed vs decomposed must verify identically.
    const hash = await hashPassword("café-password");
    expect(await verifyPassword({ hash, password: "café-password" })).toBe(true);
  });

  it("rejects malformed hashes without throwing", async () => {
    expect(await verifyPassword({ hash: "not-a-hash", password: "x" })).toBe(false);
    expect(await verifyPassword({ hash: "scrypt$16384$8$1$short$short", password: "x" })).toBe(
      false,
    );
  });
});
