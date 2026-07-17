/**
 * Pre-hydration theme bootstrap. Inlined in root.tsx <head> and stamped with the
 * per-request CSP nonce (see workers/app.ts + headers.server.ts).
 */

export const THEME_STORAGE_KEY = "pokector-theme";

/* Dark is the default: no stored choice → dark. "light"/"dark" are explicit
   user choices; "system" follows the OS preference. */
export const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("pokector-theme");var d=t==="light"?false:t==="system"?window.matchMedia("(prefers-color-scheme: dark)").matches:true;if(d)document.documentElement.classList.add("dark")}catch(e){document.documentElement.classList.add("dark")}})();`;

export type Theme = "light" | "dark" | "system";
