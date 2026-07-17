import { useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/forgot-password";
import { PokectorWordmark } from "~/components/brand";
import { Turnstile } from "~/components/turnstile";
import { Alert, Button, Card, Input } from "~/components/ui";
import { authClient } from "~/lib/auth-client";
import { captchaEnabled } from "~/lib/auth/captcha";
import { getCloudflare } from "~/lib/context";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";
import { isEmailConfigured } from "~/lib/email/index.server";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.t.forgotMetaTitle ?? "Reset password — Pokector" },
    { name: "robots", content: "noindex" },
  ];
}

export function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const locale = resolveLocale(params.locale);
  return {
    siteKey: env.TURNSTILE_SITE_KEY,
    captchaRequired: captchaEnabled(env),
    emailConfigured: isEmailConfigured(env),
    supportEmail: env.SUPPORT_EMAIL,
    t: getDict(locale).auth,
  };
}

export default function ForgotPassword({ loaderData }: Route.ComponentProps) {
  const { siteKey, captchaRequired, emailConfigured, supportEmail, t } = loaderData;
  const lp = useLocalePath();
  const [email, setEmail] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (captchaRequired && !captchaToken) {
      setError(t.verifyHuman);
      return;
    }
    setSubmitting(true);
    const { error: apiError } = await authClient.requestPasswordReset(
      { email, redirectTo: "/reset-password" },
      { headers: captchaToken ? { "x-captcha-response": captchaToken } : undefined },
    );
    setSubmitting(false);
    if (apiError) {
      setError(apiError.status === 429 ? t.forgotTooMany : t.forgotError);
      setCaptchaToken(null);
      return;
    }
    setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Link to={lp("/")} className="self-center">
        <PokectorWordmark className="h-9" />
      </Link>
      <Card>
        <h1 className="mb-4 text-xl font-bold text-fg">{t.forgotHeading}</h1>

        {!emailConfigured ? (
          <div className="flex flex-col gap-4">
            <Alert tone="warning">
              {t.emailUnavailablePre}
              <span className="font-medium">{supportEmail}</span>
              {t.emailUnavailablePost}
            </Alert>
            <Link className="text-sm text-accent hover:underline" to={lp("/login")}>
              {t.backToSignIn}
            </Link>
          </div>
        ) : sent ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success">{t.resetSent}</Alert>
            <Link className="text-sm text-accent hover:underline" to={lp("/login")}>
              {t.backToSignIn}
            </Link>
          </div>
        ) : (
          <>
            {error ? (
              <div className="mb-4">
                <Alert tone="error">{error}</Alert>
              </div>
            ) : null}
            <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
              <Input
                label={t.emailLabel}
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {captchaRequired ? <Turnstile siteKey={siteKey} onToken={setCaptchaToken} /> : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? t.sending : t.sendResetLink}
              </Button>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}
