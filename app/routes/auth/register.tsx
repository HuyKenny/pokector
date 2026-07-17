import { useState } from "react";
import { Link, useNavigate } from "react-router";

import type { Route } from "./+types/register";
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
    { title: loaderData?.t.registerMetaTitle ?? "Create account — Pokector" },
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

export default function Register({ loaderData }: Route.ComponentProps) {
  const { siteKey, captchaRequired, t } = loaderData;
  const navigate = useNavigate();
  const lp = useLocalePath();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t.passwordsNoMatch);
      return;
    }
    if (password.length < 8) {
      setError(t.passwordTooShort);
      return;
    }
    if (captchaRequired && !captchaToken) {
      setError(t.verifyHuman);
      return;
    }
    setSubmitting(true);
    const { error: apiError } = await authClient.signUp.email(
      { name, email, password },
      {
        headers: captchaToken ? { "x-captcha-response": captchaToken } : undefined,
      },
    );
    setSubmitting(false);
    if (apiError) {
      setError(
        apiError.status === 429 ? t.tooManyAttempts : (apiError.message ?? t.registerFailed),
      );
      setCaptchaToken(null);
      return;
    }
    await navigate("/app/onboarding", { replace: true });
  }

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Link to={lp("/")} className="self-center">
        <PokectorWordmark className="h-9" />
      </Link>
      <Card>
        <h1 className="mb-1 text-xl font-bold text-fg">{t.registerHeading}</h1>
        <p className="mb-4 text-sm text-fg-muted">{t.registerSubtitle}</p>
        {error ? (
          <div className="mb-4">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <Input
            label={t.displayNameLabel}
            id="name"
            autoComplete="nickname"
            required
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
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
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            hint={t.passwordHint8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Input
            label={t.confirmPasswordLabel}
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {captchaRequired ? <Turnstile siteKey={siteKey} onToken={setCaptchaToken} /> : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? t.creatingAccount : t.createAccountButton}
          </Button>
        </form>
        <p className="mt-4 text-sm text-fg-muted">
          {t.alreadyHaveAccount}
          <Link className="text-accent hover:underline" to={lp("/login")}>
            {t.signInHeading}
          </Link>
        </p>
        <p className="mt-4 text-xs text-fg-faint">
          {t.byCreatingPre}
          <Link to="/terms" className="underline">
            {t.termsOfService}
          </Link>
          {t.and}
          <Link to="/privacy" className="underline">
            {t.privacyPolicy}
          </Link>
          .
        </p>
      </Card>
    </main>
  );
}
