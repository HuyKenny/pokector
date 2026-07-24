import { describe, expect, it } from "vitest";

import { safeRelativePath } from "~/lib/security/redirect";

describe("safeRelativePath", () => {
  it("accepts genuine same-site paths", () => {
    expect(safeRelativePath("/app/collection")).toBe("/app/collection");
    expect(safeRelativePath("/riftbound")).toBe("/riftbound");
    expect(safeRelativePath("/cards?page=2&q=char")).toBe("/cards?page=2&q=char");
    expect(safeRelativePath("/de/sets/base-set")).toBe("/de/sets/base-set");
  });

  it("rejects protocol-relative and absolute URLs", () => {
    expect(safeRelativePath("//evil.com")).toBe("/");
    expect(safeRelativePath("https://evil.com")).toBe("/");
    expect(safeRelativePath("http://evil.com")).toBe("/");
  });

  it("rejects the backslash bypass (browser normalizes \\ to /)", () => {
    expect(safeRelativePath("/\\evil.com")).toBe("/");
    expect(safeRelativePath("/\\/evil.com")).toBe("/");
  });

  it("rejects embedded control chars browsers strip", () => {
    expect(safeRelativePath("/\t/evil.com")).toBe("/");
    expect(safeRelativePath("/\n//evil.com")).toBe("/");
    expect(safeRelativePath("/\r/evil.com")).toBe("/");
  });

  it("rejects empty/relative/null and uses the fallback", () => {
    expect(safeRelativePath("")).toBe("/");
    expect(safeRelativePath(null)).toBe("/");
    expect(safeRelativePath(undefined)).toBe("/");
    expect(safeRelativePath("app/collection")).toBe("/");
    expect(safeRelativePath("evil.com")).toBe("/");
    expect(safeRelativePath(null, "/app")).toBe("/app");
    expect(safeRelativePath("//evil.com", "/app")).toBe("/app");
  });
});
