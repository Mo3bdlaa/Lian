-- Consent (UI-UX §22), completed.
--
-- 0001 already carried `is_adult` and `consented_at` — the two facts the
-- schema needed and nothing wrote. This adds the one that makes them mean
-- something later:
--
--   consent_version  WHICH text they agreed to. Without it, revising the
--                    terms silently reinterprets every existing agreement as
--                    being to the new wording, which is the one thing a
--                    consent record exists to prevent.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS consent_version text;
