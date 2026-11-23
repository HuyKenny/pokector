#!/usr/bin/env python3
"""pokector.com nightly static rebuild (Cloudflare Workers Free since 2026-11-23).

The SSR app no longer runs on Cloudflare: production is the Worker `pokector-production` serving static assets
(+ shard `pokector-production-z01`), the logged-in app is paused, D1/KV/Queues are gone. This script rebuilds
those assets from the data the old cron jobs kept fresh:

  1. data/state.db (SQLite with the D1 schema, restored by scripts/static/state.sh) becomes the local D1 of the
     `static` build (`CLOUDFLARE_ENV=static pnpm build` → build/server/wrangler.json),
  2. the app runs under `wrangler dev --local`; its scheduled handler gets the old weekly orchestrator tick
     ("17 5 * * 1": TCGCSV prices, TCGdex Cardmarket prices, Riftbound catalog + prices, weekly PTCG catalog sync,
     price history, eBay graded seed) and then "static-drain" ticks until the job queue is empty,
  3. the public pages are frozen from the local server by zmraz.py (sitemap-driven, ~24 k pages) + paused-app pages,
  4. zmraz.py deploys them as assets of pokector-production (shards by URL prefix), unchanged files are not uploaded,
  5. the state is copied back to data/state.db (state.sh push saves it encrypted).

    static.py run [--quick] [--no-deploy] [--limit N] [--out DIR]
      --quick      no jobs (render from the restored data) - template/CSS/text fixes, a few minutes
      --no-deploy  build + freeze only (local checks)
      --limit N    stop the crawl at N files (local tests on the Pi)
Prints counts only (public Actions logs): never secrets or response bodies.
"""
import argparse
import html
import json
import os
import re
import secrets
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

APP = Path(__file__).resolve().parents[2]
HERE = APP / 'scripts' / 'static'
BUILD = APP / 'build'
CFG = BUILD / 'server' / 'wrangler.json'
WORK = Path(os.environ.get('PK_WORK', APP / '.static-work')).resolve()
# PK_PERSIST: the local D1 on a RAM disk when the work dir is on a slow SD card (Kenny's Pi)
PERSIST = Path(os.environ.get('PK_PERSIST', WORK / 'wrangler-state')).resolve()
DATA = APP / 'data'
STATE_DB = DATA / 'state.db'
PORT = int(os.environ.get('PK_PORT', '8850'))
ORIGIN = f'http://127.0.0.1:{PORT}'
DOMAIN = 'pokector.com'
WORKER = 'pokector-production'
ORCHESTRATOR_CRON = '17 5 * * 1'      # app/lib/jobs/scheduler.server.ts DAILY_ORCHESTRATOR_CRON
DRAIN_CRON = 'static-drain'           # STATIC_DRAIN_CRON
JOBS_BUDGET_S = int(os.environ.get('PK_JOBS_BUDGET_S', str(150 * 60)))
CRED = Path('/home/kenny/ai/credentials')
SECRET_NAMES = ('POKEMON_TCG_API_KEY', 'EBAY_APP_ID', 'EBAY_CERT_ID')


def log(*a):
    print(*a, flush=True)


def group(title):
    log(f'::group::{title}' if os.environ.get('GITHUB_ACTIONS') else f'== {title}')


def endgroup():
    if os.environ.get('GITHUB_ACTIONS'):
        log('::endgroup::')


def wrangler(*args, **kw):
    return subprocess.run([str(APP / 'node_modules' / '.bin' / 'wrangler'), *args], cwd=APP,
                          env={**os.environ, 'CI': '1', 'WRANGLER_SEND_METRICS': 'false'}, **kw)


# ---------- local app ----------

def dev_vars():
    """Secrets of the local run: environment (CI) or the workspace credentials (Kenny's Pi). Never printed.
    BETTER_AUTH_SECRET is random per run: nobody signs in to the local server (the app is paused)."""
    vals = {k: os.environ.get(k, '') for k in SECRET_NAMES}
    if not all(vals.values()) and CRED.is_dir():
        for name in ('.pokector-credentials.env', '.pokector-ebay-credentials.env'):
            p = CRED / name
            if p.exists():
                for line in p.read_text().splitlines():
                    k, _, v = line.partition('=')
                    if k.strip() in vals and not vals[k.strip()]:
                        vals[k.strip()] = v.strip().strip('"\'')
    missing = [k for k, v in vals.items() if not v]
    if missing:
        log(f'note: {", ".join(missing)} not set (PTCG catalog sync / eBay prices skipped)')
    vals['BETTER_AUTH_SECRET'] = secrets.token_urlsafe(32)
    p = BUILD / 'server' / '.dev.vars'
    p.write_text(''.join(f'{k}={json.dumps(v)}\n' for k, v in vals.items() if v))
    p.chmod(0o600)


def prepare_db():
    """Create the local D1 of build/server/wrangler.json, replace it with data/state.db, apply pending migrations."""
    if PERSIST.exists():
        shutil.rmtree(PERSIST)
    args = ('d1', 'migrations', 'apply', 'DB', '--local', '-c', str(CFG), '--persist-to', str(PERSIST))
    if not STATE_DB.exists():
        sys.exit('data/state.db missing (scripts/static/state.sh pull)')
    r = wrangler(*args, capture_output=True, text=True)
    files = [f for f in (PERSIST / 'v3' / 'd1').rglob('*.sqlite') if f.name != 'metadata.sqlite']
    if r.returncode or len(files) != 1:
        log(r.stdout[-1500:], r.stderr[-1500:])
        sys.exit('could not create the local D1 file')
    target = files[0]
    for f in target.parent.glob(target.name + '*'):
        f.unlink()
    shutil.copyfile(STATE_DB, target)
    r = wrangler(*args, capture_output=True, text=True)
    if r.returncode:
        log(r.stdout[-1500:], r.stderr[-1500:])
        sys.exit('migrations failed on the restored state')
    log(f'state: {STATE_DB.stat().st_size // 1_000_000} MB restored, migrations applied')
    return target


def get(path, timeout=120):
    req = urllib.request.Request(ORIGIN + path, headers={'User-Agent': 'pokector-static/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, b''
    except (urllib.error.URLError, TimeoutError, ConnectionError):
        return 0, b''       # a slow job or a restarting server: the drain loop just ticks again


class Server:
    def __enter__(self):
        self.logf = open(WORK / 'wrangler-dev.log', 'w')
        self.proc = subprocess.Popen(
            [str(APP / 'node_modules' / '.bin' / 'wrangler'), 'dev', '-c', str(CFG), '--local', '--persist-to', str(PERSIST),
             '--port', str(PORT), '--ip', '127.0.0.1', '--inspector-port', str(PORT + 1), '--test-scheduled',
             '--show-interactive-dev-session=false', '--log-level', 'warn'],
            cwd=APP, stdout=self.logf, stderr=subprocess.STDOUT, start_new_session=True,
            env={**os.environ, 'CI': '1', 'WRANGLER_SEND_METRICS': 'false'})
        for _ in range(180):
            time.sleep(1)
            if self.proc.poll() is not None:
                break
            try:
                if get('/robots.txt', timeout=20)[0] == 200:
                    return self
            except Exception:
                pass
        self.stop()
        log((WORK / 'wrangler-dev.log').read_text()[-3000:])
        sys.exit('local app did not start')

    def stop(self):
        if self.proc.poll() is None:
            os.killpg(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(30)
            except subprocess.TimeoutExpired:
                os.killpg(self.proc.pid, signal.SIGKILL)
        self.logf.close()

    def __exit__(self, *a):
        self.stop()


def ro(db_file):
    return sqlite3.connect(f'file:{db_file}?mode=ro', uri=True, timeout=30)


def snapshot(db_file, dest):
    """Consistent copy of the live local D1 (the server keeps a WAL open)."""
    src, dst = ro(db_file), sqlite3.connect(dest)
    src.backup(dst)
    src.close()
    dst.close()


# ---------- jobs ----------

def run_jobs(db_file):
    t0 = time.time()
    since = int(t0 * 1000) - 5000
    st, _ = get('/cdn-cgi/handler/scheduled?cron=' + ORCHESTRATOR_CRON.replace(' ', '+'), timeout=300)
    log(f'orchestrator tick: HTTP {st}')
    ticks = 0
    while time.time() - t0 < JOBS_BUDGET_S:
        with ro(db_file) as db:
            open_jobs = db.execute("SELECT COUNT(*) FROM sync_jobs WHERE status IN ('pending', 'running')").fetchone()[0]
        if not open_jobs:
            break
        st, _ = get('/cdn-cgi/handler/scheduled?cron=' + DRAIN_CRON, timeout=900)
        ticks += 1
        if st != 200:
            log(f'drain tick {ticks}: HTTP {st}')
            time.sleep(2)
        if ticks % 100 == 0:
            log(f'  {ticks} ticks, {open_jobs} open jobs, {time.time() - t0:.0f} s')
    else:
        log(f'::warning::job budget of {JOBS_BUDGET_S} s used up; the rest continues next night')
    with ro(db_file) as db:
        rows = db.execute('SELECT type, status, COUNT(*) FROM sync_jobs WHERE created_at >= ? GROUP BY 1, 2 ORDER BY 1, 2',
                          (since,)).fetchall()
        errs = db.execute("SELECT type, substr(error_message, 1, 160) FROM sync_jobs WHERE created_at >= ? AND status = 'failed' "
                          "LIMIT 5", (since,)).fetchall()
    log(f'jobs: {ticks} ticks in {time.time() - t0:.0f} s')
    for t, s, n in rows:
        log(f'  {t:<30} {s:<10} {n}')
    for t, e in errs:
        log(f'  failed {t}: {e}')
    return sum(n for _, s, n in rows if s == 'completed')


def price_snapshot(db_file):
    """TCGplayer market prices (US default view) keyed by card + variant."""
    with ro(db_file) as db:
        return {(c, v): (m, o) for c, v, m, o in db.execute(
            "SELECT card_id, variant, market_minor, observed_at FROM card_prices_current WHERE source = 'tcgplayer' AND currency = 'USD'")}


def changed_card(db_file, before):
    """One card whose headline price changed in this run (proof on the live site); written to WORK/changed.json."""
    after = price_snapshot(db_file)
    ch = [(k, before[k][0], v[0]) for k, v in after.items() if k in before and v[0] and before[k][0] and v[0] != before[k][0]]
    new = [k for k in after if k not in before]
    log(f'prices: {len(ch)} TCGplayer prices changed, {len(new)} new, {sum(1 for k, v in after.items() if k in before and v[1] != before[k][1])} refreshed')
    if not ch:
        return
    with ro(db_file) as db:
        for (card, variant), old, nw in sorted(ch, key=lambda x: -abs(x[2] - x[1])):
            row = db.execute('SELECT slug FROM pokemon_cards WHERE id = ?', (card,)).fetchone()
            if row and old >= 100 and nw >= 100:
                info = {'path': f'/cards/{row[0]}', 'card': card, 'variant': variant, 'old': old / 100, 'new': nw / 100}
                (WORK / 'changed.json').write_text(json.dumps(info))
                log(f'changed: {info}')
                return


# ---------- freeze ----------

PAUSED = HERE / 'paused.py'
NONCE = re.compile(rb'nonce="[A-Za-z0-9+/=]{8,}"')


def freeze(out, limit):
    if out.exists():
        shutil.rmtree(out)
    cmd = [sys.executable, str(HERE / 'zmraz.py'), 'crawl', DOMAIN, '--out', str(out), '--base', ORIGIN,
           '--extra-until', '0', '--workers', os.environ.get('PK_CRAWL_WORKERS', '6')]
    if limit:
        cmd += ['--limit', str(limit)]
    t = time.time()
    r = subprocess.run(cmd)
    if r.returncode:
        sys.exit('crawl failed')
    meta = json.loads((out.parent / (out.name + '.meta.json')).read_text())
    log(f'crawl: {meta["files"]} files, {meta["errors"]} errors in {time.time() - t:.0f} s')
    # the CSP nonce is random per render; a fixed value keeps unchanged pages byte-identical (no re-upload)
    n = 0
    for f in out.rglob('*.html'):
        b = f.read_bytes()
        b2 = NONCE.sub(b'nonce="static"', b)
        if b2 != b:
            f.write_bytes(b2)
            n += 1
    subprocess.run([sys.executable, str(PAUSED), str(out)], check=True)
    # sitemap shards have no file extension: give them their XML type (static assets guess it from the name)
    (out / '_headers').write_text('/sitemap-cards/*\n  Content-Type: application/xml; charset=utf-8\n')
    return meta


def check_out(out, meta, limit):
    """Deploy gate: the sitemap pages must be there (a broken render must never replace the live site)."""
    sm = out / 'sitemap.xml'
    if not sm.exists():
        sys.exit('gate: no sitemap.xml')
    maps = [p for p in out.glob('sitemap-*.xml')] + [p for p in (out / 'sitemap-cards').glob('*') if p.is_file()]
    want, missing = 0, []
    for x in maps:
        for loc in re.findall(r'<loc>\s*https://pokector\.com([^<\s]*)', x.read_text(encoding='utf-8')):
            want += 1
            loc = urllib.parse.unquote(html.unescape(loc))
            rel = 'index.html' if loc in ('', '/') else loc.lstrip('/') + '.html'
            if not (out / rel).is_file():
                missing.append(loc)
    pages = sum(1 for _ in out.rglob('*.html'))
    log(f'gate: {pages} HTML files, {want} sitemap URLs, {len(missing)} missing {missing[:5]}, '
        f'{meta["errors"]} errors {meta.get("error_sample")}')
    if limit:
        return
    if want < 20_000 or len(missing) > want * 0.01 or meta['errors'] > 200:
        sys.exit('gate: too few pages or too many errors - not deploying')


def secret_check(out):
    """No secret value may end up in a deployed file (public site, public logs)."""
    vals = [v.encode() for k in SECRET_NAMES + ('CLOUDFLARE_API_TOKEN',) if len(v := os.environ.get(k, '')) >= 8]
    if not vals:
        return
    for f in out.rglob('*'):
        if f.is_file():
            b = f.read_bytes()
            if any(v in b for v in vals):
                sys.exit(f'secret check: a secret value is in {f.relative_to(out)} - not deploying')
    log(f'secret check: {len(vals)} values, none in the output')


def deploy(out, worker):
    env = dict(os.environ, WRANGLER=str(APP / 'node_modules' / '.bin' / 'wrangler'))
    r = subprocess.run([sys.executable, str(HERE / 'zmraz.py'), 'deploy', DOMAIN, '--out', str(out), '--worker', worker,
                        '--strip-scripts'], env=env)
    if r.returncode:
        sys.exit('deploy failed')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['run'])
    ap.add_argument('--quick', action='store_true')
    ap.add_argument('--no-deploy', action='store_true')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--worker', default=WORKER)
    ap.add_argument('--out', default=str(WORK / 'out'))
    a = ap.parse_args()
    out = Path(a.out).resolve()
    WORK.mkdir(parents=True, exist_ok=True)
    if not CFG.exists():
        sys.exit('build/server/wrangler.json missing: CLOUDFLARE_ENV=static pnpm build')
    if json.loads(CFG.read_text()).get('name') != 'pokector-static':
        sys.exit('build/ is not the `static` build: CLOUDFLARE_ENV=static pnpm build')
    t0 = time.time()
    for f in ('state-updated', 'changed.json'):
        (WORK / f).unlink(missing_ok=True)
    group('local app')
    dev_vars()
    db_file = prepare_db()
    endgroup()
    with Server():
        if not a.quick:
            group('jobs (TCGCSV, TCGdex, Riftbound, catalog, history)')
            before = price_snapshot(db_file)
            run_jobs(db_file)
            changed_card(db_file, before)
            endgroup()
        group('freeze pages')
        meta = freeze(out, a.limit)
        endgroup()
        # the state after the render: includes eBay prices refreshed while card pages were rendered
        tmp = WORK / 'state.db'
        snapshot(db_file, tmp)
    check_out(out, meta, a.limit)
    os.replace(tmp, STATE_DB)
    if not a.quick:
        (WORK / 'state-updated').touch()    # the workflow saves the state only after a run with jobs
    shutil.rmtree(PERSIST, ignore_errors=True)
    if not a.no_deploy:
        group('deploy')
        secret_check(out)
        deploy(out, a.worker)
        shutil.rmtree(out)      # deployed; the frozen copy is not needed (keeps the Pi's SD card free)
        endgroup()
    log(f'done in {time.time() - t0:.0f} s')


if __name__ == '__main__':
    main()
