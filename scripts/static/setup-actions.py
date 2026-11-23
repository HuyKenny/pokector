#!/usr/bin/env python3
"""pokector.com nightly static rebuild: GitHub secrets of .github/workflows/static.yml (run by Kenny on the Pi:
`! python3 apps/pokector/scripts/static/setup-actions.py`).

1. Copies from /home/kenny/ai/credentials into the secrets of HuyKenny/pokector:
     STATE_KEY             ← .pokector-credentials.env  POKECTOR_STATE_KEY (decrypts the release asset "state")
     POKEMON_TCG_API_KEY   ← .pokector-credentials.env  (weekly catalog sync = new cards)
     EBAY_APP_ID/CERT_ID   ← .pokector-ebay-credentials.env (eBay "from $X" + PSA prices; optional)
     CLOUDFLARE_ACCOUNT_ID ← .pokector-credentials.env  POKECTOR_CF_ACCOUNT_ID
2. Creates the scoped Cloudflare API token for the deploy (scripts/static/zmraz.py deploy) — account: Workers Scripts
   Write; zone pokector.com only: Zone Read, Workers Routes Write (shard routes), DNS Write (custom domains) — saves it
   as POKECTOR_STATIC_CF_TOKEN in .pokector-credentials.env and as the secret CLOUDFLARE_API_TOKEN (replaces the old
   SSR deploy token secret). An existing POKECTOR_STATIC_CF_TOKEN is reused.
Nothing is printed except status. Safe to run again.
"""
import json
import subprocess
import urllib.request
from pathlib import Path

CRED = Path("/home/kenny/ai/credentials")
REPO = "HuyKenny/pokector"
ZONE = "pokector.com"


def env(name):
    p = CRED / name
    if not p.exists():
        return {}
    return {k.strip(): v.strip().strip('"\'') for k, _, v in (l.partition("=") for l in p.read_text().splitlines())
            if _ and not k.lstrip().startswith("#")}


def secret(name, value):
    subprocess.run(["gh", "secret", "set", name, "-R", REPO], input=value.encode(), check=True, capture_output=True)
    print(f"ok: secret {name}")


pk, ebay, cf = env(".pokector-credentials.env"), env(".pokector-ebay-credentials.env"), env(".cloudflare-credentials.env")
for sec, val in (("STATE_KEY", pk.get("POKECTOR_STATE_KEY")), ("POKEMON_TCG_API_KEY", pk.get("POKEMON_TCG_API_KEY")),
                 ("CLOUDFLARE_ACCOUNT_ID", pk.get("POKECTOR_CF_ACCOUNT_ID"))):
    if not val:
        raise SystemExit(f"{sec}: value missing in credentials/.pokector-credentials.env")
    secret(sec, val)
for k in ("EBAY_APP_ID", "EBAY_CERT_ID"):
    if ebay.get(k):
        secret(k, ebay[k])
    else:
        print(f"skip: {k} not in credentials/.pokector-ebay-credentials.env (eBay prices off)")

if pk.get("POKECTOR_STATIC_CF_TOKEN"):
    secret("CLOUDFLARE_API_TOKEN", pk["POKECTOR_STATIC_CF_TOKEN"])
    raise SystemExit(0)

H = {"X-Auth-Email": cf["CF_EMAIL"], "X-Auth-Key": cf.get("CF_GLOBAL_API_KEY") or cf["CF_API_KEY"],
     "Content-Type": "application/json", "User-Agent": "pokector-setup-actions/1.0"}


def api(method, path, body=None):
    req = urllib.request.Request("https://api.cloudflare.com/client/v4" + path, data=json.dumps(body).encode() if body else None,
                                 headers=H, method=method)
    return json.load(urllib.request.urlopen(req, timeout=30))


groups = {g["name"]: g["id"] for g in api("GET", "/user/tokens/permission_groups")["result"]}
acc = pk["POKECTOR_CF_ACCOUNT_ID"]
zone = pk.get("POKECTOR_CF_ZONE_ID") or api("GET", f"/zones?name={ZONE}")["result"][0]["id"]
body = {"name": "pokector static rebuild deploy (GitHub Actions)", "policies": [
    {"effect": "allow", "resources": {f"com.cloudflare.api.account.{acc}": "*"},
     "permission_groups": [{"id": groups["Workers Scripts Write"]}]},
    {"effect": "allow", "resources": {f"com.cloudflare.api.account.zone.{zone}": "*"},
     "permission_groups": [{"id": groups[n]} for n in ("Zone Read", "Workers Routes Write", "DNS Write")]}]}
r = api("POST", "/user/tokens", body)
if not r.get("success"):
    raise SystemExit(f"token not created: {r.get('errors')}")
tok = r["result"]["value"]
p = CRED / ".pokector-credentials.env"
p.write_text(p.read_text().rstrip("\n") + f"\n# GitHub Actions deploy of the static site (scripts/static/setup-actions.py)\nPOKECTOR_STATIC_CF_TOKEN={tok}\n")
print("ok: token created, saved to credentials/.pokector-credentials.env")
secret("CLOUDFLARE_API_TOKEN", tok)
