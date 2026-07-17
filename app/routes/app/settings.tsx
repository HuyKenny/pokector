import { eq } from "drizzle-orm";
import { useState } from "react";
import { Form, Link, useNavigate } from "react-router";
import { z } from "zod";

import type { Route } from "./+types/settings";
import { Alert, Button, Card, Input } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import { authClient } from "~/lib/auth-client";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";
import { isEmailConfigured } from "~/lib/email/index.server";
import { THEME_STORAGE_KEY } from "~/lib/theme";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Settings — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  const profile = await db.query.userProfiles.findFirst({
    where: eq(schema.userProfiles.userId, session.user.id),
    columns: { displayName: true, theme: true, defaultCurrency: true },
  });
  return {
    email: session.user.email,
    emailVerified: session.user.emailVerified,
    name: session.user.name,
    theme: profile?.theme ?? "system",
    emailConfigured: isEmailConfigured(env),
    supportEmail: env.SUPPORT_EMAIL,
  };
}

const ProfileSchema = z.object({
  intent: z.literal("profile"),
  name: z.string().trim().min(1, "Display name is required.").max(50),
  theme: z.enum(["light", "dark", "system"]),
});

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const formData = Object.fromEntries(await request.formData());
  const parsed = ProfileSchema.safeParse(formData);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const db = createDb(env.DB);
  await db
    .update(schema.user)
    .set({ name: parsed.data.name })
    .where(eq(schema.user.id, session.user.id));
  await db
    .update(schema.userProfiles)
    .set({ displayName: parsed.data.name, theme: parsed.data.theme })
    .where(eq(schema.userProfiles.userId, session.user.id));
  return { ok: true as const };
}

export default function Settings({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-bold text-fg">Settings</h1>
      <ProfileSection loaderData={loaderData} actionData={actionData} />
      <PasswordSection />
      <DataSection />
      <DangerSection emailConfigured={loaderData.emailConfigured} />
    </div>
  );
}

function ProfileSection({
  loaderData,
  actionData,
}: {
  loaderData: Route.ComponentProps["loaderData"];
  actionData: Route.ComponentProps["actionData"];
}) {
  const [theme, setTheme] = useState(loaderData.theme);

  function applyTheme(next: string) {
    setTheme(next as typeof theme);
    try {
      // "system" is stored explicitly — an absent key means the dark default.
      localStorage.setItem(THEME_STORAGE_KEY, next);
      const dark =
        next === "dark" ||
        (next === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", dark);
    } catch {
      // localStorage unavailable (private mode) — theme applies for this page only.
    }
  }

  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold text-fg">Profile</h2>
      <p className="mb-4 text-sm text-fg-muted">
        Signed in as <span className="font-medium">{loaderData.email}</span>
        {loaderData.emailVerified ? " (verified)" : ""}
      </p>
      {actionData?.ok === true ? (
        <div className="mb-4">
          <Alert tone="success">Profile saved.</Alert>
        </div>
      ) : null}
      {actionData?.ok === false ? (
        <div className="mb-4">
          <Alert tone="error">{actionData.error}</Alert>
        </div>
      ) : null}
      <Form method="post" className="flex flex-col gap-4">
        <input type="hidden" name="intent" value="profile" />
        <Input
          label="Display name"
          id="name"
          name="name"
          defaultValue={loaderData.name}
          required
          maxLength={50}
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium text-fg">Theme</legend>
          <div className="flex gap-2" role="radiogroup" aria-label="Theme">
            {(["light", "dark", "system"] as const).map((option) => (
              <label
                key={option}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm capitalize ${
                  theme === option ? "border-accent bg-accent-soft" : "border-edge"
                }`}
              >
                <input
                  type="radio"
                  name="theme"
                  value={option}
                  checked={theme === option}
                  onChange={() => applyTheme(option)}
                  className="sr-only"
                />
                {option}
              </label>
            ))}
          </div>
        </fieldset>
        <Button type="submit" className="self-start">
          Save profile
        </Button>
      </Form>
    </Card>
  );
}

function PasswordSection() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (next.length < 8) {
      setMessage({ tone: "error", text: "New password must be at least 8 characters." });
      return;
    }
    setSubmitting(true);
    const { error } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setSubmitting(false);
    if (error) {
      setMessage({ tone: "error", text: "Current password is incorrect." });
      return;
    }
    setCurrent("");
    setNext("");
    setMessage({
      tone: "success",
      text: "Password changed. Other sessions have been signed out.",
    });
  }

  return (
    <Card>
      <h2 className="mb-4 text-lg font-semibold text-fg">Change password</h2>
      {message ? (
        <div className="mb-4">
          <Alert tone={message.tone}>{message.text}</Alert>
        </div>
      ) : null}
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
        <Input
          label="Current password"
          id="current-password"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Input
          label="New password"
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Button type="submit" disabled={submitting} className="self-start">
          {submitting ? "Saving…" : "Change password"}
        </Button>
      </form>
    </Card>
  );
}

function DataSection() {
  return (
    <Card>
      <h2 className="mb-1 text-lg font-semibold text-fg">Your data</h2>
      <p className="mb-4 text-sm text-fg-muted">
        Export your collection or a full copy of your account data at any time.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          to="/app/export"
          className="min-h-11 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface-raised"
        >
          Export collection (CSV)
        </Link>
        <a
          href="/app/account-export"
          className="min-h-11 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface-raised"
        >
          Download all my data (JSON)
        </a>
        <Link
          to="/app/import"
          className="min-h-11 rounded-lg border border-edge bg-surface px-4 py-2 text-sm font-medium text-fg hover:bg-surface-raised"
        >
          Import a CSV
        </Link>
      </div>
    </Card>
  );
}

function DangerSection({ emailConfigured: _emailConfigured }: { emailConfigured: boolean }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleDelete(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (confirmText !== "DELETE") {
      setError('Type "DELETE" to confirm.');
      return;
    }
    setSubmitting(true);
    const { error: apiError } = await authClient.deleteUser({ password });
    setSubmitting(false);
    if (apiError) {
      setError("Deletion failed — please check your password.");
      return;
    }
    await navigate("/", { replace: true });
  }

  return (
    <Card className="border-negative/40">
      <h2 className="mb-1 text-lg font-semibold text-negative">Delete account</h2>
      <p className="mb-4 text-sm text-fg-muted">
        Permanently deletes your account, collection, binders, and wishlist. This cannot be undone.
        Export your collection first if you want to keep your data.
      </p>
      {error ? (
        <div className="mb-4">
          <Alert tone="error">{error}</Alert>
        </div>
      ) : null}
      <form onSubmit={(e) => void handleDelete(e)} className="flex flex-col gap-4">
        <Input
          label="Your password"
          id="delete-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Input
          label='Type "DELETE" to confirm'
          id="delete-confirm"
          required
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
        />
        <Button type="submit" variant="danger" disabled={submitting} className="self-start">
          {submitting ? "Deleting…" : "Delete my account"}
        </Button>
      </form>
    </Card>
  );
}
