-- Revert idx_prices_source_currency from 0011: SQLite's planner mis-picked it
-- for the per-card correlated price subqueries (pokédex / set-detail), replacing
-- a PK point lookup with a full (source,currency) range scan → N² blowup. The
-- primary key (card_id, source, variant, currency) already serves those lookups.
DROP INDEX IF EXISTS `idx_prices_source_currency`;
