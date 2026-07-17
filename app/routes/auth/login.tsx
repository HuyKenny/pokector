import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import type { Route } from "./+types/login";
import { PokectorWordmark } from "~/components/brand";
import { Turnstile } from "~/components/turnstile";
import { Alert, Button, Card, Input } from "~/components/ui";
import { authClient } from "~/lib/auth-client";
import { captchaEnabled } from "~/lib/auth/captcha";
import { getCloudflare } from "~/lib/context";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.t.signInMetaTitle ?? "Sign in — Pokector" },
    { name: "robots", content: "noindex" },
  ];
}

export function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  const locale = resolveLocale(params.locale);
  return {
    siteKey: env.TURNSTILE_SITE_KEY,
    captchaRequired: captchaEnabled(env),
    t: getDict(locale).auth,
  };
}

/** Only same-origin relative paths — prevents open redirects. */
function safeReturnTo(raw: string | null): string {
  if (raw && raw.startsWith("/") && !raw.startsWith("//")) return raw;
  return "/app";
}

export default function Login({ loaderData }: Route.ComponentProps) {
  const { siteKey, captchaRequired, t } = loaderData;
  const navigate = useNavigate();
  const lp = useLocalePath();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (captchaRequired && !captchaToken) {
      setError(t.verifyHuman);
      return;
    }
    setSubmitting(true);
    const { error: apiError } = await authClient.signIn.email(
      { email, password },
      {
        headers: captchaToken ? { "x-captcha-response": captchaToken } : undefined,
      },
    );
    setSubmitting(false);
    if (apiError) {
      setError(apiError.status === 429 ? t.tooManyAttempts : t.signInInvalid);
      setCaptchaToken(null);
      return;
    }
    await navigate(safeReturnTo(searchParams.get("returnTo")), { replace: true });
  }

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Link to={lp("/")} className="self-center">
        <PokectorWordmark className="h-9" />
      </Link>
      <Card>
        <h1 className="mb-4 text-xl font-bold text-fg">{t.signInHeading}</h1>
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
          <Input
            label={t.passwordLabel}
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {captchaRequired ? <Turnstile siteKey={siteKey} onToken={setCaptchaToken} /> : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? t.signingIn : t.signInButton}
          </Button>
        </form>
        <div className="mt-4 flex flex-col gap-1 text-sm text-fg-muted">
          <Link className="text-accent hover:underline" to={lp("/forgot-password")}>
            {t.forgotPassword}
          </Link>
          <span>
            {t.newToPokector}
            <Link className="text-accent hover:underline" to={lp("/register")}>
              {t.createAnAccount}
            </Link>
          </span>
        </div>
      </Card>
    </main>
  );
}
