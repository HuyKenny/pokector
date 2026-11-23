#!/usr/bin/env python3
"""Smoke test of the deployed static pokector.com (after scripts/static/static.py deploys).

    smoke.py [https://pokector.com] [--changed .static-work/changed.json]

Checks the home page, robots + sitemaps, listing pages, a localized page, the zone redirect of localized detail
pages, paused-app pages, the 404 page, www (301 or apex canonical), a sample of sitemap card pages, every same-origin asset of two
pages, and (with --changed) that a card whose price changed in this run shows the new price.
The zone WAF challenges datacenter IPs (GitHub runners): a 403 with `cf-mitigated: challenge` is "not checked",
not a failure. Exits 1 on any failure.
"""
import html
import json
import random
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

args = [a for a in sys.argv[1:] if not a.startswith("--")]
BASE = (args[0] if args else "https://pokector.com").rstrip("/")
CHANGED = Path(sys.argv[sys.argv.index("--changed") + 1]) if "--changed" in sys.argv else None
UA = "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0 pokector-smoke/1.0"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OP = urllib.request.build_opener(NoRedirect)
fails, waf, done = [], [], 0


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with OP.open(req, timeout=30) as r:
            return r.status, r.headers, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read() if e.fp else b""
    except Exception as e:  # network error
        return 0, {}, str(e).encode()


def check(path, want, test=None, label="", base=BASE):
    global done
    url = path if path.startswith("http") else base + path
    st, h, body = get(url)
    if st == 403 and (h.get("cf-mitigated") or "").lower() == "challenge":
        print(f"WAF {st} {url} (challenge from this IP, not checked)")
        waf.append(url)
        return None
    ok = st == want and (test is None or bool(test(h, body)))
    done += 1
    print(f"{'ok ' if ok else 'BAD'} {st} {url} {label}")
    if not ok:
        fails.append(url)
    return body if ok else None


def has(*needles):
    return lambda h, b: all(n.encode() in b for n in needles)


def loc(target):
    return lambda h, b: (h.get("Location") or "").rstrip("/") == target.rstrip("/")


home = check("/", 200, has("Pokector", "</html>"))
# behind the WAF challenge (runner IPs) Cloudflare answers robots.txt with its managed AI-bot block only
check("/robots.txt", 200, None if home is None and waf else has("Sitemap:"))
check("/sitemap.xml", 200, has("<sitemapindex"))
cards_map = check("/sitemap-cards/1", 200, has("<loc>"), "card sitemap")
check("/sitemap-static.xml", 200, has("<loc>"))
for p in ("/cards", "/sets", "/price-movers", "/pokedex", "/riftbound", "/riftbound/cards", "/de", "/de/sets",
          "/most-valuable-pokemon-cards", "/blog"):
    check(p, 200, has("</html>"))
check("/de/cards/base1-4-charizard", 301, loc(BASE + "/cards/base1-4-charizard"), "localized detail -> English")
check("/login", 200, has("app is paused"), "paused app")
check("/app/collection", 200, has("app is paused"), "paused app")
check("/zz-not-a-page-404", 404, None, "404 page")
# www: 301 to the apex once the zone has the www redirect rule; until then 200 with the apex canonical
st_www = get(BASE.replace("://", "://www.") + "/sets")[0]
if st_www == 301:
    check(BASE.replace("://", "://www.") + "/sets", 301, loc(BASE + "/sets"), "www -> apex")
else:
    check(BASE.replace("://", "://www.") + "/sets", 200, has(f'<link rel="canonical" href="{BASE}/sets"'), "www (canonical apex)")

card_page = None
if cards_map:
    urls = re.findall(r"<loc>\s*([^<\s]+)", cards_map.decode("utf-8", "replace"))
    for u in random.sample(urls, min(5, len(urls))):
        card_page = check(urllib.parse.urlsplit(html.unescape(u)).path, 200, has("</html>"), "sample card") or card_page

if CHANGED and CHANGED.exists():
    c = json.loads(CHANGED.read_text())
    price = f"${c['new']:,.2f}"
    check(c["path"], 200, has(price), f"price changed {c['old']:,.2f} -> {c['new']:,.2f} ({c['variant']})")

# every same-origin asset (CSS/JS/fonts/images) of the home page and a card page must load
assets = set()
for page, body in (("/", home), ("/cards/", card_page)):
    if not body:
        continue
    for r in re.findall(r'<(?:link|script|img|source)[^>]+?(?:href|src)="([^"]+)"', body.decode("utf-8", "replace")):
        u = urllib.parse.urljoin(BASE + page, html.unescape(r))
        if urllib.parse.urlsplit(u).hostname == urllib.parse.urlsplit(BASE).hostname and \
                re.search(r"\.(css|js|mjs|woff2?|svg|png|webp|jpe?g|ico|avif|gif|webmanifest)(\?|$)", u):
            assets.add(u)
bad_assets = []
for u in sorted(assets):
    st, h, _ = get(u)
    if st == 403 and (h.get("cf-mitigated") or "").lower() == "challenge":
        waf.append(u)
    elif st != 200:
        bad_assets.append(f"{st} {u}")
print(f"assets: {len(assets)} checked, {len(bad_assets)} broken" + "".join("\n    " + x for x in bad_assets[:8]))
fails += bad_assets

print(f"smoke: {done} checked, {len(fails)} failed, {len(waf)} behind the WAF challenge")
sys.exit(1 if fails else 0)
