import { env } from "cloudflare:test";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { getAuth } from "~/lib/auth/auth.server";
import { createDb, schema } from "~/lib/db/index.server";

describe("Better Auth on D1 + KV", () => {
  it("signs up, creates a profile, and resolves the session", async () => {
    const auth = getAuth(env);
    const email = `it-${crypto.randomUUID()}@example.com`;

    const response = await auth.api.signUpEmail({
      body: { name: "Integration Tester", email, password: "s3cure-pass-word" },
      asResponse: true,
    });
    expect(response.status).toBeLessThan(300);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("pokector.session_token");

    // Session resolves from the cookie.
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: setCookie ?? "" }),
    });
    expect(session?.user.email).toBe(email);
    expect(session?.user.role).toBe("user");

    // databaseHooks.user.create.after created the app profile row.
    const db = createDb(env.DB);
    const profile = await db.query.userProfiles.findFirst({
      where: eq(schema.userProfiles.userId, session?.user.id ?? ""),
    });
    expect(profile).toBeDefined();
    expect(profile?.onboardingCompleted).toBe(false);
  });

  it("rejects a wrong password on sign-in", async () => {
    const auth = getAuth(env);
    const email = `it-${crypto.randomUUID()}@example.com`;
    await auth.api.signUpEmail({
      body: { name: "T", email, password: "right-password-1" },
      asResponse: true,
    });

    const response = await auth.api
      .signInEmail({
        body: { email, password: "wrong-password-1" },
        asResponse: true,
      })
      .catch((e: unknown) => e);
    if (response instanceof Response) {
      expect(response.status).toBeGreaterThanOrEqual(400);
    } else {
      // Better Auth throws APIError for invalid credentials in server calls.
      expect(response).toBeInstanceOf(Error);
    }
  });

  it("never resolves a session from a forged cookie", async () => {
    const auth = getAuth(env);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: "pokector.session_token=forged-token-value" }),
    });
    expect(session).toBeNull();
  });
});
