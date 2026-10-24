import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDb, schema } from "~/lib/db/index.server";
import { enqueueJob, hasDueJobs } from "~/lib/jobs/queue.server";
import { runJobBatch } from "~/lib/jobs/scheduler.server";
import { RIFTBOUND_GAME_ID } from "~/lib/riftbound/tcgcsv";
import { __setTcgcsvFetchForTests } from "~/lib/tcgcsv/client.server";

const json = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } }),
  );

const urlOf = (input: RequestInfo | URL) =>
  new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);

const SET_ID = `radiance-${RIFTBOUND_GAME_ID}`;
const EXISTING_ID = `${RIFTBOUND_GAME_ID}-radiance-trifarian-captain-uncommon`;
const requested: string[] = [];

const price = (productId: number, subTypeName: string, marketPrice: number | null) => ({
  productId,
  subTypeName,
  lowPrice: 0.05,
  midPrice: 0.5,
  highPrice: 9,
  marketPrice,
  directLowPrice: null,
});

/** TCGCSV category 89: Radiance with one known card, one new card, one sealed. */
const tcgcsvFetch: typeof fetch = (input) => {
  const url = urlOf(input);
  requested.push(url.pathname);
  if (url.pathname === "/last-updated.txt")
    return Promise.resolve(new Response("2026-10-23T20:06:07+0000"));
  if (url.pathname === "/tcgplayer/89/groups") {
    return json({
      success: true,
      results: [
        {
          groupId: 24819,
          name: "Radiance",
          abbreviation: "RAD",
          publishedOn: "2026-10-23T00:00:00",
        },
      ],
    });
  }
  if (url.pathname === "/tcgplayer/89/24819/products") {
    return json({
      success: true,
      results: [
        {
          productId: 722921,
          name: "Trifarian Captain",
          extendedData: [
            { name: "Number", value: "129/167" },
            { name: "Rarity", value: "Uncommon" },
          ],
        },
        {
          productId: 722950,
          name: "Leona, Radiant Dawn",
          extendedData: [
            { name: "Number", value: "001/167" },
            { name: "Rarity", value: "Epic" },
          ],
        },
        { productId: 711362, name: "Radiance - Booster Pack", extendedData: [] },
      ],
    });
  }
  if (url.pathname === "/tcgplayer/89/24819/prices") {
    return json({
      success: true,
      results: [
        price(722921, "Normal", 0.12),
        price(722921, "Foil", 0.4),
        price(722950, "Foil", 12.5),
        price(711362, "Normal", 6.9),
      ],
    });
  }
  return Promise.resolve(new Response("Not Found", { status: 404 }));
};

async function drainJobs(maxIterations = 20): Promise<void> {
  const db = createDb(env.DB);
  for (let i = 0; i < maxIterations && (await hasDueJobs(db)); i++) await runJobBatch(env);
}

describe("Riftbound sync from TCGCSV", () => {
  beforeAll(async () => {
    __setTcgcsvFetchForTests(tcgcsvFetch);
    const db = createDb(env.DB);
    const syncedAt = new Date("2026-10-16T00:00:00Z");
    // A JustTCG-era set + card with an epoch-seconds price date.
    await db.insert(schema.riftboundSets).values({
      id: SET_ID,
      slug: "radiance",
      name: "Radiance",
      releaseDate: "2026-10-23",
      syncedAt,
    });
    await db.insert(schema.riftboundCards).values({
      id: EXISTING_ID,
      slug: "radiance-trifarian-captain-uncommon",
      setId: SET_ID,
      name: "Trifarian Captain",
      nameNormalized: "trifarian captain",
      number: "129/167",
      numberSort: 129,
      rarity: "Uncommon",
      tcgplayerId: "722921",
      searchText: "trifarian captain",
      syncedAt,
    });
    await db.insert(schema.riftboundPricesCurrent).values({
      cardId: EXISTING_ID,
      source: "tcgplayer",
      variant: "normal",
      currency: "USD",
      normalizedPriceMinor: 99,
      sourceUpdatedAt: "1792117123",
      observedAt: syncedAt,
    });
  });

  afterAll(() => __setTcgcsvFetchForTests(null));

  it("refreshes known cards by product id and adds new ones", async () => {
    const db = createDb(env.DB);
    await enqueueJob(db, { type: "riftbound_tcgcsv_sets", idempotencyKey: "t:rb:1" });
    await drainJobs();

    const prices = await db
      .select()
      .from(schema.riftboundPricesCurrent)
      .where(eq(schema.riftboundPricesCurrent.cardId, EXISTING_ID));
    expect(
      prices.map((p) => [p.variant, p.normalizedPriceMinor, p.sourceUpdatedAt]).sort(),
    ).toEqual([
      ["foil", 40, "2026-10-23"],
      ["normal", 12, "2026-10-23"],
    ]);

    const leona = await db.query.riftboundCards.findFirst({
      where: eq(schema.riftboundCards.tcgplayerId, "722950"),
    });
    expect(leona).toMatchObject({
      id: `${RIFTBOUND_GAME_ID}-radiance-leona-radiant-dawn-epic`,
      slug: "radiance-leona-radiant-dawn-epic",
      setId: SET_ID,
      number: "001/167",
      rarity: "Epic",
    });
    const sealed = await db.query.riftboundCards.findFirst({
      where: eq(schema.riftboundCards.tcgplayerId, "711362"),
    });
    expect(sealed).toMatchObject({ slug: "radiance-radiance-booster-pack", number: "N/A" });

    const history = await db
      .select()
      .from(schema.riftboundPriceHistory)
      .where(
        and(
          eq(schema.riftboundPriceHistory.cardId, leona!.id),
          eq(schema.riftboundPriceHistory.variant, "foil"),
        ),
      );
    expect(history.map((h) => h.priceMinor)).toEqual([1250]);

    const set = await db.query.riftboundSets.findFirst({
      where: eq(schema.riftboundSets.id, SET_ID),
    });
    expect(set?.code).toBe("RAD");
  });

  it("runs once per TCGCSV build", async () => {
    const db = createDb(env.DB);
    requested.length = 0;
    await enqueueJob(db, { type: "riftbound_tcgcsv_sets", idempotencyKey: "t:rb:2" });
    await drainJobs();
    expect(requested).toEqual(["/last-updated.txt"]);
    expect(await db.$count(schema.riftboundCards, eq(schema.riftboundCards.setId, SET_ID))).toBe(3);
  });
});
