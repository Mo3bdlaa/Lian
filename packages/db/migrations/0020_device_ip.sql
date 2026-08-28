-- The Security screen's location, done properly.
--
-- WHAT WAS THERE. `sign_in_attempts.location_label` and
-- `devices.location_label` were filled from an `x-lian-location` REQUEST
-- HEADER — a value the client chooses. A security screen exists to answer
-- "was that you?", and one whose location field is written by whoever is
-- signing in answers it for them. Meanwhile `sign_in_attempts.ip` existed and
-- was never written by anything.
--
-- So the label columns go and the address is stored instead. The place is
-- DERIVED at render, from a local MaxMind database read in process
-- (@lian/geo) — no third party ever sees a user's IP, and nothing about where
-- somebody was is persisted as a fact that can go stale or be wrong forever.
-- The same reason `devices.label` went in 0019: a stored derivation is frozen
-- where a derived one is not.
--
-- `inet` rather than text: Postgres validates it, normalises v6, and refuses
-- the malformed strings a spoofed header supplies.
ALTER TABLE sign_in_attempts DROP COLUMN location_label;
ALTER TABLE devices DROP COLUMN location_label;
ALTER TABLE devices ADD COLUMN last_ip inet;

COMMENT ON COLUMN sign_in_attempts.ip IS
  'The client address, from clientIp() in @lian/http — counted from the RIGHT '
  'of X-Forwarded-For by LIAN_TRUSTED_PROXIES hops, or the socket when that is '
  'zero. Never the leftmost entry, which is whatever the client sent. The '
  'PLACE is derived from this at render and is not stored.';
COMMENT ON COLUMN devices.last_ip IS
  'Where this device was last seen from. Same derivation rules as '
  'sign_in_attempts.ip; the place is never persisted.';
