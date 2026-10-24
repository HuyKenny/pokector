import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createDb, schema } from "~/lib/db/index.server";
import { authKvDelete, authKvGet, authKvSet, pruneExpiredAuthKv } from "~/lib/auth/kv-store.server";

describe("Better Auth D1 secondary storage", () => {
  it("sets and gets a value; missing keys are null", async () => {
    const db = createDb(env.DB);
    expect(await authKvGet(db, "auth:missing")).toBeNull();
    await authKvSet(db, "auth:session-1", "payload");
    expect(await authKvGet(db, "auth:session-1")).toBe("payload");
  });

  it("upserts (overwrites) an existing key", async () => {
    const db = createDb(env.DB);
    await authKvSet(db, "auth:k", "v1");
    await authKvSet(db, "auth:k", "v2");
    expect(await authKvGet(db, "auth:k")).toBe("v2");
  });

  it("treats expired rows as absent", async () => {
    const db = createDb(env.DB);
    // Row already expired (expiresAt one second in the past).
    await db.insert(schema.authKv).values({
      key: "auth:expired",
      value: "stale",
      expiresAt: Math.floor(Date.now() / 1000) - 1,
    });
    expect(await authKvGet(db, "auth:expired")).toBeNull();
  });

  it("deletes a key", async () => {
    const db = createDb(env.DB);
    await authKvSet(db, "auth:del", "x");
    await authKvDelete(db, "auth:del");
    expect(await authKvGet(db, "auth:del")).toBeNull();
  });

  it("prunes expired rows but keeps live and no-TTL rows", async () => {
    const db = createDb(env.DB);
    const now = Math.floor(Date.now() / 1000);
    await db.insert(schema.authKv).values([
      { key: "auth:p-dead", value: "a", expiresAt: now - 10 },
      { key: "auth:p-live", value: "b", expiresAt: now + 3600 },
      { key: "auth:p-forever", value: "c", expiresAt: null },
    ]);
    await pruneExpiredAuthKv(db);
    const rows = await db
      .select({ key: schema.authKv.key })
      .from(schema.authKv)
      .where(eq(schema.authKv.key, "auth:p-dead"));
    expect(rows.length).toBe(0);
    expect(await authKvGet(db, "auth:p-live")).toBe("b");
    expect(await authKvGet(db, "auth:p-forever")).toBe("c");
  });
});
