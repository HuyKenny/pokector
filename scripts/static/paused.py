#!/usr/bin/env python3
"""Static "app paused" pages for the frozen pokector.com (Cloudflare Free, 2026-11-23).

The logged-in app (accounts, collections, binders, Pro, compare) needs SSR + D1, which does not fit the Free plan's
10 ms CPU limit. Public catalogue pages are frozen as files; these paths get a plain page instead of a 404.

    paused.py <frozen dir>

Used by the nightly rebuild (scripts/static/static.py). The paths are always overwritten: the local `static`
build would render working forms there, which have no backend on the static site.
"""
import os
import sys

PATHS = ["login", "register", "forgot-password", "reset-password", "logout", "app", "app/collection", "app/binders",
         "app/pokedex", "app/market", "app/game", "cards/compare", "collection", "binders", "game", "market"]

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Pokector app is paused</title>
<style>
:root{color-scheme:light dark;--bg:#faf8f4;--fg:#1d1b18;--muted:#6b665e;--line:#e4ded3;--accent:#d6452b}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#f1ede6;--muted:#a49d92;--line:#2e2b27;--accent:#ff6a4d}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:34rem;margin:0 auto;padding:12vh 16px 4rem}
h1{font-size:1.6rem;line-height:1.25;margin:0 0 .75rem}
p{margin:0 0 1rem;color:var(--muted)}
nav{display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;margin-top:1.75rem;padding-top:1.25rem;border-top:1px solid var(--line)}
a{color:var(--accent);text-decoration:none;font-weight:600}a:hover{text-decoration:underline}
</style></head>
<body><main>
<h1>The Pokector app is paused</h1>
<p>Accounts, collections, binders and card comparison are switched off for now. Your data is kept safe and nothing was deleted.</p>
<p>Card prices, sets and Pokémon pages keep working as before.</p>
<nav><a href="/">Home</a><a href="/sets">All sets</a><a href="/price-movers">Price movers</a><a href="/riftbound">Riftbound</a></nav>
</main></body></html>
"""


def main(out):
    for p in PATHS:
        f = os.path.join(out, p + ".html")   # pokector has no trailing slash: /login -> login.html
        os.makedirs(os.path.dirname(f), exist_ok=True)
        open(f, "w", encoding="utf-8").write(PAGE)
    print("paused pages:", len(PATHS))


if __name__ == "__main__":
    main(sys.argv[1])
