/**
 * Pre-hydration theme bootstrap. Inlined in root.tsx <head>; its CSP sha256 hash is
 * allow-listed in app/lib/security/headers.server.ts. A unit test asserts the hash
 * stays in sync — if you edit THEME_SCRIPT, update THEME_SCRIPT_CSP_HASH.
 */

export const THEME_STORAGE_KEY = "pokector-theme";

export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("pokector-theme");var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})();`;

export const THEME_SCRIPT_CSP_HASH = "sha256-ksnkRuJ9XiIa2bQDu9YKmz4NynFUPNi72sSd5Z3kCzo=";

export type Theme = "light" | "dark" | "system";
