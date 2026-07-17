import { env } from "cloudflare:test";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import setsFixture from "../fixtures/ptcg/sets.json";
import base1Fixture from "../fixtures/ptcg/cards-base1.json";
import { createDb, schema } from "~/lib/db/index.server";
import { enqueueJob, hasDueJobs } from "~/lib/jobs/queue.server";
import { runJobBatch } from "~/lib/jobs/scheduler.server";
import { __setPtcgFetchForTests } from "~/lib/ptcg/client.server";

/** Serves fixture data for api.pokemontcg.io: 102 base1 cards in 50-card pages. */
const fixtureFetch: typeof fetch = (input) => {
  const url = new URL(
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
  );
  if (url.hostname !== "api.pokemontcg.io") {
    return Promise.reject(new Error(`Unexpected outbound request in test: ${url.href}`));
  }
  const json = (body: unknown) =>
    Promise.resolve(
      new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
    );
  if (url.pathname === "/v2/sets") {
    return json({ data: setsFixture.data, totalCount: setsFixture.data.length });
  }
  if (url.pathname === "/v2/cards") {
    const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
    const pageSize = Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10);
    const items = base1Fixture.data.slice((page - 1) * pageSize, page * pageSize);
    return json({ data: items, totalCount: base1Fixture.data.length });
  }
  return Promise.resolve(new Response("Not Found", { status: 404 }));
};

async function drainJobs(maxIterations = 30): Promise<number> {
  const db = createDb(env.DB);
  let iterations = 0;
  while ((await hasDueJobs(db)) && iterations < maxIterations) {
    await runJobBatch(env);
    iterations++;
  }
  return iterations;
}

describe("catalog synchronization (fixture-mocked API)", () => {
  beforeAll(() => {
    __setPtcgFetchForTests(fixtureFetch);
  });

  afterAll(() => {
    __setPtcgFetchForTests(null);
  });

  it("runs a full sync, is idempotent, and marks the run completed", async () => {
    const db = createDb(env.DB);

    await enqueueJob(db, {
      type: "catalog_sets",
      payload: { kind: "catalog_full" },
      idempotencyKey: "test:catalog:1",
    });
    await drainJobs();

    const [setCount] = await db.select({ n: count() }).from(schema.pokemonSets);
    const [cardCount] = await db.select({ n: count() }).from(schema.pokemonCards);
    const [priceCount] = await db.select({ n: count() }).from(schema.cardPricesCurrent);
    expect(setCount.n).toBe(setsFixture.data.length);
    expect(cardCount.n).toBe(base1Fixture.data.length);
    expect(priceCount.n).toBeGreaterThan(0);

    const run = await db.query.syncRuns.findFirst({
      where: eq(schema.syncRuns.status, "completed"),
    });
    expect(run).toBeDefined();
    expect(run?.completedPages).toBe(run?.totalPages);
    expect(run?.malformedSkipped).toBe(0);

    // Idempotency: run a second full sync — same row counts, no duplicates.
    await enqueueJob(db, {
      type: "catalog_sets",
      payload: { kind: "catalog_full" },
      idempotencyKey: "test:catalog:2",
    });
    await drainJobs();

    const [setCount2] = await db.select({ n: count() }).from(schema.pokemonSets);
    const [cardCount2] = await db.select({ n: count() }).from(schema.pokemonCards);
    expect(setCount2.n).toBe(setCount.n);
    expect(cardCount2.n).toBe(cardCount.n);

    const charizard = await db.query.pokemonCards.findFirst({
      where: eq(schema.pokemonCards.id, "base1-4"),
    });
    expect(charizard?.slug).toBe("base1-4-charizard");
    expect(charizard?.active).toBe(true);

    const price = await db.query.cardPricesCurrent.findFirst({
      where: eq(schema.cardPricesCurrent.cardId, "base1-4"),
    });
    expect(price?.normalizedPriceMinor).toBeGreaterThan(0);
  });

  it("records daily price history for every card, once per day", async () => {
    const db = createDb(env.DB);

    // The full sync above already recorded a history point per card (per page,
    // no tracked gate). Run the standalone daily job twice more to prove
    // idempotency: the unique constraint caps at one row per
    // card/source/variant/currency/day, so nothing is duplicated.
    await enqueueJob(db, { type: "price_history_record", idempotencyKey: "test:history:1" });
    await drainJobs();
    await enqueueJob(db, { type: "price_history_record", idempotencyKey: "test:history:2" });
    await drainJobs();

    // Both a card someone might track (base1-4) and an untracked one (base1-5)
    // must have history now — every card's chart needs data.
    for (const cardId of ["base1-4", "base1-5"]) {
      const rows = await db
        .select()
        .from(schema.cardPriceHistory)
        .where(eq(schema.cardPriceHistory.cardId, cardId));
      expect(rows.length).toBeGreaterThan(0);
      const keys = new Set(
        rows.map((r) => `${r.source}:${r.variant}:${r.currency}:${r.recordedDate}`),
      );
      expect(keys.size).toBe(rows.length);
    }
  });

  it("retries failed jobs with backoff and dead-letters after max attempts", async () => {
    const db = createDb(env.DB);
    // No fetch mock for this URL pattern → handler throws; use an unknown type
    // handler instead to avoid network: enqueue a job type with no handler.
    await db.insert(schema.syncJobs).values({
      id: crypto.randomUUID(),
      type: "progress_cache_rebuild", // intentionally has no registered handler
      status: "pending",
      maxAttempts: 2,
    });

    await runJobBatch(env); // attempt 1 → retry scheduled (runAfter in future)
    let job = await db.query.syncJobs.findFirst({
      where: eq(schema.syncJobs.type, "progress_cache_rebuild"),
    });
    expect(job?.status).toBe("pending");
    expect(job?.attemptCount).toBe(1);
    expect(job?.runAfter && job.runAfter.getTime() > Date.now()).toBe(true);

    // Force due now, then final attempt dead-letters.
    await db
      .update(schema.syncJobs)
      .set({ runAfter: new Date(Date.now() - 1000) })
      .where(eq(schema.syncJobs.id, job?.id ?? ""));
    await runJobBatch(env);
    job = await db.query.syncJobs.findFirst({
      where: eq(schema.syncJobs.type, "progress_cache_rebuild"),
    });
    expect(job?.status).toBe("failed");
    expect(job?.errorMessage).toContain("No handler");
  });
});
