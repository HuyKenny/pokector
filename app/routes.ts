import { index, layout, prefix, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  // Public
  index("routes/home.tsx"),
  route("health", "routes/health.ts"),

  // Auth
  route("api/auth/*", "routes/api.auth.$.ts"),
  route("login", "routes/auth/login.tsx"),
  route("register", "routes/auth/register.tsx"),
  route("forgot-password", "routes/auth/forgot-password.tsx"),
  route("reset-password", "routes/auth/reset-password.tsx"),
  route("logout", "routes/auth/logout.ts"),

  // Authenticated application
  layout("routes/app/layout.tsx", [
    ...prefix("app", [
      index("routes/app/index.tsx"),
      route("onboarding", "routes/app/onboarding.tsx"),
      route("settings", "routes/app/settings.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
