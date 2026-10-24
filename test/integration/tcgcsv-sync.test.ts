import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import setsFixture from "../fixtures/ptcg/sets.json";
import base1Fixture from "../fixtures/ptcg/cards-base1.json";
import { createDb, schema } from "~/lib/db/index.server";
import { enqueueJob, hasDueJobs, nextJobDueAt } from "~/lib/jobs/queue.server";
import { runJobBatch } from "~/lib/jobs/scheduler.server";
import { __setPtcgFetchForTests } from "~/lib/ptcg/client.server";
import { __setTcgcsvFetchForTests } from "~/lib/tcgcsv/client.server";

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );

const urlOf = (input: RequestInfo | URL) =>
  new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

/** PTCG fixtures: base1 with its 2026-07-16 prices (Charizard holo $773.51). */
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

let buildDate = "2026-10-23";
const requested: string[] = [];

/** TCGCSV: group 604 = Base Set (override for base1). */
const tcgcsvFetch: typeof fetch = (input) => {
  const url = urlOf(input);
  requested.push(url.pathname);
  if (url.pathname === "/last-updated.txt")
    return Promise.resolve(new Response(`${buildDate}T20:06:07+0000`));
  if (url.pathname === "/tcgplayer/3/groups") {
    return json({
      success: true,
      results: [{ groupId: 604, name: "Base Set", abbreviation: "BS" }],
    });
  }
  if (url.pathname === "/tcgplayer/3/604/products") {
    return json({
      success: true,
      results: [
        { productId: 42382, name: "Charizard", extendedData: [{ name: "Number", value: "4/102" }] },
        {
          productId: 42383,
          name: "Charizard (Black Dot Error)",
          extendedData: [{ name: "Number", value: "4/102" }],
        },
        { productId: 42400, name: "Pikachu", extendedData: [{ name: "Number", value: "58/102" }] },
        { productId: 99999, name: "Base Set Booster Box", extendedData: [] },
      ],
    });
  }
  if (url.pathname === "/tcgplayer/3/604/prices") {
    return json({
      success: true,
      results: [
        {
          productId: 42382,
          subTypeName: "Holofoil",
          lowPrice: 600,
          midPrice: 900,
          highPrice: 2000,
          marketPrice: 954.65,
          directLowPrice: null,
        },
        {
          productId: 42383,
          subTypeName: "Holofoil",
          lowPrice: 1,
          midPrice: 1,
          highPrice: 1,
          marketPrice: 1,
          directLowPrice: null,
        },
        {
          productId: 42400,
          subTypeName: "Normal",
          lowPrice: 2,
          midPrice: 5,
          highPrice: 50,
          marketPrice: 7.71,
          directLowPrice: null,
        },
      ],
    });
  }
  return Promise.resolve(new Response("Not Found", { status: 404 }));
};

async function drainJobs(maxIterations = 30): Promise<void> {
  const db = createDb(env.DB);
  for (let i = 0; i < maxIterations && (await hasDueJobs(db)); i++) await runJobBatch(env);
}

async function tcgplayerPrice(cardId: string, variant: "holofoil" | "normal") {
  const db = createDb(env.DB);
  return db.query.cardPricesCurrent.findFirst({
    where: and(
      eq(schema.cardPricesCurrent.cardId, cardId),
      eq(schema.cardPricesCurrent.source, "tcgplayer"),
      eq(schema.cardPricesCurrent.variant, variant),
    ),
  });
}

describe("TCGCSV price sync", () => {
  beforeAll(async () => {
    __setPtcgFetchForTests(ptcgFetch);
    __setTcgcsvFetchForTests(tcgcsvFetch);
    const db = createDb(env.DB);
    await enqueueJob(db, {
      type: "catalog_sets",
      payload: { kind: "catalog_full" },
      idempotencyKey: "t:cat:1",
    });
    await drainJobs();
  });

  afterAll(() => {
    __setPtcgFetchForTests(null);
    __setTcgcsvFetchForTests(null);
  });

  it("refreshes matched cards with the TCGCSV build's prices and records history", async () => {
    expect((await tcgplayerPrice("base1-4", "holofoil"))?.normalizedPriceMinor).toBe(77351);

    const db = createDb(env.DB);
    await enqueueJob(db, { type: "tcgcsv_prices_sets", idempotencyKey: "t:tcgcsv:1" });
    await drainJobs();

    // The plain Charizard wins over the Black Dot Error print with the same number.
    const charizard = await tcgplayerPrice("base1-4", "holofoil");
    expect(charizard).toMatchObject({
      normalizedPriceMinor: 95465,
      lowMinor: 60000,
      sourceUpdatedAt: "2026-10-23",
    });
    expect(await tcgplayerPrice("base1-58", "normal")).toMatchObject({
      lowMinor: 200,
      sourceUpdatedAt: "2026-10-23",
    });

    const history = await db
      .select()
      .from(schema.cardPriceHistory)
      .where(
        and(
          eq(schema.cardPriceHistory.cardId, "base1-4"),
          eq(schema.cardPriceHistory.priceMinor, 95465),
        ),
      );
    expect(history).toHaveLength(1);
  });

  it("does not let the older PTCG prices overwrite a newer row", async () => {
    const db = createDb(env.DB);
    await enqueueJob(db, {
      type: "catalog_sets",
      payload: { kind: "catalog_full" },
      idempotencyKey: "t:cat:2",
    });
    await drainJobs();
    expect((await tcgplayerPrice("base1-4", "holofoil"))?.normalizedPriceMinor).toBe(95465);
  });

  it("runs once per build and reuses the cached product map", async () => {
    const db = createDb(env.DB);
    requested.length = 0;
    await enqueueJob(db, { type: "tcgcsv_prices_sets", idempotencyKey: "t:tcgcsv:2" });
    await drainJobs();
    expect(requested).toEqual(["/last-updated.txt"]); // same build → nothing else fetched

    buildDate = "2026-10-24";
    requested.length = 0;
    await enqueueJob(db, { type: "tcgcsv_prices_sets", idempotencyKey: "t:tcgcsv:3" });
    await drainJobs();
    expect(requested).toEqual([
      "/last-updated.txt",
      "/tcgplayer/3/groups",
      "/tcgplayer/3/604/prices",
    ]);
    // Same values a day later → rows are not rewritten (date stays within 3 days).
    expect((await tcgplayerPrice("base1-4", "holofoil"))?.sourceUpdatedAt).toBe("2026-10-23");
  });
});

describe("delayed wake-ups (production has only the daily cron)", () => {
  it("reports when the next not-yet-due job becomes runnable", async () => {
    const db = createDb(env.DB);
    await drainJobs();
    const later = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const soon = new Date(Date.now() + 30 * 60 * 1000);
    await enqueueJob(db, {
      type: "price_history_record",
      idempotencyKey: "t:later",
      runAfter: later,
    });
    await enqueueJob(db, { type: "retention_aggregate", idempotencyKey: "t:soon", runAfter: soon });
    expect(await hasDueJobs(db)).toBe(false);
    expect((await nextJobDueAt(db))?.getTime()).toBe(soon.getTime());
  });
});
