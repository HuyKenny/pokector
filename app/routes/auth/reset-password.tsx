import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import type { Route } from "./+types/reset-password";
import { PokectorWordmark } from "~/components/brand";
import { Alert, Button, Card, Input } from "~/components/ui";
import { authClient } from "~/lib/auth-client";
import { getDict } from "~/lib/i18n/dictionaries.server";
import { resolveLocale } from "~/lib/i18n/locales";
import { useLocalePath } from "~/lib/i18n/react";

export function meta({ loaderData }: Route.MetaArgs) {
  return [
    { title: loaderData?.t.resetMetaTitle ?? "Choose a new password — Pokector" },
    { name: "robots", content: "noindex" },
  ];
}

export function loader({ params }: Route.LoaderArgs) {
  return { t: getDict(resolveLocale(params.locale)).auth };
}

export default function ResetPassword({ loaderData }: Route.ComponentProps) {
  const { t } = loaderData;
  const navigate = useNavigate();
  const lp = useLocalePath();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!token) return;
    if (password !== confirm) {
      setError(t.passwordsNoMatch);
      return;
    }
    setSubmitting(true);
    const { error: apiError } = await authClient.resetPassword({ newPassword: password, token });
    setSubmitting(false);
    if (apiError) {
      setError(t.resetInvalid);
      return;
    }
    await navigate(lp("/login"), { replace: true });
  }

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Link to={lp("/")} className="self-center">
        <PokectorWordmark className="h-9" />
      </Link>
      <Card>
        <h1 className="mb-4 text-xl font-bold text-fg">{t.resetHeading}</h1>
        {!token ? (
          <div className="flex flex-col gap-4">
            <Alert tone="error">{t.resetMissingToken}</Alert>
            <Link className="text-sm text-accent hover:underline" to={lp("/forgot-password")}>
              {t.requestNewLink}
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
                label={t.newPasswordLabel}
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                hint={t.newPasswordHint}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Input
                label={t.confirmNewPasswordLabel}
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <Button type="submit" disabled={submitting}>
                {submitting ? t.saving : t.setNewPassword}
              </Button>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}
