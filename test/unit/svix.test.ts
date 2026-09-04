import { describe, expect, it } from "vitest";

import { signSvix, verifySvix, svixHeaders } from "~/lib/billing/svix";

/**
 * The webhook signature is the only thing standing between a stranger and the
 * ability to grant themselves a paid plan, so every rejection path is asserted —
 * not just the happy one.
 */

const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const BODY = JSON.stringify({
  type: "billing.updated",
  id: "evt_test",
  occurred_at: 1787900000000,
  data: { customer_id: "org_test" },
});
const ID = "msg_2abc";
const NOW = 1787900000000;
const TIMESTAMP = String(Math.floor(NOW / 1000));

async function headersFor(overrides: Partial<Record<string, string>> = {}) {
  const signature = await signSvix(SECRET, ID, TIMESTAMP, BODY);
  return {
    id: overrides.id ?? ID,
    timestamp: overrides.timestamp ?? TIMESTAMP,
    signature: overrides.signature ?? `v1,${signature}`,
  };
}

describe("verifySvix", () => {
  it("accepts a correctly signed payload", async () => {
    const result = await verifySvix({
      secret: SECRET,
      headers: await headersFor(),
      body: BODY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a secret given without the whsec_ prefix", async () => {
    const bare = SECRET.slice("whsec_".length);
    const signature = await signSvix(bare, ID, TIMESTAMP, BODY);
    const result = await verifySvix({
      secret: SECRET,
      headers: { id: ID, timestamp: TIMESTAMP, signature: `v1,${signature}` },
      body: BODY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("accepts when one of several signatures matches, as during rotation", async () => {
    const good = await signSvix(SECRET, ID, TIMESTAMP, BODY);
    const result = await verifySvix({
      secret: SECRET,
      headers: { id: ID, timestamp: TIMESTAMP, signature: `v1,ZmFrZQ== v1,${good}` },
      body: BODY,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const result = await verifySvix({
      secret: SECRET,
      headers: await headersFor(),
      body: BODY.replace("org_test", "org_attacker"),
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a signature computed for a different message id", async () => {
    // The id is part of the signed content, so replaying a valid signature under
    // a new id must fail.
    const result = await verifySvix({
      secret: SECRET,
      headers: await headersFor({ id: "msg_other" }),
      body: BODY,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects the wrong secret", async () => {
    const signature = await signSvix("whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", ID, TIMESTAMP, BODY);
    const result = await verifySvix({
      secret: SECRET,
      headers: { id: ID, timestamp: TIMESTAMP, signature: `v1,${signature}` },
      body: BODY,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("rejects a stale timestamp, bounding replay", async () => {
    const result = await verifySvix({
      secret: SECRET,
      headers: await headersFor(),
      body: BODY,
      now: NOW + 6 * 60 * 1000,
    });
    expect(result).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("rejects a timestamp too far in the future", async () => {
    const result = await verifySvix({
      secret: SECRET,
      headers: await headersFor(),
      body: BODY,
      now: NOW - 6 * 60 * 1000,
    });
    expect(result).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("rejects a non-numeric timestamp", async () => {
    const result = await verifySvix({
      secret: SECRET,
      headers: await headersFor({ timestamp: "yesterday" }),
      body: BODY,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "timestamp_out_of_tolerance" });
  });

  it("rejects missing headers rather than treating them as absent-and-fine", async () => {
    for (const missing of ["id", "timestamp", "signature"] as const) {
      const headers = await headersFor();
      const result = await verifySvix({
        secret: SECRET,
        headers: { ...headers, [missing]: null },
        body: BODY,
        now: NOW,
      });
      expect(result, missing).toEqual({ ok: false, reason: "missing_headers" });
    }
  });

  it("rejects a signature list with no v1 entry", async () => {
    const result = await verifySvix({
      secret: SECRET,
      headers: await headersFor({ signature: "v2,abc v3,def" }),
      body: BODY,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "no_v1_signature" });
  });

  it("reads the headers Svix actually sends", () => {
    const headers = new Headers({
      "svix-id": "msg_1",
      "svix-timestamp": "1787900000",
      "svix-signature": "v1,abc",
    });
    expect(svixHeaders(headers)).toEqual({
      id: "msg_1",
      timestamp: "1787900000",
      signature: "v1,abc",
    });
  });
});
