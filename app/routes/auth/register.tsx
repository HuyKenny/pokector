import { useState } from "react";
import { Link, useNavigate } from "react-router";

import type { Route } from "./+types/register";
import { PokectorWordmark } from "~/components/brand";
import { Turnstile } from "~/components/turnstile";
import { Alert, Button, Card, Input } from "~/components/ui";
import { authClient } from "~/lib/auth-client";
import { captchaEnabled } from "~/lib/auth/captcha";
import { getCloudflare } from "~/lib/context";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Create account — Pokector" }, { name: "robots", content: "noindex" }];
}

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  return {
    siteKey: env.TURNSTILE_SITE_KEY,
    captchaRequired: captchaEnabled(env),
  };
}

export default function Register({ loaderData }: Route.ComponentProps) {
  const { siteKey, captchaRequired } = loaderData;
  const navigate = useNavigate();
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
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (captchaRequired && !captchaToken) {
      setError("Please complete the human verification below.");
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
        apiError.status === 429
          ? "Too many attempts. Please wait a minute and try again."
          : (apiError.message ?? "Registration failed. Please try again."),
      );
      setCaptchaToken(null);
      return;
    }
    await navigate("/app/onboarding", { replace: true });
  }

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Link to="/" className="self-center">
        <PokectorWordmark className="h-9" />
      </Link>
      <Card>
        <h1 className="mb-1 text-xl font-bold text-fg">Create your account</h1>
        <p className="mb-4 text-sm text-fg-muted">
          Track your collection, portfolio value, and set completion — free.
        </p>
        {error ? (
          <div className="mb-4">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : null}
        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <Input
            label="Display name"
            id="name"
            autoComplete="nickname"
            required
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            label="E-mail"
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label="Password"
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            hint="At least 8 characters."
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Input
            label="Confirm password"
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {captchaRequired ? <Turnstile siteKey={siteKey} onToken={setCaptchaToken} /> : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </form>
        <p className="mt-4 text-sm text-fg-muted">
          Already have an account?{" "}
          <Link className="text-accent hover:underline" to="/login">
            Sign in
          </Link>
        </p>
        <p className="mt-4 text-xs text-fg-faint">
          By creating an account you agree to the{" "}
          <Link to="/terms" className="underline">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </Card>
    </main>
  );
}
