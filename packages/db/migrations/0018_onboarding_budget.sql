-- Onboarding gets its own counter.
--
-- The hole this closes was found by using the product: onboarding is a
-- different SURFACE, and only `surface = 'chat'` reserved against the daily
-- message counter — so an account that never completed onboarding had no
-- daily limit at all. Onboarding does not complete until the notification
-- permission is answered, and only a browser can answer it, so "never
-- completed" is a state a real person can sit in indefinitely.
--
-- The daily twenty exists to bound ONGOING cost. Being introduced is not
-- ongoing, and spending half of somebody's first day on it makes the one
-- conversation that decides whether they come back worse. So onboarding is
-- budgeted separately and the daily allowance starts when it completes.
--
-- LIFETIME, not daily: the period key is the constant 'once'
-- (ONBOARDING_PERIOD), so the row is written one time and never resets. A
-- daily onboarding budget would be the same hole with a smaller number in it.
ALTER TABLE usage_counters DROP CONSTRAINT usage_counters_kind_check;
ALTER TABLE usage_counters ADD CONSTRAINT usage_counters_kind_check
  CHECK (kind = ANY (ARRAY[
    'messages', 'proactive', 'model_cost_micros',
    'tts_chars', 'stt_seconds', 'storage_bytes', 'onboarding'
  ]));

COMMENT ON COLUMN usage_counters.period_key IS
  'A local day for messages and proactive, a month for cost and voice, and a '
  'CONSTANT for the two that never reset: ''held'' for storage_bytes (bytes '
  'held, which moves in both directions) and ''once'' for onboarding (a '
  'lifetime budget, spent one time per account).';
