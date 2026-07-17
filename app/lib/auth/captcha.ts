/**
 * Whether the Turnstile gate is enforced. Requires a secret AND that captcha is
 * not explicitly disabled (CAPTCHA_DISABLED="true" is set only in local
 * development / E2E — never in staging or production).
 */
export function captchaEnabled(env: Env): boolean {
  return Boolean(env.TURNSTILE_SECRET_KEY) && env.CAPTCHA_DISABLED !== "true";
}
