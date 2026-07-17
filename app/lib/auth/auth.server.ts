/**
 * Better Auth per-request factory (D1 bindings exist only per invocation).
 * See docs/DECISIONS.md D6 for the verified integration specifics.
 */

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { admin, captcha } from "better-auth/plugins";

import { createDb, schema } from "../db/index.server";
import { getEmailProvider } from "../email/index.server";
import { log } from "../log.server";
import { captchaEnabled } from "./captcha";
import { authKvDelete, authKvGet, authKvSet } from "./kv-store.server";
import { hashPassword, verifyPassword } from "./scrypt.server";

export type Auth = ReturnType<typeof getAuth>;

export function getAuth(env: Env) {
  if (!env.BETTER_AUTH_SECRET) {
    throw new Error(
      "BETTER_AUTH_SECRET is not configured. Set it via `wrangler secret put BETTER_AUTH_SECRET` (see docs/SECRETS.md).",
    );
  }

  const db = createDb(env.DB);
  const emailProvider = getEmailProvider(env);
  const production = env.ENVIRONMENT === "production";

  return betterAuth({
    appName: env.APP_NAME,
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    // Production/staging trust only the canonical origin. Local development (any
    // port, and E2E servers) trust localhost so same-machine flows work.
    trustedOrigins:
      env.ENVIRONMENT === "development"
        ? [env.APP_URL, "http://localhost:*", "http://127.0.0.1:*"]
        : [env.APP_URL],

    database: drizzleAdapter(db, { provider: "sqlite", schema }),

    // Sessions, verification values and rate-limit counters live in D1 (not KV):
    // Better Auth writes on every auth request, and the Free-plan KV cap (1k
    // writes/day) once exhausted made an unhandled put() rejection 500 the whole
    // auth handler. D1-backed store fails open instead. See docs/DECISIONS.md D17.
    secondaryStorage: {
      get: (key) => authKvGet(db, `auth:${key}`),
      set: (key, value, ttl) => authKvSet(db, `auth:${key}`, value, ttl),
      delete: (key) => authKvDelete(db, `auth:${key}`),
    },

    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      // Native scrypt — Better Auth's pure-JS default exceeds Workers CPU limits.
      password: { hash: hashPassword, verify: verifyPassword },
      // Only require verification when we can actually send e-mails.
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        if (!emailProvider) {
          // Honest degraded mode: the reset form is disabled in the UI; if the
          // endpoint is still hit, log and do nothing — never pretend delivery.
          log.warn("auth.reset_email_unavailable", { environment: env.ENVIRONMENT });
          return;
        }
        const result = await emailProvider.send({
          to: user.email,
          subject: `Reset your ${env.APP_NAME} password`,
          text: `Hello,\n\nSomeone requested a password reset for your ${env.APP_NAME} account. If this was you, open the link below to choose a new password:\n\n${url}\n\nIf you didn't request this, you can safely ignore this e-mail.\n\n— ${env.APP_NAME}`,
        });
        if (!result.ok) log.error("auth.reset_email_failed", { environment: env.ENVIRONMENT });
      },
    },

    ...(emailProvider
      ? {
          emailVerification: {
            sendOnSignUp: true,
            autoSignInAfterVerification: true,
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: { email: string };
              url: string;
            }) => {
              const result = await emailProvider.send({
                to: user.email,
                subject: `Verify your ${env.APP_NAME} e-mail address`,
                text: `Welcome to ${env.APP_NAME}!\n\nPlease confirm your e-mail address by opening this link:\n\n${url}\n\n— ${env.APP_NAME}`,
              });
              if (!result.ok)
                log.error("auth.verification_email_failed", { environment: env.ENVIRONMENT });
            },
          },
        }
      : {}),

    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          socialProviders: {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          },
        }
      : {}),

    user: {
      deleteUser: {
        // Deletion requires the user's password (fresh re-auth) — SPEC §7.
        enabled: true,
      },
    },

    session: {
      // Destructive actions require a session younger than this (re-auth).
      freshAge: 60 * 10,
      cookieCache: { enabled: true, maxAge: 60 },
    },

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await db.insert(schema.userProfiles).values({ userId: user.id }).onConflictDoNothing();
          },
        },
      },
    },

    rateLimit: {
      enabled: true,
      storage: "secondary-storage",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
        "/send-verification-email": { window: 300, max: 3 },
        "/delete-user": { window: 300, max: 3 },
      },
    },

    plugins: [
      admin({ defaultRole: "user", adminRoles: ["admin"] }),
      ...(captchaEnabled(env)
        ? [
            captcha({
              provider: "cloudflare-turnstile",
              secretKey: env.TURNSTILE_SECRET_KEY!,
              endpoints: ["/sign-up/email", "/sign-in/email", "/request-password-reset"],
            }),
          ]
        : []),
    ],

    advanced: {
      cookiePrefix: "pokector",
      useSecureCookies: production || env.ENVIRONMENT === "staging",
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
    },
  });
}

/** Session + user (or null) for loaders/actions. */
export async function getSession(env: Env, request: Request) {
  const auth = getAuth(env);
  return auth.api.getSession({ headers: request.headers });
}
