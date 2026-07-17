import { useState } from "react";
import { Link } from "react-router";

import type { Route } from "./+types/forgot-password";
import { PokectorWordmark } from "~/components/brand";
import { Turnstile } from "~/components/turnstile";
import { Alert, Button, Card, Input } from "~/components/ui";
import { authClient } from "~/lib/auth-client";
import { captchaEnabled } from "~/lib/auth/captcha";
import { getCloudflare } from "~/lib/context";
import { isEmailConfigured } from "~/lib/email/index.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Reset password — Pokector" }, { name: "robots", content: "noindex" }];
}

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  return {
    siteKey: env.TURNSTILE_SITE_KEY,
    captchaRequired: captchaEnabled(env),
    emailConfigured: isEmailConfigured(env),
    supportEmail: env.SUPPORT_EMAIL,
  };
}

export default function ForgotPassword({ loaderData }: Route.ComponentProps) {
  const { siteKey, captchaRequired, emailConfigured, supportEmail } = loaderData;
  const [email, setEmail] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (captchaRequired && !captchaToken) {
      setError("Please complete the human verification below.");
      return;
    }
    setSubmitting(true);
    const { error: apiError } = await authClient.requestPasswordReset(
      { email, redirectTo: "/reset-password" },
      { headers: captchaToken ? { "x-captcha-response": captchaToken } : undefined },
    );
    setSubmitting(false);
    if (apiError) {
      setError(
        apiError.status === 429
          ? "Too many attempts. Please wait a few minutes and try again."
          : "Could not process the request. Please try again.",
      );
      setCaptchaToken(null);
      return;
    }
    setSent(true);
  }

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Link to="/" className="self-center">
        <PokectorWordmark className="h-9" />
      </Link>
      <Card>
        <h1 className="mb-4 text-xl font-bold text-fg">Reset your password</h1>

        {!emailConfigured ? (
          <div className="flex flex-col gap-4">
            <Alert tone="warning">
              Automated password-reset e-mails are currently unavailable. Please contact support at{" "}
              <span className="font-medium">{supportEmail}</span> to regain access to your account.
            </Alert>
            <Link className="text-sm text-accent hover:underline" to="/login">
              Back to sign in
            </Link>
          </div>
        ) : sent ? (
          <div className="flex flex-col gap-4">
            <Alert tone="success">
              If an account exists for that e-mail address, a reset link is on its way. Check your
              inbox.
            </Alert>
            <Link className="text-sm text-accent hover:underline" to="/login">
              Back to sign in
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
                label="E-mail"
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {captchaRequired ? <Turnstile siteKey={siteKey} onToken={setCaptchaToken} /> : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? "Sending…" : "Send reset link"}
              </Button>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}
