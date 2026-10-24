-- card_search rows get rowid = pokemon_cards.rowid so the sync can replace a row
-- by rowid. Deleting by the UNINDEXED card_id column scanned the whole FTS table:
-- ~20 000 rows read per card, 485 M rows read per day (measured 2026-10-02).
CREATE TABLE `_card_search_rebuild` AS
  SELECT k.rowid AS rid, cs.card_id, cs.name, cs.set_name, cs.series, cs.number, cs.rarity, cs.artist, cs.dex, cs.supertype
    FROM card_search cs JOIN pokemon_cards k ON k.id = cs.card_id
   GROUP BY cs.card_id;
--> statement-breakpoint
DELETE FROM card_search;
--> statement-breakpoint
INSERT INTO card_search (rowid, card_id, name, set_name, series, number, rarity, artist, dex, supertype)
  SELECT rid, card_id, name, set_name, series, number, rarity, artist, dex, supertype FROM `_card_search_rebuild`;
--> statement-breakpoint
DROP TABLE `_card_search_rebuild`;
