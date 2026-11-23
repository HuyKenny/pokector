#!/usr/bin/env bash
# Encrypted state of the nightly rebuild (pattern of apps/kurzovyradar): data/state.db = SQLite with the D1 schema
# (catalog, prices, price history, job queue; no account data). Kept as the release asset "state" of this PUBLIC
# repo, unreadable without STATE_KEY (GitHub secret; on Kenny's Pi POKECTOR_STATE_KEY in credentials/).
#   scripts/static/state.sh pull   # download + decrypt into data/state.db (fails if there is none)
#   scripts/static/state.sh push   # encrypt + upload (keeps the previous one as state-prev.enc)
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ -z "${STATE_KEY:-}" ] && [ -r /home/kenny/ai/credentials/.pokector-credentials.env ]; then
  STATE_KEY=$(sed -n 's/^POKECTOR_STATE_KEY=//p' /home/kenny/ai/credentials/.pokector-credentials.env)
fi
: "${STATE_KEY:?STATE_KEY missing}"
export STATE_KEY
TMP=${RUNNER_TEMP:-${TMPDIR:-/tmp}}
case "${1:-}" in
  pull)
    mkdir -p data
    gh release download state -p 'state.enc' -D "$TMP" --clobber
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:STATE_KEY -in "$TMP/state.enc" | gzip -d > data/state.db.part
    mv data/state.db.part data/state.db
    rm -f "$TMP/state.enc"
    echo "state restored ($(du -h data/state.db | cut -f1))" ;;
  push)
    [ -f data/state.db ] || { echo "no state to save"; exit 0; }
    gzip -c data/state.db | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:STATE_KEY -out "$TMP/state.enc"
    gh release view state >/dev/null 2>&1 || gh release create state --title "build state (encrypted)" \
      --notes "Encrypted data of the nightly static rebuild (scripts/static/). Not a software release." --latest=false
    # the previous state stays as state-prev.enc: one bad run can be undone by renaming
    if gh release download state -p 'state.enc' -D "$TMP/prev" --clobber 2>/dev/null; then
      mv "$TMP/prev/state.enc" "$TMP/prev/state-prev.enc"
      gh release upload state "$TMP/prev/state-prev.enc" --clobber
      rm -rf "$TMP/prev"
    fi
    gh release upload state "$TMP/state.enc" --clobber
    echo "state saved ($(du -h "$TMP/state.enc" | cut -f1))"
    rm -f "$TMP/state.enc" ;;
  *) echo "usage: $0 pull|push"; exit 2 ;;
esac
