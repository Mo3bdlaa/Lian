-- 0004 — her own reflections, and the follow-ups they can produce.
--
-- `dream` and `diary` have been surfaces on the prompt path since the first
-- night with nowhere to land.  This is where they land.
--
-- Neither is a message: nothing here is sent, and nothing here appears in a
-- conversation.  They exist so that "she thought about this while you were
-- away" is true rather than a figure of speech — a diary entry is what she
-- made of a day, and a dream is a loose association she may bring up later.
CREATE TABLE reflections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assistant_id  uuid NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('dream', 'diary')),
  body          text NOT NULL,
  -- the user-local day it is about, so a diary entry is about a day rather
  -- than about a moment in UTC
  about_day     date NOT NULL,
  -- whether she has already brought it up; a reflection mentioned twice is
  -- worse than one never mentioned
  surfaced_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  -- One diary entry per day.  A second one for the same day is a re-run of
  -- the job, not a second thought.
  UNIQUE (assistant_id, kind, about_day)
);
CREATE INDEX reflections_scope_idx ON reflections(assistant_id, about_day DESC) WHERE deleted_at IS NULL;

-- LESSONS §11: a reflection is derived from the user's data, so it is part of
-- what an export contains and what a deletion removes.  The cascade above is
-- half of that; the export slice is in the repository.
