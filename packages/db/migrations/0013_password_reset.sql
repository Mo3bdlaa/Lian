-- Account recovery (UI-UX §21).
--
-- Shaped like device_confirmations, for the same reason: the person following
-- the link is not signed in, so the single-use expiring token IS the
-- credential and the row it matches names the user. Nothing in the URL is
-- trusted except by matching a hash stored here.
--
-- What is deliberately NOT in this table: the email address. The row is found
-- by token, never by address, so there is no query here that could be used to
-- ask whether an account exists.
CREATE TABLE IF NOT EXISTS password_resets (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The token is stored HASHED. A leaked database backup must not contain a
  -- set of working password-reset links.
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  -- Where it was asked for, so the security screen can show it and she can
  -- mention it. Never used to decide anything.
  requested_ip    text,
  requested_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The sweep reads this: expired and used rows are dead weight, and a used
-- token that lingers is a row somebody could try to reopen.
CREATE INDEX IF NOT EXISTS password_resets_expiry ON password_resets (expires_at);
CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets (user_id, created_at DESC);

-- The two new sign-in-attempt outcomes recovery produces. The CHECK is the
-- reason this is a migration rather than a type change: a value the database
-- refuses is better than one that silently becomes a string nobody filters on.
ALTER TABLE sign_in_attempts DROP CONSTRAINT IF EXISTS sign_in_attempts_outcome_check;
ALTER TABLE sign_in_attempts ADD CONSTRAINT sign_in_attempts_outcome_check
  CHECK (outcome IN ('success','bad_password','unknown_email','held_new_device','confirmed','denied','reset_requested','reset_completed'));
