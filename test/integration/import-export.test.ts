import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";

import { createDb, schema } from "~/lib/db/index.server";
import { validateImportRows } from "~/lib/csv/import";
import { handleImportApply, resolveRows, type ResolvedRow } from "~/lib/csv/import.server";
import { streamCollectionCsv } from "~/lib/csv/export.server";
import { parseCsv } from "~/lib/csv/parse";
import { eq } from "drizzle-orm";

const db = createDb(env.DB);
const USER = "ie-user";

describe("CSV import → apply → export round trip", () => {
  beforeAll(async () => {
    await db
      .insert(schema.user)
      .values({ id: USER, name: "IE", email: "ie@test.dev" })
      .onConflictDoNothing();
    await db
      .insert(schema.pokemonSets)
      .values({
        id: "ieset",
        slug: "ieset",
        name: "IE Set",
        nameNormalized: "ie set",
        series: "T",
        syncedAt: new Date(),
      })
      .onConflictDoNothing();
    for (const n of [1, 2]) {
      await db
        .insert(schema.pokemonCards)
        .values({
          id: `ieset-${n}`,
          slug: `ieset-${n}-x`,
          setId: "ieset",
          name: `IE Card ${n}`,
          nameNormalized: `ie card ${n}`,
          number: String(n),
          numberSort: n,
          searchText: `ie card ${n}`,
          syncedAt: new Date(),
        })
        .onConflictDoNothing();
    }
  });

  it("resolves by id and by set+number, rejecting unknown cards", async () => {
    const { rows } = validateImportRows(
      ["pokector_card_id", "set_id", "card_number", "quantity", "variant"],
      [
        ["ieset-1", "", "", "2", "holofoil"],
        ["", "ieset", "2", "1", "normal"],
        ["does-not-exist", "", "", "1", "normal"],
      ],
    );
    const { resolved, errors } = await resolveRows(db, rows);
    expect(resolved.map((r) => r.resolvedCardId).sort()).toEqual(["ieset-1", "ieset-2"]);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/Unknown card ID/);
  });

  it("applies an import job and merges quantities on re-import", async () => {
    const importJobId = crypto.randomUUID();
    await db.insert(schema.importJobs).values({
      id: importJobId,
      userId: USER,
      status: "pending",
      mode: "merge",
      totalRows: 1,
    });
    const rows: ResolvedRow[] = [
      {
        rowNumber: 2,
        cardId: "ieset-1",
        setId: null,
        cardNumber: null,
        cardName: null,
        quantity: 2,
        variant: "holofoil",
        condition: "Near Mint",
        language: "English",
        purchasePriceMinor: 500,
        purchaseCurrency: "USD",
        purchaseDate: null,
        notes: null,
        resolvedCardId: "ieset-1",
      },
    ];
    // Insert the sync job so addJobLog's job_id FK resolves.
    const syncJobId = crypto.randomUUID();
    await db.insert(schema.syncJobs).values({
      id: syncJobId,
      type: "import_apply",
      status: "running",
      payloadJson: JSON.stringify({ userId: USER, importJobId, mode: "merge", rows }),
    });
    const jobRow = (await db.query.syncJobs.findFirst({
      where: eq(schema.syncJobs.id, syncJobId),
    }))!;

    await handleImportApply(jobRow, env);
    let entries = await db
      .select()
      .from(schema.collectionEntries)
      .where(eq(schema.collectionEntries.userId, USER));
    expect(entries).toHaveLength(1);
    expect(entries[0].quantity).toBe(2);

    // Re-run merge → quantity accumulates, still one row.
    await handleImportApply(jobRow, env);
    entries = await db
      .select()
      .from(schema.collectionEntries)
      .where(eq(schema.collectionEntries.userId, USER));
    expect(entries).toHaveLength(1);
    expect(entries[0].quantity).toBe(4);

    const job = await db.query.importJobs.findFirst({
      where: eq(schema.importJobs.id, importJobId),
    });
    expect(job?.status).toBe("completed");
    expect(job?.payloadJson).toBeNull();
  });

  it("exports the user's collection as CSV, re-parseable and user-scoped", async () => {
    const res = streamCollectionCsv(db, USER, {});
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    const parsed = parseCsv(text, 1000);
    expect(parsed.header).toContain("pokector_card_id");
    expect(parsed.rows.length).toBeGreaterThan(0);
    // Only this user's card appears.
    expect(text).toContain("ieset-1");

    // A different user's export is empty (isolation).
    await db
      .insert(schema.user)
      .values({ id: "ie-other", name: "O", email: "o@test.dev" })
      .onConflictDoNothing();
    const other = await streamCollectionCsv(db, "ie-other", {}).text();
    expect(other.trim().split("\r\n")).toHaveLength(1); // header only
  });
});
