-- 0016 — the story timeline gets a key, and therefore a writer.
--
-- `story_events` has existed since migration 0001 with the three types
-- UI-UX §8 names, an index, and NOT ONE ROW EVER WRITTEN — no repository, no
-- route, no screen — while the coverage matrix said ✅. LESSONS §20.
--
-- What this adds is the one thing that was missing to make it writable
-- safely: a key that makes recording an event IDEMPOTENT.
--
-- Every milestone the product can honestly write is derived from something
-- that already happened — the day you started talking, the day a stage was
-- reached — and it is derived on a schedule that runs repeatedly. Without a
-- key, "you reached Finding a rhythm" is written again every night, and a
-- timeline of the relationship becomes a timeline of the cron job.
--
-- Nullable, because a future event written by a person or by her judgement
-- has no natural key and does not need one.
ALTER TABLE story_events ADD COLUMN dedupe_key text;
CREATE UNIQUE INDEX story_events_dedupe_idx ON story_events(assistant_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- AND WHAT `title` HOLDS FOR A DERIVED MILESTONE: a COPY KEY, not a sentence.
--
-- The first version of this stored the localised name. That is the mistake
-- registry.test.ts already names in another place — "storing the line at
-- capture time would freeze the language it was captured in" — and a timeline
-- is the worst place to make it: switch to Arabic after a year and half your
-- history stays in English, permanently, because the words were written down
-- on the day rather than derived on the read.
--
-- So a row the PRODUCT derives holds keys and is resolved in the language it
-- is being read in. A row a person authors (a moment, an inside joke — not
-- built, see the repository) will hold their own words, because those are
-- theirs and must never be re-translated.
--
-- `dedupe_key IS NOT NULL` is what tells the two apart, and it is exactly the
-- same condition as "the product wrote this".
COMMENT ON COLUMN story_events.title IS
  'A copy key when dedupe_key is set (the product derived it); the persons own words otherwise.';
