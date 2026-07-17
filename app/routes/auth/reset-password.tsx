import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import type { Route } from "./+types/reset-password";
import { PokectorWordmark } from "~/components/brand";
import { Alert, Button, Card, Input } from "~/components/ui";
import { authClient } from "~/lib/auth-client";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Choose a new password — Pokector" }, { name: "robots", content: "noindex" }];
}

export default function ResetPassword() {
  const navigate = useNavigate();
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
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    const { error: apiError } = await authClient.resetPassword({ newPassword: password, token });
    setSubmitting(false);
    if (apiError) {
      setError("This reset link is invalid or has expired. Please request a new one.");
      return;
    }
    await navigate("/login", { replace: true });
  }

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <Link to="/" className="self-center">
        <PokectorWordmark className="h-9" />
      </Link>
      <Card>
        <h1 className="mb-4 text-xl font-bold text-fg">Choose a new password</h1>
        {!token ? (
          <div className="flex flex-col gap-4">
            <Alert tone="error">
              This reset link is missing its token. Please use the link from your e-mail, or request
              a new one.
            </Alert>
            <Link className="text-sm text-accent hover:underline" to="/forgot-password">
              Request a new link
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
                label="New password"
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                hint="At least 8 characters. All other sessions will be signed out."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Input
                label="Confirm new password"
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Set new password"}
              </Button>
            </form>
          </>
        )}
      </Card>
    </main>
  );
}
