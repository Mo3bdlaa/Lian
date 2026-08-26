-- 0009 — attachments become real.
--
-- The attachments table has existed since 0001 with a storage_key column and
-- nothing behind it: audio and photographs had nowhere to live, so a voice
-- note became a transcript and a receipt could not be photographed at all.
-- Two subscriber features were missing because of one absent bucket.
--
-- What this adds is the state an upload actually has. A presigned upload
-- happens in three steps — the server signs, the browser puts, the server
-- confirms — so a row exists before its bytes do, and 'pending' is that
-- moment rather than an error.
ALTER TABLE attachments
  ADD COLUMN content_type text NOT NULL DEFAULT 'application/octet-stream',
  ADD COLUMN status       text NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'ready')),
  ADD COLUMN ready_at     timestamptz,
  -- Which conversation it belongs to, so an incognito conversation's
  -- attachments can be found and removed with it (Q12: incognito writes
  -- nothing that outlives it).
  ADD COLUMN conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE;

-- A pending row older than the upload window is an upload that never
-- happened; the tick sweeps them.
CREATE INDEX attachments_pending_idx ON attachments(created_at) WHERE status = 'pending';
CREATE INDEX attachments_message_idx ON attachments(message_id) WHERE deleted_at IS NULL;

-- Storage is metered like everything else that costs money per user
-- (LESSONS §12). Bytes held, not bytes uploaded: this counter goes down when
-- something is deleted, which is why it is not keyed by month.
ALTER TABLE usage_counters DROP CONSTRAINT usage_counters_kind_check;
ALTER TABLE usage_counters ADD CONSTRAINT usage_counters_kind_check
  CHECK (kind IN ('messages', 'proactive', 'model_cost_micros', 'tts_chars', 'stt_seconds', 'storage_bytes'));
