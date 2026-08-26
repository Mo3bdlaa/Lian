-- Search across conversations (UI-UX §11).
--
-- WHY TRIGRAMS AND NOT FULL TEXT.
--
-- Postgres ships no Arabic text-search dictionary. `to_tsvector('arabic', …)`
-- does not exist, and 'simple' would tokenise Arabic on whitespace only —
-- which loses the definite article, every clitic pronoun and every prefixed
-- preposition, so «للشغل» would never match «شغل». Arabic is a first-class
-- language here, not a fallback, and a search that works in English and
-- half-works in Arabic is the exact asymmetry the product is trying not to
-- have.
--
-- Trigrams work identically in both: they index character sequences, so a
-- substring of an Arabic word matches whatever it is glued to. What they cost
-- is ranking — a trigram index answers "does this contain that", not "how
-- relevant is this" — so results are ordered by recency, which is also how a
-- person looks for something they said. If ranked relevance is ever needed,
-- the replacement is a per-language tsvector column, not a second index here.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- gin_trgm_ops rather than gist: this index only ever answers containment,
-- and GIN is both smaller and faster for that.
CREATE INDEX IF NOT EXISTS messages_body_trgm
  ON messages USING gin (body gin_trgm_ops);

CREATE INDEX IF NOT EXISTS memories_statement_trgm
  ON memories USING gin (statement gin_trgm_ops);
