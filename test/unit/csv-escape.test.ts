import { describe, expect, it } from "vitest";

import { escapeCsvCell, toCsvLine } from "~/lib/csv/escape";

describe("escapeCsvCell", () => {
  it("passes plain values through", () => {
    expect(escapeCsvCell("Charizard")).toBe("Charizard");
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("quotes cells containing commas, quotes, and newlines", () => {
    expect(escapeCsvCell("Base Set, 1999")).toBe('"Base Set, 1999"');
    expect(escapeCsvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralizes spreadsheet formula injection", () => {
    expect(escapeCsvCell("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    expect(escapeCsvCell("+123")).toBe("'+123");
    expect(escapeCsvCell("-cmd")).toBe("'-cmd");
    expect(escapeCsvCell("@import")).toBe("'@import");
    // Leading tab is neutralized with the quote prefix; a bare tab does not
    // require CSV field-quoting (only comma/quote/newline/CR do).
    expect(escapeCsvCell("\t=1+1")).toBe("'\t=1+1");
  });

  it("builds correct lines", () => {
    expect(toCsvLine(["a", "b,c", "=x"])).toBe('a,"b,c",\'=x');
  });
});
