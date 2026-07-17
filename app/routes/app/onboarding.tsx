import { eq } from "drizzle-orm";
import { Form, redirect } from "react-router";

import type { Route } from "./+types/onboarding";
import { Button, Card } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";
import { getCloudflare } from "~/lib/context";
import { createDb, schema } from "~/lib/db/index.server";

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Welcome — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  return { name: session.user.name };
}

export async function action({ request, context }: Route.ActionArgs) {
  const session = await requireUser(context, request);
  const { env } = getCloudflare(context);
  const db = createDb(env.DB);
  await db
    .update(schema.userProfiles)
    .set({ onboardingCompleted: true })
    .where(eq(schema.userProfiles.userId, session.user.id));
  return redirect("/app");
}

const STEPS = [
  {
    title: "Browse the catalog",
    body: "Search cards and sets. Every card page shows current estimated market prices and available variants.",
  },
  {
    title: "Add cards to your collection",
    body: "Record quantity, variant, condition, language, and optionally what you paid — that unlocks profit/loss tracking.",
  },
  {
    title: "Watch your portfolio",
    body: "Your dashboard shows estimated market value, cost basis, and changes over time. History starts the day you begin tracking — nothing is backfilled.",
  },
  {
    title: "Organize and complete",
    body: "Sort cards into 9-pocket binders, follow set completion checklists, and keep a wishlist with price alerts.",
  },
];

export default function Onboarding({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-bold text-fg">Welcome to Pokector, {loaderData.name}!</h1>
      <p className="text-fg-muted">Here is how to get the most out of your collection tracker:</p>
      <ol className="flex flex-col gap-4">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <Card className="flex gap-4">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent-strong"
              >
                {i + 1}
              </span>
              <div>
                <h2 className="font-semibold text-fg">{step.title}</h2>
                <p className="text-sm text-fg-muted">{step.body}</p>
              </div>
            </Card>
          </li>
        ))}
      </ol>
      <p className="text-xs text-fg-faint">
        Displayed market values are estimated raw-card prices and may not reflect your exact card
        condition. Pokector is not affiliated with Nintendo, The Pokémon Company, TCGplayer, or
        Cardmarket.
      </p>
      <Form method="post">
        <Button type="submit">Take me to my dashboard</Button>
      </Form>
    </div>
  );
}
