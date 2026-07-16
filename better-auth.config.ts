/**
 * Stub config used ONLY by `auth generate` (schema generation at build time,
 * where no D1 binding exists). Runtime config lives in app/lib/auth/.
 */
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";

export const auth = betterAuth({
  database: drizzleAdapter({}, { provider: "sqlite" }),
  emailAndPassword: { enabled: true },
  plugins: [admin({ defaultRole: "user", adminRoles: ["admin"] })],
});
