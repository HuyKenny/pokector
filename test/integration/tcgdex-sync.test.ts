import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import setsFixture from "../fixtures/ptcg/sets.json";
import base1Fixture from "../fixtures/ptcg/cards-base1.json";
import { createDb, schema } from "~/lib/db/index.server";
import { enqueueJob, hasDueJobs } from "~/lib/jobs/queue.server";
import { runJobBatch } from "~/lib/jobs/scheduler.server";
import { __setPtcgFetchForTests } from "~/lib/ptcg/client.server";
import { __setTcgdexFetchForTests } from "~/lib/tcgdex/client.server";

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );

const urlOf = (input: RequestInfo | URL) =>
  new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

const ptcgFetch: typeof fetch = (input) => {
  const url = urlOf(input);
  if (url.pathname === "/v2/sets")
    return json({ data: setsFixture.data, totalCount: setsFixture.data.length });
  if (url.pathname === "/v2/cards") {
    const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
    const items = base1Fixture.data.slice((page - 1) * 50, page * 50);
    return json({ data: items, totalCount: base1Fixture.data.length });
  }
  return Promise.reject(new Error(`Unexpected PTCG request: ${url.href}`));
};

const requested: string[] = [];
let updated = "2026-10-23T19:57:35.249Z";

/** TCGdex knows Base Set (same id) with Charizard priced, Pikachu unpriced. */
const tcgdexFetch: typeof fetch = (input) => {
  const url = urlOf(input);
  requested.push(url.pathname);
  if (url.pathname === "/v2/en/sets") return json([{ id: "base1", name: "Base Set" }]);
  if (url.pathname === "/v2/en/sets/base1") {
    return json({
      id: "base1",
      name: "Base Set",
      cards: [
        { id: "base1-4", localId: "4", name: "Charizard" },
        { id: "base1-58", localId: "58", name: "Pikachu" },
      ],
    });
  }
  if (url.pathname === "/v2/en/cards/base1-4") {
    return json({
      id: "base1-4",
      pricing: { cardmarket: { updated, unit: "EUR", avg: 458.1, low: 100, trend: 284.84 } },
    });
  }
  if (url.pathname === "/v2/en/cards/base1-58") return json({ id: "base1-58", pricing: null });
  return Promise.resolve(new Response("Not Found", { status: 404 }));
};

async function drainJobs(maxIterations = 20): Promise<void> {
  const db = createDb(env.DB);
  for (let i = 0; i < maxIterations && (await hasDueJobs(db)); i++) await runJobBatch(env);
}

async function cardmarket(cardId: string, variant: "holofoil" | "normal") {
  return createDb(env.DB).query.cardPricesCurrent.findFirst({
    where: and(
      eq(schema.cardPricesCurrent.cardId, cardId),
      eq(schema.cardPricesCurrent.source, "cardmarket"),
      eq(schema.cardPricesCurrent.variant, variant),
    ),
  });
}

describe("TCGdex Cardmarket sync", () => {
  beforeAll(async () => {
    __setPtcgFetchForTests(ptcgFetch);
    __setTcgdexFetchForTests(tcgdexFetch);
    await enqueueJob(createDb(env.DB), {
      type: "catalog_sets",
      payload: { kind: "catalog_full" },
      idempotencyKey: "t:cat:1",
    });
    await drainJobs();
  });

  afterAll(() => {
    __setPtcgFetchForTests(null);
    __setTcgdexFetchForTests(null);
  });

  it("refreshes a card's EUR price from TCGdex and skips cards without one", async () => {
    expect((await cardmarket("base1-4", "holofoil"))?.normalizedPriceMinor).toBe(418460);

    await enqueueJob(createDb(env.DB), {
      type: "tcgdex_prices_batch",
      payload: { day: "2026-10-24", n: 0 },
      idempotencyKey: "t:tcgdex:1",
    });
    await drainJobs();

    expect(await cardmarket("base1-4", "holofoil")).toMatchObject({
      normalizedPriceMinor: 28484,
      trendMinor: 28484,
      lowMinor: 10000,
      averageSellMinor: 45810,
      sourceUpdatedAt: "2026-10-23",
    });
    // TCGdex has no Cardmarket block for Pikachu → the stored price is untouched.
    expect((await cardmarket("base1-58", "normal"))?.sourceUpdatedAt).toBe("2026-06-21");
  });

  it("does not ask for the same cards again the same day, and never goes back in time", async () => {
    requested.length = 0;
    updated = "2026-10-01T00:00:00.000Z";
    await enqueueJob(createDb(env.DB), {
      type: "tcgdex_prices_batch",
      payload: { day: "2026-10-24", n: 5 },
      idempotencyKey: "t:tcgdex:2",
    });
    await drainJobs();
    expect(requested.filter((p) => p.includes("/cards/"))).toEqual([]);
    expect((await cardmarket("base1-4", "holofoil"))?.sourceUpdatedAt).toBe("2026-10-23");
  });
});
