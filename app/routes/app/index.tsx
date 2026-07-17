import type { Route } from "./+types/index";
import { Card } from "~/components/ui";
import { requireUser } from "~/lib/auth/guards.server";

// Interim dashboard — the full portfolio dashboard lands in Phase 6.
export function meta(_args: Route.MetaArgs) {
  return [{ title: "Dashboard — Pokector" }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const session = await requireUser(context, request);
  return { name: session.user.name };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-fg">Welcome, {loaderData.name}</h1>
      <Card>
        <p className="text-fg-muted">
          Your portfolio dashboard is on its way. Collection tracking, market values, and charts
          will appear here.
        </p>
      </Card>
    </div>
  );
}
