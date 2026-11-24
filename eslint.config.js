import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "build/**",
      ".react-router/**",
      "node_modules/**",
      "worker-configuration.d.ts",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Security-relevant (docs/SECURITY.md): no floating promises, no unsafe casts.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-explicit-any": "error",
      // React Router idiom: loaders/actions throw Response (redirects, 404s).
      "@typescript-eslint/only-throw-error": [
        "error",
        { allow: [{ from: "lib", name: "Response" }] },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "no-console": "off",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        AbortSignal: "readonly",
        URL: "readonly",
        crypto: "readonly",
        performance: "readonly",
        // page.evaluate callbacks in smoke-live.mjs run in the browser:
        document: "readonly",
        window: "readonly",
      },
    },
  },
  {
    // public/static-site.js: plain browser script of the static build (no bundler, no imports)
    files: ["public/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        location: "readonly",
        fetch: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
  },
  prettier,
);
