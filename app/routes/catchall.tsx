import { Link } from "react-router";

import type { Route } from "./+types/catchall";

/** 404 for unmatched paths (SPEC §23). Intentionally removed content can throw
 * 410 from its own route; unknown URLs are honest 404s. */
export function loader() {
  throw new Response("Not Found", { status: 404 });
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Page not found | Pokector" }, { name: "robots", content: "noindex" }];
}

export default function CatchAll() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-3xl font-bold text-fg">Page not found</h1>
      <p className="text-fg-muted">
        The page you are looking for does not exist or may have moved.
      </p>
      <Link
        to="/"
        className="rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-strong"
      >
        Back to homepage
      </Link>
    </main>
  );
}
