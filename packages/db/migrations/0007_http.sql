-- 0007 — what an HTTP layer needs that memory cannot provide.
--
-- Both tables exist because LESSONS §12 says in-process state is not state:
-- "Rate limiting held in process memory resets on every cold start and is
-- per-instance. It is not a rate limit."  The same is true of idempotency:
-- a Map of seen request ids is a Map that empties when the process does, and
-- the request that arrives twice is the one that arrives during a deploy.

-- ── rate limiting ─────────────────────────────────────────────────────────
-- Fixed windows rather than a sliding log: one row per (key, window), an
-- atomic upsert, and no per-request row to clean up.  The known cost is the
-- boundary — a caller can spend a full window's allowance at the end of one
-- window and again at the start of the next.  For the limits here (a handful
-- of writes a second) that is acceptable and is written down rather than
-- discovered.
CREATE TABLE rate_limits (
  bucket_key   text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);
-- Old windows are dead weight; a sweep uses this.
CREATE INDEX rate_limits_window_idx ON rate_limits(window_start);

-- ── idempotency ───────────────────────────────────────────────────────────
-- Every write route, not just capture.  A phone on a flaky connection retries
-- POSTs, and "it went through twice" is indistinguishable from a bug to the
-- person it happens to.
--
-- The stored response is what makes a retry SAFE rather than merely blocked:
-- the second request gets the first one's answer, so the client cannot tell
-- the difference and does not need to.
CREATE TABLE idempotency_keys (
  key           text        PRIMARY KEY,
  user_id       uuid        REFERENCES users(id) ON DELETE CASCADE,
  route         text        NOT NULL,
  -- A hash of the body, so the same key with DIFFERENT content is an error
  -- rather than silently returning the wrong answer.
  request_hash  text        NOT NULL,
  status        integer,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX idempotency_created_idx ON idempotency_keys(created_at);
