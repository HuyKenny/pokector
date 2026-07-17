/**
 * Pre-hydration theme bootstrap. Inlined in root.tsx <head> and stamped with the
 * per-request CSP nonce (see workers/app.ts + headers.server.ts).
 */

export const THEME_STORAGE_KEY = "pokector-theme";

/* Light is the default (clean look, owner decision 2026-07-17): no stored
   choice → light. "dark" is an explicit user choice; "system" follows the OS
   preference. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("pokector-theme");var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(d)document.documentElement.classList.add("dark")}catch(e){}})();`;

export type Theme = "light" | "dark" | "system";
