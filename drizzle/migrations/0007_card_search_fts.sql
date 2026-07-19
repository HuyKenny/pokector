CREATE VIRTUAL TABLE `card_search` USING fts5(
  card_id UNINDEXED,
  name,
  set_name,
  series,
  number,
  rarity,
  artist,
  dex,
  supertype,
  tokenize = 'unicode61 remove_diacritics 2'
);
