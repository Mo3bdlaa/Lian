-- 0002 — life data (user-scoped), proactive delivery, auth, limits, events.

-- ── life data — USER-scoped (Q2) ──────────────────────────────────────────
-- Captured by whichever assistant heard it; owned by the user.  origin_*
-- columns carry the conversation-origin hint the correction screens show
-- ("You mentioned this in chat on May 18") without making the row hers.
CREATE TABLE tasks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- A habit is a task with a recurrence and a different surface, not a second
  -- table: one correction screen, one completion model, one origin hint.
  kind                text NOT NULL DEFAULT 'task' CHECK (kind IN ('task','habit')),
  title               text NOT NULL,
  due_on              date,
  due_at              timestamptz,
  -- {"freq":"daily"|"weekly","days":[1,2],"until":null} — deliberately small
  recurrence          jsonb,
  reminder_behavior   text NOT NULL DEFAULT 'default' CHECK (reminder_behavior IN ('default','none','at_time','morning')),
  completed_at        timestamptz,
  origin_message_id   uuid REFERENCES messages(id) ON DELETE SET NULL,
  origin_assistant_id uuid REFERENCES assistants(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT habit_recurs CHECK (kind <> 'habit' OR recurrence IS NOT NULL)
);
CREATE INDEX tasks_user_idx ON tasks(user_id, due_on) WHERE deleted_at IS NULL;

-- PRD §6.4 / DECISIONS §26: completion is DAY-SPECIFIC.  A recurring task
-- completed today is not completed tomorrow, and there is no seven-day dot
-- row anywhere — a week of dots is a streak by implication and UI-UX §26.2
-- bans streak pressure.
CREATE TABLE task_completions (
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day          date NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, day)
);
CREATE INDEX task_completions_user_idx ON task_completions(user_id, day);

CREATE TABLE notes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             text,
  body              text NOT NULL,
  topic             text,
  origin_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  origin_assistant_id uuid REFERENCES assistants(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX notes_user_idx ON notes(user_id, created_at DESC) WHERE deleted_at IS NULL;

-- Money.  Minor units in a bigint: floats do not belong in money, and the
-- product shows money in, money out, what's left — never a budget or a bar.
CREATE TABLE transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction         text NOT NULL CHECK (direction IN ('in','out')),
  amount_minor      bigint NOT NULL CHECK (amount_minor > 0),
  currency          text NOT NULL DEFAULT 'AED' CHECK (char_length(currency) = 3),
  category          text,
  occurred_on       date NOT NULL,
  note              text,
  receipt_id        uuid REFERENCES attachments(id) ON DELETE SET NULL,
  origin_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  origin_assistant_id uuid REFERENCES assistants(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX transactions_user_idx ON transactions(user_id, occurred_on DESC) WHERE deleted_at IS NULL;

-- Health is conversational context, not a tracker: no calories, macros,
-- scores, rings or grades anywhere in these columns, by design.
CREATE TABLE health_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('meal','workout','medication')),
  description       text NOT NULL,
  occurred_at       timestamptz NOT NULL,
  duration_minutes  integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  origin_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  origin_assistant_id uuid REFERENCES assistants(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX health_user_idx ON health_entries(user_id, occurred_at DESC) WHERE deleted_at IS NULL;

-- ── capture idempotency (Q7) ──────────────────────────────────────────────
-- One row per control tag that produced a capture.  Two failures close here:
-- a stream retried after a partial write cannot double-log, and regenerating
-- a message VOIDS the captures its previous version made (voided_at) instead
-- of silently logging the transaction twice.
CREATE TABLE captures (
  message_id   uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  tag_index    integer NOT NULL CHECK (tag_index >= 0),
  capability   text NOT NULL,
  entity_table text NOT NULL,
  entity_id    uuid NOT NULL,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  voided_at    timestamptz,
  PRIMARY KEY (message_id, tag_index)
);
CREATE INDEX captures_entity_idx ON captures(entity_table, entity_id);

-- ── proactive delivery ────────────────────────────────────────────────────
-- LESSONS §4 lives in `source`.  Noura counted EVERY unanswered message
-- toward backoff, including reminders the user set for themselves, so three
-- self-set reminders silenced her — a self-inflicted mute that looked like
-- the feature was broken.  Backoff counts source='assistant_initiated' only,
-- and exactly one repository function may read that count.
CREATE TABLE outreach (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assistant_id  uuid NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('follow_up','reminder','habit','unfinished','briefing','pattern','security')),
  source        text NOT NULL CHECK (source IN ('assistant_initiated','user_requested')),
  scheduled_for timestamptz NOT NULL,
  dedupe_key    text,
  message_id    uuid REFERENCES messages(id) ON DELETE SET NULL,
  sent_at       timestamptz,
  delivered_at  timestamptz,
  opened_at     timestamptz,
  answered_at   timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outreach_due_idx ON outreach(scheduled_for) WHERE sent_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX outreach_backoff_idx ON outreach(assistant_id, sent_at DESC) WHERE source = 'assistant_initiated';
CREATE UNIQUE INDEX outreach_dedupe_idx ON outreach(assistant_id, dedupe_key) WHERE dedupe_key IS NOT NULL AND cancelled_at IS NULL;

CREATE TABLE push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id   uuid,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  revoked_at  timestamptz
);

CREATE TABLE quiet_hours (
  user_id        uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled        boolean NOT NULL DEFAULT false,
  start_hour     smallint NOT NULL DEFAULT 22 CHECK (start_hour BETWEEN 0 AND 23),
  end_hour       smallint NOT NULL DEFAULT 8   CHECK (end_hour BETWEEN 0 AND 23),
  -- ISO weekdays 1–7; empty means every day
  days           smallint[] NOT NULL DEFAULT '{}',
  -- UI-UX §31: security may still reach through
  allow_security boolean NOT NULL DEFAULT true,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── auth, devices, and the Q10 new-device confirmation ────────────────────
CREATE TABLE devices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint    text NOT NULL,
  label          text,
  user_agent     text,
  location_label text,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  trusted_at     timestamptz,
  revoked_at     timestamptz,
  UNIQUE (user_id, fingerprint)
);

CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    uuid REFERENCES devices(id) ON DELETE SET NULL,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE sign_in_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES users(id) ON DELETE CASCADE,
  email_attempted citext NOT NULL,
  fingerprint     text,
  ip              inet,
  location_label  text,
  user_agent      text,
  -- 'held_new_device' is the honest name: the sign-in did not proceed, and
  -- that is what makes "I stopped them" true rather than a claim (Q10).
  outcome         text NOT NULL CHECK (outcome IN ('success','bad_password','unknown_email','held_new_device','confirmed','denied')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sign_in_attempts_user_idx ON sign_in_attempts(user_id, created_at DESC);

-- A sign-in from an unrecognised device is HELD here until the user confirms
-- by email.  Nothing about this table is cosmetic: it is what the security
-- message in chat describes.
CREATE TABLE device_confirmations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id      uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  attempt_id     uuid REFERENCES sign_in_attempts(id) ON DELETE SET NULL,
  token_hash     text NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL,
  confirmed_at   timestamptz,
  denied_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── limits: messages AND model cost, in one place ─────────────────────────
-- LESSONS §12: in-process rate limiting resets on every cold start and is
-- per-instance — it is not a rate limit.  And free tier plus a paid model
-- with no per-user ceiling is the standard way products in this category
-- die, so the model-cost ceiling is enforced here, beside the message count,
-- rather than bolted on later.
CREATE TABLE usage_counters (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('messages','proactive','model_cost_micros','tts_chars')),
  -- user-local 'YYYY-MM-DD' or 'YYYY-MM' (Q6: the day resets at local midnight)
  period_key text NOT NULL,
  value      bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, period_key)
);

-- Key pool state is shared, not in module memory (LESSONS §12).  The key
-- itself is never stored — only a reference to the environment variable that
-- holds it, so the database is not a place secrets accumulate.
CREATE TABLE api_key_pool (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL,
  key_ref           text NOT NULL,
  cooldown_until    timestamptz,
  last_status_code  integer,
  consecutive_fails integer NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, key_ref)
);

-- LESSONS §8: audio generated in a non-persisting context must not be
-- written to any cache, from any call site.  This table has exactly one
-- writer (packages/voice/src/speak.ts) and a boundary gate that says so.
CREATE TABLE tts_cache (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text_hash   text NOT NULL,
  voice_id    text NOT NULL,
  storage_key text NOT NULL,
  bytes       bigint,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (text_hash, voice_id)
);

-- ── product events ────────────────────────────────────────────────────────
-- Retention is the stated success metric and nothing measured it.  D1/D7/D30
-- are only answerable if the events exist from the first day, so the table
-- goes in now: the first months of data cannot be backfilled.
CREATE TABLE events (
  id           bigserial PRIMARY KEY,
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  assistant_id uuid REFERENCES assistants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  -- user-local day, so cohorts are computed in the user's day, not UTC's
  day_key      text NOT NULL,
  properties   jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_cohort_idx ON events(name, day_key);
CREATE INDEX events_user_idx ON events(user_id, occurred_at);
