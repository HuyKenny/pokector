#!/usr/bin/env python3
"""Freeze a live SSR site into static files (Cloudflare Free-plan migration, 2026-11).

Copy of /home/kenny/ai/scripts/cloudflare-free/zmraz.py (CI cannot read the workspace); pokector renders
from the local `static` build (scripts/static/static.py → `crawl --base http://127.0.0.1:PORT`).

Crawls the sitemap URLs + internal links (no query strings) from the live site, saves HTML
and same-origin assets, turns /go/ affiliate redirects into static redirect pages, and writes
an assets-only wrangler config. The result is deployed under the SAME Worker name, so routes
and custom domains stay; the SSR code in the app repo is untouched (redeploy = rollback).

    scripts/cloudflare-free/zmraz.py crawl alkoholicky.cz --out /home/kenny/ai/tmp/zmraz/alkoholicky
    scripts/cloudflare-free/zmraz.py config alkoholicky.cz --out ... --worker alkoholicky
"""
import argparse
import concurrent.futures as cf
import gzip
import html
import json
import os
import re
import shutil
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
MAX_FILES = 19_500          # Free plan: 20,000 files per Worker version
SKIP_PREFIX = ("/api/", "/admin", "/cdn-cgi/", "/wp-admin", "/wp-json")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def fetch(url, tries=3):
    """Returns (status, headers, body bytes). Redirects are NOT followed."""
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
            with OPENER.open(req, timeout=60) as r:
                b = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    b = gzip.decompress(b)
                return r.status, r.headers, b
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308):
                return e.code, e.headers, b""
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(2 * (i + 1))
                continue
            b = e.read() if e.fp else b""
            if b and (e.headers.get("Content-Encoding") == "gzip" or b[:2] == b"\x1f\x8b"):
                b = gzip.decompress(b)      # error pages are gzipped too (the frozen 404.html was gzip bytes)
            return e.code, e.headers, b
        except Exception:
            if i == tries - 1:
                return 0, {}, b""
            time.sleep(2 * (i + 1))


def sitemap_urls(base, fetch_base=None):
    """fetch_base: the origin actually fetched (local dev server); sitemap URLs keep the production host."""
    fb = fetch_base or base
    local = lambda u: fb + u[len(base):] if fetch_base and u.startswith(base) else u
    st, _, rob = fetch(fb + "/robots.txt")
    sms = re.findall(r"(?im)^sitemap:\s*(\S+)", rob.decode("utf-8", "replace")) or [base + "/sitemap.xml"]
    seen, urls, q = set(), [], list(sms)
    while q:
        u = q.pop()
        if u in seen:
            continue
        seen.add(u)
        st, _, x = fetch(local(u))
        x = x.decode("utf-8", "replace")
        locs = [html.unescape(l) for l in re.findall(r"<loc>\s*([^<\s]+)", x)]
        if "<sitemapindex" in x:
            q += locs
        else:
            urls += locs
    return sorted(seen), urls


class Freezer:
    def __init__(self, domain, out, workers=8):
        self.domain = domain
        self.base = "https://" + domain
        self.hosts = {domain, "www." + domain}
        self.out = Path(out)
        self.workers = workers
        self.lock = threading.Lock()
        self.seen = set()
        self.files = {}          # rel path -> url
        self.redirects = {}      # path -> (status, location)
        self.no_go = False
        self.go = {}             # /go/... path -> target
        self.errors = {}
        self.trailing = None
        self.extra_until = MAX_FILES
        self.skip = SKIP_PREFIX
        self.fetch_base = self.base   # --base: crawl another origin (local dev server), files keep the production domain
        self.exits = ("/go/",)        # exit pages: fetched even beyond --extra-until (/akce/ on kakapo)

    # -- path helpers -------------------------------------------------------
    def norm(self, href, page_url):
        if not href or href.startswith(("#", "mailto:", "tel:", "javascript:", "data:")):
            return None
        u = urllib.parse.urljoin(page_url, html.unescape(href))
        p = urllib.parse.urlsplit(u)
        if p.scheme not in ("http", "https") or p.hostname not in self.hosts:
            return None
        if p.query and not p.path.startswith("/go/") and not ASSET_RE.search(p.path):
            return None     # /go/<id>/?ctx=… : the static redirect page ignores the query, same target
        # assets with cache-busting (?v=…) are saved under their path: Workers static assets ignore the query
        # (kakapo 23. 11.: kakapo.css?v=… was skipped and the frozen site had no CSS/JS)
        path = urllib.parse.unquote(p.path) or "/"
        if path.startswith(self.skip):
            return None
        return path

    def rel_for(self, path, is_html):
        if not is_html:
            return path.lstrip("/")
        if path == "/":
            return "index.html"
        if path.endswith("/"):
            return path.lstrip("/") + "index.html"
        last = path.rsplit("/", 1)[-1]
        if "." in last and last.endswith((".html", ".htm")):
            return path.lstrip("/")
        return path.lstrip("/") + ".html"

    # -- crawl --------------------------------------------------------------
    def handle(self, path):
        url = self.fetch_base + urllib.parse.quote(path)
        # resume: a file saved by an earlier run is reused (still parsed for links)
        h_rel, a_rel = self.rel_for(path, True), self.rel_for(path, False)
        if (self.out / h_rel).is_file():
            st, body = 200, (self.out / h_rel).read_bytes()
            hdr = {"Content-Type": "text/html"}
        elif a_rel and "." in a_rel.rsplit("/", 1)[-1] and (self.out / a_rel).is_file():
            st, body = 200, (self.out / a_rel).read_bytes()
            hdr = {"Content-Type": "text/css" if a_rel.endswith(".css") else "application/octet-stream"}
        else:
            st, hdr, body = fetch(url)
        new = []
        if st in (301, 302, 303, 307, 308):
            loc = hdr.get("Location", "")
            if path.startswith("/go/"):
                with self.lock:
                    self.go[path] = urllib.parse.urljoin(url, loc)
                self.write_go_one(path, self.go[path])     # saved right away, so a resumed run skips it
            else:
                with self.lock:
                    self.redirects[path] = (st, loc)
                tgt = self.norm(loc, url)
                if tgt:
                    new.append(tgt)
            return new
        if st != 200:
            with self.lock:
                self.errors[path] = st
            return new
        ctype = (hdr.get("Content-Type") or "").lower()
        is_html = "text/html" in ctype
        rel = self.rel_for(path, is_html)
        dest = self.out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
        with self.lock:
            self.files[rel] = path
        if is_html or "text/css" in ctype:
            text = body.decode("utf-8", "replace")
            refs = re.findall(r'''(?:href|src|poster|data-src)\s*=\s*["']([^"']+)["']''', text)
            # meta content= only when it is a URL (og:image etc.), never descriptions
            refs += [x for x in re.findall(r'''content\s*=\s*["']([^"']+)["']''', text) if x.startswith(("/", "http"))]
            for s in re.findall(r'''srcset\s*=\s*["']([^"']+)["']''', text):
                refs += [x.strip().split(" ")[0] for x in s.split(",")]
            refs += re.findall(r'''url\(\s*["']?([^"')]+)["']?\s*\)''', text)
            refs += re.findall(r'''["'](/_astro/[^"']+)["']''', text)
            for r in refs:
                n = self.norm(r, url)
                if n:
                    new.append(n)
        return new

    def crawl(self, start, limit):
        """Sitemap paths first, discovered links after; each path is queued exactly once."""
        from collections import deque
        prio, rest, queued = deque(), deque(), set()
        for p in dict.fromkeys(start):
            queued.add(p)
            prio.append(p)
        n_done = 0
        with cf.ThreadPoolExecutor(self.workers) as ex:
            futs = {}
            while prio or rest or futs:
                while (prio or rest) and len(futs) < self.workers * 3:
                    from_prio = bool(prio)
                    p = prio.popleft() if prio else rest.popleft()
                    if p.startswith("/go/") and self.no_go:
                        continue    # exits come from D1 instead (go-z-d1.py)
                    if len(self.files) >= limit and not p.startswith("/go/"):
                        continue
                    last = p.rstrip("/").rsplit("/", 1)[-1]
                    is_page = "." not in last
                    if not from_prio and is_page and not p.startswith(self.exits) and len(self.files) >= self.extra_until:
                        continue    # discovered page outside the sitemap: only while the single-Worker budget lasts
                    futs[ex.submit(self.handle, p)] = p
                if not futs:
                    break
                done, _ = cf.wait(list(futs), return_when=cf.FIRST_COMPLETED)
                for f in done:
                    futs.pop(f)
                    n_done += 1
                    try:
                        for n in f.result():
                            if n not in queued:
                                queued.add(n)
                                rest.append(n)
                    except Exception as e:
                        print("chyba:", e, file=sys.stderr)
                    if n_done % 500 == 0:
                        print(f"  {n_done} prošlo, {len(self.files)} souborů, fronta {len(prio)}+{len(rest)}", flush=True)

    # -- outputs ------------------------------------------------------------
    def write_go_one(self, path, tgt):
        t = html.escape(tgt, quote=True)
        page = (f'<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">'
                f'<meta http-equiv="refresh" content="0;url={t}"><title>Přesměrování…</title>'
                f'<script>location.replace({json.dumps(tgt)})</script><a href="{t}" rel="nofollow sponsored">Pokračovat</a>')
        rel = self.rel_for(path, True)
        d = self.out / rel
        d.parent.mkdir(parents=True, exist_ok=True)
        d.write_text(page, encoding="utf-8")
        with self.lock:
            self.files[rel] = path

    def write_go(self):
        for path, tgt in self.go.items():
            t = html.escape(tgt, quote=True)
            page = (f'<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex,nofollow">'
                    f'<meta http-equiv="refresh" content="0;url={t}"><title>Přesměrování…</title>'
                    f'<script>location.replace({json.dumps(tgt)})</script><a href="{t}" rel="nofollow sponsored">Pokračovat</a>')
            rel = self.rel_for(path, True)
            d = self.out / rel
            d.parent.mkdir(parents=True, exist_ok=True)
            d.write_text(page, encoding="utf-8")
            self.files[rel] = path

    def write_redirects(self):
        lines = []
        for p, (st, loc) in sorted(self.redirects.items()):
            if st in (301, 302, 307, 308) and loc and " " not in p:
                tgt = loc
                pu = urllib.parse.urlsplit(loc)
                if pu.hostname in self.hosts:
                    tgt = pu.path + (("?" + pu.query) if pu.query else "")
                if tgt.rstrip("/") == p.rstrip("/") or len(p) + len(tgt) > 1000 or not p.isascii():
                    continue   # trailing-slash normalisation is handled by html_handling
                lines.append(f"{p} {tgt} {301 if st in (301, 308) else 302}")
        (self.out / "_redirects").write_text("\n".join(lines[:2000]) + "\n", encoding="utf-8")
        return len(lines)


def cf_creds():
    """CI (GitHub Actions): CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID); Malina: global key from credentials/."""
    if os.environ.get("CLOUDFLARE_API_TOKEN"):
        return {"Authorization": "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"]}, {}
    c = {}
    for l in open("/home/kenny/ai/credentials/.cloudflare-credentials.env"):
        if "=" in l and not l.startswith("#"):
            k, v = l.strip().split("=", 1)
            c[k] = v.strip('"\'')
    key = c.get("CF_GLOBAL_API_KEY") or c["CF_API_KEY"]
    return ({"X-Auth-Email": c["CF_EMAIL"], "X-Auth-Key": key},
            {"CLOUDFLARE_EMAIL": c["CF_EMAIL"], "CLOUDFLARE_API_KEY": key})


def account_id():
    return os.environ.get("CLOUDFLARE_ACCOUNT_ID") or cf_api("/accounts")["result"][0]["id"]


def cf_api(path, method="GET"):
    h = dict(cf_creds()[0], **{"User-Agent": "zmraz/1.0"})
    r = urllib.request.Request("https://api.cloudflare.com/client/v4" + path, headers=h, method=method)
    try:
        return json.load(urllib.request.urlopen(r, timeout=60))
    except urllib.error.HTTPError as e:
        return json.load(e)


def current_routes(worker):
    """Zone routes + custom domains currently attached to the Worker (kept as-is on redeploy)."""
    acc = account_id()
    out = []
    for z in cf_api("/zones?per_page=100")["result"]:
        for r in cf_api(f"/zones/{z['id']}/workers/routes").get("result") or []:   # a scoped token sees only its own zone
            if r.get("script") == worker:
                out.append({"pattern": r["pattern"], "zone_name": z["name"]})
    for d in cf_api(f"/accounts/{acc}/workers/domains").get("result") or []:
        if d.get("service") == worker:
            out.append({"pattern": d["hostname"], "custom_domain": True})
    return out


SHARD_CAP = 19_000


def url_path(rel):
    """Asset file -> URL path it is served at (html_handling auto-trailing-slash)."""
    if rel == "index.html":
        return "/"
    if rel.endswith("/index.html"):
        return "/" + rel[:-len("index.html")]
    if rel.endswith(".html"):
        return "/" + rel[:-5]
    return "/" + rel


def plan_shards(out):
    """Split all files by URL-path prefix so that each group fits a Worker.

    Every file whose URL path starts with a shard prefix lives in that shard (HTML or not), because the zone
    route `<domain>/<prefix>*` sends every such request there. "/" and short top-level paths stay in main.
    """
    files = [str(p.relative_to(out)) for p in out.rglob("*") if p.is_file()]
    files = [f for f in files if f not in ("_redirects", "404.html")]
    if len(files) <= SHARD_CAP:
        return files, []
    by = {f: url_path(f) for f in files}

    def split(prefix, group):
        if len(group) <= SHARD_CAP // 2 or len(prefix) > 80:
            return [(prefix, group)]
        kids = {}
        rest = []
        for f in group:
            u = by[f]
            if len(u) > len(prefix):
                kids.setdefault(u[: len(prefix) + 1], []).append(f)
            else:
                rest.append(f)            # the prefix itself (e.g. "/games/") stays with main
        out_ = []
        for k, g in sorted(kids.items()):
            out_ += split(k, g)
        if rest:
            out_.append((None, rest))
        return out_

    buckets = split("/", files)
    main = [f for p, g in buckets if p is None or p == "/" for f in g]
    pieces = sorted([(p, g) for p, g in buckets if p not in (None, "/")], key=lambda x: -len(x[1]))
    # keep the smallest pieces in main as long as it fits; never move "/_" assets (/_astro) out of main
    shards = []
    for p, g in sorted(pieces, key=lambda x: len(x[1])):
        if (len(main) + len(g) <= SHARD_CAP) or p.startswith("/_"):
            main += g
        else:
            shards.append((p, g))
    packed = []
    for p, g in sorted(shards, key=lambda x: -len(x[1])):
        for s in packed:
            if len(s["files"]) + len(g) <= SHARD_CAP:
                s["files"] += g
                s["prefixes"].append(p)
                break
        else:
            packed.append({"prefixes": [p], "files": list(g)})
    if len(main) > SHARD_CAP:
        sys.exit(f"main má po rozdělení {len(main)} souborů — rozděl jemněji")
    return main, packed


def plan_segment_shards(out, segments):
    """Only files under /<segment>/ go to shards; the original Worker stays as it is (keep-main mode)."""
    files = [str(p.relative_to(out)) for p in out.rglob("*") if p.is_file()]
    groups = []
    for seg in segments:
        mine = [f for f in files if url_path(f).startswith(f"/{seg}/")]

        def split(prefix, group):
            if len(group) <= SHARD_CAP:
                return [(prefix, group)]
            kids = {}
            for f in group:
                u = url_path(f)
                kids.setdefault(u[: len(prefix) + 1] if len(u) > len(prefix) else prefix, []).append(f)
            if len(kids) == 1:
                return [(prefix, group)]
            r = []
            for k, g in sorted(kids.items()):
                r += split(k, g)
            return r
        groups += split(f"/{seg}/", mine)
    packed = []
    for p, g in sorted(groups, key=lambda x: -len(x[1])):
        for sh in packed:
            if len(sh["files"]) + len(g) <= SHARD_CAP:
                sh["files"] += g
                sh["prefixes"].append(p)
                break
        else:
            packed.append({"prefixes": [p], "files": list(g)})
    return packed


ASSET_RE = re.compile(r"\.(css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|webmanifest|json|xml|txt|pdf|mp4|webm)$", re.I)
STRIP_RE = re.compile(r'<script\b[^>]*type="module"[^>]*>.*?</script>|<link\b[^>]*rel="modulepreload"[^>]*>', re.S)


def materialize(out, dest, files, strip=False):
    """Hard-link a subset of files into a separate directory (fast, no extra space)."""
    import os
    import shutil
    if dest.exists():
        shutil.rmtree(dest)
    for f in files + [x for x in ("_redirects", "404.html") if (out / x).exists()]:
        d = dest / f
        d.parent.mkdir(parents=True, exist_ok=True)
        if strip and f.endswith(".html"):
            # frozen pages of a JS app: drop the client bundle so the page never calls back into the Worker
            d.write_text(STRIP_RE.sub("", (out / f).read_text(encoding="utf-8", errors="replace")), encoding="utf-8")
        else:
            os.link(out / f, d)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["crawl", "plan", "deploy"])
    ap.add_argument("domain")
    ap.add_argument("--out", required=True)
    ap.add_argument("--worker")
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--limit", type=int, default=MAX_FILES)
    ap.add_argument("--segments", help="keep-main mode: shard only these top-level path segments (comma list)")
    ap.add_argument("--strip-scripts", action="store_true", help="remove module scripts from frozen HTML")
    ap.add_argument("--zone", help="zone name if it differs from the domain")
    ap.add_argument("--extra-until", type=int, default=MAX_FILES - 500,
                    help="discovered (non-sitemap) pages are fetched only while the file count is below this")
    ap.add_argument("--no-go", action="store_true", help="skip /go/ exits (generate them with go-z-d1.py)")
    ap.add_argument("--skip", action="append", default=[], metavar="PREFIX",
                    help="extra path prefix not to fetch, repeatable (e.g. --skip /img/ when thumbnails live on R2)")
    ap.add_argument("--base", help="origin to fetch from instead of https://<domain> (e.g. http://127.0.0.1:8787)")
    ap.add_argument("--exits", default="/go/", help="comma list of exit prefixes fetched beyond --extra-until (e.g. /go/,/akce/)")
    a = ap.parse_args()
    out = Path(a.out)

    if a.cmd == "crawl":
        out.mkdir(parents=True, exist_ok=True)
        fz = Freezer(a.domain, out, a.workers)
        fz.extra_until = a.extra_until
        fz.no_go = a.no_go
        fz.skip = SKIP_PREFIX + tuple(a.skip)
        fz.exits = tuple(x for x in a.exits.split(",") if x)
        if a.base:
            fz.fetch_base = a.base.rstrip("/")
            fz.hosts.add(urllib.parse.urlsplit(fz.fetch_base).hostname)
        sms, urls = sitemap_urls(fz.base, fz.fetch_base if a.base else None)
        paths = []
        for u in urls:
            n = fz.norm(u, fz.base + "/")
            if n:
                paths.append(n)
        slash = sum(1 for p in paths if p.endswith("/") and p != "/")
        fz.trailing = slash > len(paths) / 2
        start = ["/", "/robots.txt", "/favicon.ico", "/favicon.svg", "/manifest.webmanifest", "/ads.txt"]
        start += [urllib.parse.urlsplit(s).path for s in sms] + paths
        t0 = time.time()
        print(f"{a.domain}: {len(paths)} URL ze sitemap, trailing slash: {fz.trailing}", flush=True)
        fz.crawl(start, a.limit)
        # 404 page
        st, _, body = fetch(fz.fetch_base + "/zz-neexistuje-" + str(int(t0)))
        if body and st == 404:
            (out / "404.html").write_bytes(body)
        fz.write_go()
        nred = fz.write_redirects()
        meta = {"domain": a.domain, "files": len(fz.files) + 2, "go": len(fz.go), "redirects": nred,
                "errors": len(fz.errors), "error_sample": dict(list(fz.errors.items())[:20]),
                "trailing_slash": fz.trailing, "seconds": round(time.time() - t0)}
        (out.parent / (out.name + ".meta.json")).write_text(json.dumps(meta, ensure_ascii=False, indent=1))
        print(json.dumps(meta, ensure_ascii=False))
        return 0

    # deploy: shards first (their routes are more specific), then main under the original Worker name
    import os
    import subprocess
    routes = current_routes(a.worker)
    if not routes:
        sys.exit(f"Worker {a.worker} nemá žádné routy ani domény — nenasazuji naslepo")
    # www is redirected to the apex by a zone Redirect Rule (ensure_www_redirect), so main keeps only apex routes
    # www zone routes are replaced by the www-redirect rule; www custom domains stay (they own the DNS record)
    routes = [r for r in routes if r.get("custom_domain") or not r["pattern"].startswith("www.")]
    if a.segments:
        main_files, shards = None, plan_segment_shards(out, a.segments.split(","))
    else:
        main_files, shards = plan_shards(out)
    nf = "404-page" if (out / "404.html").exists() else "none"
    work = out.parent / (out.name + "-deploy")
    work.mkdir(exist_ok=True)
    jobs = []
    for i, sh in enumerate(shards, 1):
        name = f"{a.worker}-z{i:02d}"
        d = work / name
        materialize(out, d, sh["files"], strip=a.strip_scripts)
        zone = a.zone or a.domain
        r = [{"pattern": f"{a.domain}{p}*", "zone_name": zone} for p in sh["prefixes"]]
        jobs.append((name, d, r, len(sh["files"])))
    if main_files is not None:
        d = work / a.worker
        materialize(out, d, main_files, strip=a.strip_scripts)
        jobs.append((a.worker, d, routes, len(main_files)))
    for name, d, r, n in jobs:
        cfg = {"name": name, "compatibility_date": "2026-11-01", "workers_dev": False, "preview_urls": False,
               "routes": r, "assets": {"directory": str(d), "html_handling": "auto-trailing-slash",
                                       "not_found_handling": nf}}
        cp = work / f"wrangler-{name}.json"
        cp.write_text(json.dumps(cfg, indent=1))
        print(f"{name}: {n} souborů, routy {[x['pattern'] for x in r]}", flush=True)
        if a.cmd != "deploy":
            continue
        env = dict(os.environ, **cf_creds()[1],
                   PATH="/home/kenny/.nvm/versions/node/v22.23.1/bin:" + os.environ.get("PATH", ""))
        w = os.environ.get("WRANGLER") or "/home/kenny/ai/apps/kakapo/node_modules/.bin/wrangler"
        res = subprocess.run([w, "deploy", "-c", str(cp)], cwd=str(work), env=env, capture_output=True, text=True)
        full = res.stdout + res.stderr
        tail = full[-1500:]
        if res.returncode != 0 or not any(k in full for k in ("Current Version ID", "Deployed ", "Uploaded ")):
            print(tail)
            sys.exit(f"deploy {name} selhal")
        print("  OK", flush=True)
    if a.cmd == "deploy":
        # shards from an earlier plan keep their zone routes and would shadow files now served elsewhere
        # (pokector 23. 11.: stale -z02 kept /cards/c* and /cards/compare 404ed) -> delete them
        keep = {n for n, *_ in jobs}
        acc = account_id()
        for sc in cf_api(f"/accounts/{acc}/workers/scripts").get("result") or []:
            if re.fullmatch(re.escape(a.worker) + r"-z\d\d", sc["id"]) and sc["id"] not in keep:
                r = cf_api(f"/accounts/{acc}/workers/scripts/{sc['id']}?force=true", "DELETE")
                print(f"starý shard {sc['id']} smazán" if r.get("success") else f"starý shard {sc['id']}: {r.get('errors')}")
        shutil.rmtree(work)     # hard links only, but they pin the space until the raw dir goes too
    return 0


if __name__ == "__main__":
    sys.exit(main())
