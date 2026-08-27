-- Confirming an email address.
--
-- Shaped like password_resets and device_confirmations, for the third time
-- and the same reason: the person following the link is not signed in, so the
-- single-use expiring token IS the credential and the row it matches names
-- the user.
--
-- WHAT CONFIRMATION IS FOR, since it decides what it may block: recovery. An
-- address nobody has proved control of is an address a reset link cannot
-- usefully reach — most often because it was mistyped at sign-up, and the
-- person will not find out until the day they need it. So the product asks,
-- quietly and repeatedly, and blocks nothing.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

CREATE TABLE IF NOT EXISTS email_verifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- The ADDRESS this token proves, captured when it was sent. Kept because a
  -- token issued for one address must not confirm a different one if the
  -- account's address changes while the mail is in flight.
  email      citext NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_verifications_expiry ON email_verifications (expires_at);
CREATE INDEX IF NOT EXISTS email_verifications_user ON email_verifications (user_id, created_at DESC);
