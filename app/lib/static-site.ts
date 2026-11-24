import { useRouteLoaderData } from "react-router";

/**
 * True on the frozen static site (the nightly `static` build, scripts/static/static.py): the page is served as a
 * plain file without the React client and without a server behind forms, so components render links instead of
 * POST forms and leave query-string handling to /static-site.js. Set by the root loader (`STATIC_RUNNER`).
 */
export function useStaticSite(): boolean {
  return Boolean(useRouteLoaderData<{ staticSite?: boolean }>("root")?.staticSite);
}
