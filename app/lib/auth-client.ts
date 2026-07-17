import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * Same-origin Better Auth client (handler mounted at /api/auth). Captcha-protected
 * endpoints must pass the Turnstile token via fetchOptions.headers
 * ("x-captcha-response") — see the auth route components.
 */
export const authClient = createAuthClient({
  plugins: [adminClient()],
});

export type AuthClient = typeof authClient;
