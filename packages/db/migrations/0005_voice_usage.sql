-- 0005 — voice is metered in two directions.
--
-- LESSONS §12's ceiling rule applies to listening as well as speaking:
-- transcription is billed per second and synthesis per character, and a paid
-- plan with no per-user ceiling on either is the same failure twice.
ALTER TABLE usage_counters DROP CONSTRAINT usage_counters_kind_check;
ALTER TABLE usage_counters ADD CONSTRAINT usage_counters_kind_check
  CHECK (kind IN ('messages', 'proactive', 'model_cost_micros', 'tts_chars', 'stt_seconds'));
