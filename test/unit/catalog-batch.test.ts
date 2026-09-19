import { drizzle } from "drizzle-orm/d1";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { batchD1 } from "~/lib/jobs/handlers/catalog.server";

/**
 * A stand-in for the D1 binding: `prepare()` returns a statement that records
 * itself, `batch()` records what it was handed. Enough to exercise both the
 * native path and Drizzle's wrapper around it.
 */
function fakeD1() {
  const batches: unknown[][] = [];
  const prepared: string[] = [];
  const client = {
    prepare(sqlText: string) {
      prepared.push(sqlText);
      const stmt = {
        sqlText,
        bind: (...params: unknown[]) => Object.assign(stmt, { params }),
        run: () => Promise.resolve({}),
        all: () => Promise.resolve({ results: [] }),
        raw: () => Promise.resolve([]),
      };
      return stmt;
    },
    batch: (statements: unknown[]) => {
      batches.push(statements);
      return Promise.resolve(statements.map(() => ({ results: [] })));
    },
    exec: () => Promise.resolve({ count: 0, duration: 0 }),
    dump: () => Promise.resolve(new ArrayBuffer(0)),
  };
  return { client, batches, prepared };
}

describe("batchD1", () => {
  it("chunks into batches of 20 and calls the native binding", async () => {
    const { client, batches } = fakeD1();
    const statements = Array.from({ length: 45 }, () =>
      (client.prepare("SELECT 1") as { bind: () => unknown }).bind(),
    );

    await batchD1(client as never, statements as never);

    expect(batches.map((b) => b.length)).toEqual([20, 20, 5]);
  });

  it("does nothing for an empty statement list", async () => {
    const { client, batches } = fakeD1();
    await batchD1(client as never, [] as never);
    expect(batches).toHaveLength(0);
  });
});

/**
 * The regression this guards, in Drizzle 0.45.2.
 *
 * `db.run()` returns a `SQLiteRaw` whose `_prepare()` is `return this`, and
 * `SQLiteRaw` has no `stmt` property — but `SQLiteD1Session.batch()` calls
 * `preparedQuery.stmt.bind(...)` whenever the statement has parameters.
 *
 * Feeding `db.run()` into `db.batch()` therefore throws. That is exactly what
 * froze every Pokémon price for two months: the FTS writes used `db.run()`
 * inside a batch, and because cards are written before the FTS step and prices
 * after it, the site kept gaining cards while no price ever changed.
 *
 * If this test ever fails, Drizzle has changed behaviour — and the native
 * `batchD1` path in the catalog handler is no longer strictly required.
 */
describe("drizzle db.run() cannot be batched (documents the bug)", () => {
  it("throws when a parameterised db.run() goes into db.batch()", async () => {
    const { client } = fakeD1();
    const db = drizzle(client as never, { schema: {} as never });

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      db.batch([
        db.run(sql`DELETE FROM card_search WHERE card_id = ${"card-1"}`) as never,
      ] as never),
    ).rejects.toThrow(/bind/);
    spy.mockRestore();
  });
});
