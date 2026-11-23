#!/usr/bin/env python3
"""One-off: build the first data/state.db of the static rebuild from a D1 export.

The production D1 was deleted on 2026-11-23 (Cloudflare Free plan); its export is the starting state of the
nightly rebuild (scripts/static/build.sh). The export was made table by table (D1 cannot export FTS5 virtual tables), which leaves out the FTS table
AND every index. Both are recreated here: the indexes from the schema the migrations produce (an empty database with
drizzle/migrations applied), `card_search` with the same rows the catalog sync writes (ftsRowValues, rowid =
pokemon_cards.rowid). Without the unique indexes the upserts fail ("ON CONFLICT clause does not match").

Account data is dropped: the logged-in app is paused, and the state lives (encrypted) in a public repo's release.
The full export stays in the workspace backups.

    scripts/static/state-init.py <export.sql[.gz]> data/state.db
"""
import gzip
import os
import sqlite3
import sys
import time
from pathlib import Path

# Tables with user data (accounts, sessions, collections, alerts, billing, rate-limit counters keyed by IP).
PRIVATE = ["session", "account", "verification", "auth_kv", "user_profiles", "collection_entries", "wishlist_items",
           "binder_slots", "binders", "pokedex_favorites", "card_sales", "set_goals", "set_progress_cache",
           "portfolio_snapshots", "notifications", "price_alert_events", "import_jobs", "admin_audit_logs", "counters", "user"]
LOG_DAYS = 30
MIGRATIONS = Path(__file__).resolve().parents[2] / "drizzle" / "migrations"


def schema_indexes():
    """CREATE INDEX statements of the final schema (all migrations applied to an empty database)."""
    db = sqlite3.connect(":memory:")
    for f in sorted(MIGRATIONS.glob("*.sql")):
        db.executescript(f.read_text())
    return [r[0] for r in db.execute("SELECT sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")]


def main(src, dst):
    if os.path.exists(dst):
        sys.exit(f"{dst} exists")
    db = sqlite3.connect(dst)
    db.execute("PRAGMA journal_mode=OFF")
    db.execute("PRAGMA synchronous=OFF")
    op = gzip.open if src.endswith(".gz") else open
    with op(src, "rt", encoding="utf-8") as f:
        db.executescript(f.read())
    tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    db.execute("PRAGMA foreign_keys=OFF")
    for t in PRIVATE:
        if t in tables:
            db.execute(f'DELETE FROM "{t}"')
    cutoff = int((time.time() - LOG_DAYS * 86400) * 1000)
    db.execute("DELETE FROM sync_job_logs WHERE created_at < ?", (cutoff,))
    db.execute("DELETE FROM sync_jobs WHERE status NOT IN ('pending', 'running') AND created_at < ?", (cutoff,))
    db.execute("DELETE FROM sync_job_logs WHERE job_id NOT IN (SELECT id FROM sync_jobs)")
    if "card_search" not in tables:
        db.executescript("""
CREATE VIRTUAL TABLE `card_search` USING fts5(
  card_id UNINDEXED, name, set_name, series, number, rarity, artist, dex, supertype,
  tokenize = 'unicode61 remove_diacritics 2'
);
INSERT INTO card_search (rowid, card_id, name, set_name, series, number, rarity, artist, dex, supertype)
SELECT k.rowid, k.id, k.name, COALESCE(s.name, ''), COALESCE(s.series, ''),
       trim(k.number || ' ' || COALESCE(CAST(s.printed_total AS TEXT), '')),
       COALESCE(k.rarity, ''), COALESCE(k.artist, ''),
       COALESCE((SELECT group_concat(value, ' ') FROM json_each(COALESCE(k.national_pokedex_numbers_json, '[]'))), ''),
       trim(COALESCE(k.supertype, '') || ' ' ||
            COALESCE((SELECT group_concat(value, ' ') FROM json_each(COALESCE(k.subtypes_json, '[]'))), ''))
  FROM pokemon_cards k LEFT JOIN pokemon_sets s ON s.id = k.set_id;
""")
    have = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type = 'index'")}
    made = 0
    for q in schema_indexes():
        name = q.split("`")[1] if "`" in q else q.split()[2]
        if name not in have:
            db.execute(q)
            made += 1
    print(f"indexes: {made} created")
    db.commit()
    db.execute("VACUUM")
    n = db.execute("SELECT (SELECT COUNT(*) FROM pokemon_cards), (SELECT COUNT(*) FROM card_search), "
                   "(SELECT COUNT(*) FROM card_prices_current), (SELECT COUNT(*) FROM riftbound_cards)").fetchone()
    db.close()
    print(f"state: {os.path.getsize(dst) // 1_000_000} MB, cards {n[0]}, fts {n[1]}, prices {n[2]}, riftbound {n[3]}")


if __name__ == "__main__":
    main(*sys.argv[1:3])
