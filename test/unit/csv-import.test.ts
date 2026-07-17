import { describe, expect, it } from "vitest";

import { parseCsv } from "~/lib/csv/parse";
import { validateImportRows } from "~/lib/csv/import";

describe("parseCsv", () => {
  it("parses header + rows with quoting and CRLF", () => {
    const csv = 'a,b,c\r\n1,"two, 2","he said ""hi"""\r\n3,4,5\r\n';
    const out = parseCsv(csv, 1000);
    expect(out.header).toEqual(["a", "b", "c"]);
    expect(out.rows).toEqual([
      ["1", "two, 2", 'he said "hi"'],
      ["3", "4", "5"],
    ]);
    expect(out.truncated).toBe(false);
  });

  it("enforces the row cap", () => {
    const csv = "h\n" + Array.from({ length: 10 }, (_, i) => String(i)).join("\n");
    const out = parseCsv(csv, 3);
    expect(out.rows.length).toBeLessThanOrEqual(3);
    expect(out.truncated).toBe(true);
  });
});

describe("validateImportRows", () => {
  it("requires an ID column or set_id + card_number", () => {
    const { errors } = validateImportRows(["card_name", "quantity"], [["Charizard", "1"]]);
    expect(errors[0].message).toMatch(/pokector_card_id/);
  });

  it("accepts valid rows by pokector_card_id", () => {
    const { rows, errors } = validateImportRows(
      ["pokector_card_id", "quantity", "variant", "condition", "purchase_price"],
      [["base1-4", "2", "holofoil", "Near Mint", "350.00"]],
    );
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({
      cardId: "base1-4",
      quantity: 2,
      variant: "holofoil",
      condition: "Near Mint",
      purchasePriceMinor: 35000,
    });
  });

  it("accepts rows by set_id + card_number and defaults optional fields", () => {
    const { rows, errors } = validateImportRows(["set_id", "card_number"], [["base1", "4"]]);
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({
      setId: "base1",
      cardNumber: "4",
      quantity: 1,
      variant: "normal",
      condition: "Near Mint",
      language: "English",
      purchasePriceMinor: null,
    });
  });

  it("reports row-level errors without dropping good rows", () => {
    const { rows, errors } = validateImportRows(
      ["pokector_card_id", "quantity", "variant"],
      [
        ["base1-4", "2", "holofoil"],
        ["base1-5", "-1", "holofoil"], // bad quantity
        ["base1-6", "1", "sparkle"], // bad variant
        ["base1-7", "1", "normal"],
      ],
    );
    expect(rows).toHaveLength(2);
    expect(errors).toHaveLength(2);
    expect(errors[0].rowNumber).toBe(3);
    expect(errors[1].rowNumber).toBe(4);
  });

  it("rejects malformed purchase dates", () => {
    const { errors } = validateImportRows(
      ["pokector_card_id", "purchase_date"],
      [["base1-4", "07/16/2026"]],
    );
    expect(errors[0].message).toMatch(/purchase_date/);
  });
});
