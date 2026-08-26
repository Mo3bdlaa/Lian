-- 0003 — semantic memory retrieval, a rolling summary, and canon compaction
-- bookkeeping.
--
-- pgvector, reversing last night's choice.  The extension was not installed on
-- the build box then, and real[] with a SQL cosine function was the honest
-- fallback; it is installed now and semantic retrieval is the product.  The
-- old column is kept until the backfill runs, then dropped in a later
-- migration — a vector column cannot be added and populated in one step
-- without an embedder, and pretending otherwise would leave rows that look
-- searchable and are not.
--
-- CREATE EXTENSION needs a superuser ONCE per database; it is a deployment
-- step, and this statement is a no-op afterwards for an unprivileged migrator.
CREATE EXTENSION IF NOT EXISTS vector;

-- 1024 dimensions.  This is the one schema decision here that is genuinely
-- annoying to change late: it has to match whatever embedder ships, and
-- changing it means re-embedding every memory.  1024 is the width of the
-- common current text embedders and of the deterministic dev embedder in
-- packages/analysis, so dev and production agree on shape if not on meaning.
ALTER TABLE memories ADD COLUMN embedding_v vector(1024);

-- Cosine, because the embedders in question return normalised vectors and
-- cosine is what they are trained for.  ivfflat over hnsw: cheaper to build,
-- and at 100–10k memories per assistant the difference in recall is noise.
-- The index is partial — retrieval only ever reads active, undeleted rows —
-- so it stays small even for a user with a long history.
CREATE INDEX memories_embedding_idx ON memories
  USING ivfflat (embedding_v vector_cosine_ops) WITH (lists = 100)
  WHERE status = 'active' AND deleted_at IS NULL;

-- Which embedder produced a vector.  Without this, switching embedders
-- silently mixes two vector spaces in one index and retrieval quietly gets
-- worse rather than failing.
ALTER TABLE memories ADD COLUMN embedding_model text;

-- ── the rolling summary ───────────────────────────────────────────────────
-- A conversation older than the bounded window still happened.  The window
-- (UI-UX §38: ~60 messages) is what she is shown verbatim; this is what she is
-- shown instead of the rest.  One row per conversation, rewritten forward.
CREATE TABLE conversation_summaries (
  conversation_id   uuid PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  assistant_id      uuid NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
  summary           text NOT NULL,
  -- everything up to and including this message is covered by the summary,
  -- so the next roll knows where to start and cannot double-count
  covers_through_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  covers_through_at timestamptz NOT NULL,
  message_count     integer NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversation_summaries_assistant_idx ON conversation_summaries(assistant_id);

-- ── canon compaction bookkeeping ──────────────────────────────────────────
-- LESSONS §5: canon is never dropped.  Compaction merges, and merged_into
-- already records that.  This adds the count so the merge is auditable — a
-- merged row that claims fewer sources than it has is a dropped statement.
ALTER TABLE canon ADD COLUMN merged_count integer NOT NULL DEFAULT 0;

-- The database refuses to delete canon.  This is the strongest available
-- statement of §5: not a convention, not a code path, a rule.
CREATE FUNCTION canon_is_never_deleted() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'canon is never deleted — compaction merges (LESSONS §5). To remove an assistant entirely, delete the assistant.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER canon_no_delete BEFORE DELETE ON canon
  FOR EACH ROW WHEN (pg_trigger_depth() = 0) EXECUTE FUNCTION canon_is_never_deleted();
