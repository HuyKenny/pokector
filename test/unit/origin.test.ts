import { describe, expect, it } from "vitest";

import { isTrustedOrigin } from "~/lib/security/origin.server";

const APP_URL = "https://pokector.com";

function req(method: string, origin?: string): Request {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  return new Request("https://pokector.com/market", { method, headers });
}

describe("isTrustedOrigin", () => {
  it("allows safe methods regardless of Origin", () => {
    expect(isTrustedOrigin(req("GET", "https://evil.com"), APP_URL)).toBe(true);
    expect(isTrustedOrigin(req("HEAD"), APP_URL)).toBe(true);
    expect(isTrustedOrigin(req("OPTIONS"), APP_URL)).toBe(true);
  });

  it("allows same-origin state-changing requests", () => {
    expect(isTrustedOrigin(req("POST", "https://pokector.com"), APP_URL)).toBe(true);
  });

  it("rejects cross-origin state-changing requests", () => {
    expect(isTrustedOrigin(req("POST", "https://evil.com"), APP_URL)).toBe(false);
    expect(isTrustedOrigin(req("DELETE", "https://pokector.com.evil.com"), APP_URL)).toBe(false);
  });

  it("allows requests with no Origin (webhooks / non-browser clients)", () => {
    expect(isTrustedOrigin(req("POST"), APP_URL)).toBe(true);
  });

  it("rejects a malformed Origin header", () => {
    expect(isTrustedOrigin(req("POST", "not-a-url"), APP_URL)).toBe(false);
  });
});
