import { describe, expect, it } from "vitest";

import { applySecurityHeaders, contentSecurityPolicy } from "~/lib/security/headers.server";

const secure = { secure: true, production: true, nonce: "n0nce" };

/**
 * CSP failures are silent: the browser blocks and the server logs nothing, so a
 * regression here shows up as "checkout does nothing" rather than as an error.
 */
describe("contentSecurityPolicy", () => {
  it("lets a checkout/portal redirect reach the payment hosts", () => {
    const csp = contentSecurityPolicy(secure);
    const formAction = csp.split("; ").find((d) => d.startsWith("form-action"));
    // Our Stripe custom domain is a separate origin — `'self'` never covers it.
    expect(formAction).toContain("https://pay.pokector.com");
    expect(formAction).toContain("https://checkout.stripe.com");
    expect(formAction).toContain("https://billing.stripe.com");
    expect(formAction).toContain("'self'");
  });

  it("keeps the hardening directives that do not depend on billing", () => {
    const csp = contentSecurityPolicy(secure);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Payment hosts must not leak into script-src: hosted checkout is a redirect,
    // never a script or an iframe we embed.
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"));
    expect(scriptSrc).not.toContain("pay.pokector.com");
    expect(scriptSrc).toContain("'nonce-n0nce'");
  });

  it("uses a nonce in secure envs and never 'unsafe-inline' for scripts", () => {
    expect(contentSecurityPolicy(secure)).not.toContain("script-src 'self' 'unsafe-inline'");
    // Dev is the documented exception (Vite injects unnonced HMR scripts).
    expect(contentSecurityPolicy({ ...secure, secure: false })).toContain("'unsafe-inline'");
  });
});

describe("applySecurityHeaders", () => {
  it("sets HSTS only in production", () => {
    const prod = applySecurityHeaders(new Response("ok"), secure);
    expect(prod.headers.get("strict-transport-security")).toContain("max-age=");
    const staging = applySecurityHeaders(new Response("ok"), { ...secure, production: false });
    expect(staging.headers.get("strict-transport-security")).toBeNull();
  });

  it("keeps the response status and body intact", async () => {
    const res = applySecurityHeaders(new Response("body", { status: 503 }), secure);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("body");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cross-origin-resource-policy")).toBe("same-origin");
  });
});
