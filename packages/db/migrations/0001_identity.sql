-- 0001 — accounts, assistants, conversations, memory, canon, relationship.
--
-- Scoping is the thing this file is arranged around.  Q2 decision: LIFE data
-- (tasks, money, health, album) belongs to the USER, because the gym payment
-- is the user's and not hers; MEMORY, canon, relationship, conversations and
-- story belong to the ASSISTANT, because LESSONS §14 says separate memory and
-- no shared awareness.  Every table below carries exactly one of the two
-- scope columns, and repositories in ../src/repositories take a scope object
-- rather than a bare id.  tools/gates/db-scoping.ts fails the build on a
-- query against a scoped table without its scope predicate.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── accounts ──────────────────────────────────────────────────────────────
CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE,
  password_hash     text   NOT NULL,
  -- Local time is load-bearing: the free-message day, quiet hours and the
  -- theme's night band are all user-local (Q6).
  time_zone         text   NOT NULL DEFAULT 'UTC',
  -- PRD §29 canonical list.  'auto' is the onboarding default.
  language_style    text   NOT NULL DEFAULT 'auto'
                    CHECK (language_style IN ('auto','en','ar-eg','ar-lv','ar-gulf','ar-mgh','ar-msa','fr')),
  plan              text   NOT NULL DEFAULT 'free' CHECK (plan IN ('free','paid')),
  -- Q8: auto is the product; the two pins are the accessibility escape hatch.
  theme_preference  text   NOT NULL DEFAULT 'auto'
                    CHECK (theme_preference IN ('auto','always-light','always-dark')),
  consented_at      timestamptz,
  is_adult          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);

-- ── assistants ────────────────────────────────────────────────────────────
-- Q1: no archetype column.  The three prototype archetypes are dropped for
-- v1; the five personality dials plus the stage progression replace them.
CREATE TABLE assistants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  -- PRD §33: exactly two, and each is a separately authored voice — never a
  -- pronoun swap over one template.
  gender            text NOT NULL CHECK (gender IN ('female','male')),
  appearance_theme  text NOT NULL DEFAULT 'rose' CHECK (appearance_theme IN ('rose','lilac')),
  voice_id          text,
  language_style    text NOT NULL DEFAULT 'auto'
                    CHECK (language_style IN ('auto','en','ar-eg','ar-lv','ar-gulf','ar-mgh','ar-msa','fr')),
  -- Q13: five dials, five named stops each.  Stored as stop names, never
  -- numbers — a number is what the product promises not to show.
  personality       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  archived_at       timestamptz
);
CREATE INDEX assistants_user_idx ON assistants(user_id) WHERE archived_at IS NULL;

-- Mood is derived, stored once, and read by exactly two consumers: the state
-- block of the assembled prompt, and theme resolution (Q9).
CREATE TABLE assistant_state (
  assistant_id  uuid PRIMARY KEY REFERENCES assistants(id) ON DELETE CASCADE,
  mood          text NOT NULL DEFAULT 'neutral' CHECK (mood IN ('warm','quiet','neutral')),
  mood_signals  jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ── relationship ──────────────────────────────────────────────────────────
-- LESSONS §6: closeness is earned, slow, and does not go backwards, and is
-- never surfaced as a score.  The counter lives here and NEVER crosses the
-- network — the API returns the stage's prose.  Monotonicity is a database
-- constraint rather than a convention, because a convention is what a future
-- "recalculate stages" job breaks.
CREATE TABLE relationship (
  assistant_id       uuid PRIMARY KEY REFERENCES assistants(id) ON DELETE CASCADE,
  stage              smallint NOT NULL DEFAULT 1 CHECK (stage BETWEEN 1 AND 5),
  qualifying_days    integer  NOT NULL DEFAULT 0 CHECK (qualifying_days >= 0),
  last_qualifying_day date,
  first_at           timestamptz NOT NULL DEFAULT now(),
  stage_changed_at   timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION relationship_is_monotonic() RETURNS trigger AS $$
BEGIN
  IF NEW.stage < OLD.stage THEN
    RAISE EXCEPTION 'relationship stage cannot go backwards (% -> %) — LESSONS §6', OLD.stage, NEW.stage;
  END IF;
  IF NEW.qualifying_days < OLD.qualifying_days THEN
    RAISE EXCEPTION 'qualifying_days cannot decrease (% -> %) — LESSONS §6', OLD.qualifying_days, NEW.qualifying_days;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER relationship_monotonic BEFORE UPDATE ON relationship
  FOR EACH ROW EXECUTE FUNCTION relationship_is_monotonic();

-- ── conversations ─────────────────────────────────────────────────────────
-- Q15: kind and retention exist from day one.  Retrofitting these two columns
-- after launch is the expensive migration, and incognito's persist=false rule
-- threads through voice, memory and search.
CREATE TABLE conversations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assistant_id   uuid NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('main','side','incognito')),
  -- 'ephemeral' is incognito: readable while it lives, hard-deleted when the
  -- thread is closed or deleted, never memory-written (Q12).
  retention      text NOT NULL CHECK (retention IN ('persist','ephemeral')),
  title          text,
  -- PRD §27 free-text role.  Never written to memory; deleted with the thread.
  scenario_text  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz,
  deleted_at     timestamptz,
  -- incognito is always ephemeral and nothing else is.  Stated as a
  -- constraint so no code path can create a memory-writing incognito thread.
  CONSTRAINT incognito_is_ephemeral CHECK ((kind = 'incognito') = (retention = 'ephemeral')),
  CONSTRAINT scenario_only_incognito CHECK (scenario_text IS NULL OR kind = 'incognito')
);
CREATE INDEX conversations_assistant_idx ON conversations(assistant_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  -- denormalised so every read can be scoped without a join
  assistant_id    uuid NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user','assistant')),
  -- LESSONS §3: what is stored is already stripped.  Control tags never live
  -- in body; they are parsed out server-side during streaming and kept
  -- separately so a regenerate can void the captures they made.
  body            text NOT NULL,
  tags            jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- which prompt surface produced an assistant message: chat, proactive,
  -- briefing… useful for debugging the one assembly path
  surface         text,
  -- idempotency for retries (Q6: a retry is free and must not double-send)
  client_id       text,
  superseded_by   uuid REFERENCES messages(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);
CREATE UNIQUE INDEX messages_client_id_idx ON messages(conversation_id, client_id) WHERE client_id IS NOT NULL;
-- keyset pagination for the bounded window (UI-UX §38: ~60 most recent)
CREATE INDEX messages_window_idx ON messages(conversation_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

CREATE TABLE attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id   uuid REFERENCES messages(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('image','audio','receipt')),
  storage_key  text NOT NULL,
  bytes        bigint,
  -- false for anything produced in a non-persisting context (LESSONS §8)
  persist      boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX attachments_user_idx ON attachments(user_id, created_at DESC) WHERE deleted_at IS NULL;

-- ── memory ────────────────────────────────────────────────────────────────
-- Embeddings are real[] rather than pgvector: pgvector is not present on this
-- box and cannot be assumed on a self-hosted one, which the product sells.
-- Cosine similarity is a SQL function below.  At 100–10k memories per
-- assistant a sequential scan is fine; the upgrade path is a pgvector column
-- plus an ivfflat index, and nothing above the repository changes.
CREATE TABLE memories (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assistant_id      uuid NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
  type              text NOT NULL CHECK (type IN ('fact','preference','topic','moment','person','emotional_state')),
  statement         text NOT NULL,
  embedding         real[],
  salience          real NOT NULL DEFAULT 0.5,
  -- 'pending' IS the free-plan "Not kept yet" queue (PRD §35).  Capacity
  -- counts 'active' only, and nothing is ever evicted.
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','pending','archived')),
  -- Q11: DIRECT single-source provenance only in v1.  Once a memory can
  -- derive from a multi-message summary, provenance is a graph and UI-UX
  -- §39's "this message helped me remember 2 things" stops being computable.
  source_message_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  -- set when the user deleted the source but chose to keep the memory
  source_removed_kept boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX memories_scope_idx ON memories(assistant_id, status, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX memories_source_idx ON memories(source_message_id) WHERE deleted_at IS NULL;

CREATE FUNCTION cosine_similarity(a real[], b real[]) RETURNS double precision AS $$
DECLARE dot double precision := 0; na double precision := 0; nb double precision := 0; i int;
BEGIN
  IF a IS NULL OR b IS NULL OR array_length(a,1) IS DISTINCT FROM array_length(b,1) THEN RETURN NULL; END IF;
  FOR i IN 1..array_length(a,1) LOOP
    dot := dot + a[i]*b[i]; na := na + a[i]*a[i]; nb := nb + b[i]*b[i];
  END LOOP;
  IF na = 0 OR nb = 0 THEN RETURN 0; END IF;
  RETURN dot / (sqrt(na) * sqrt(nb));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── canon ─────────────────────────────────────────────────────────────────
-- LESSONS §5.  Canon is a SEPARATE TABLE, not a memory type, and that is the
-- whole mechanism: a memory type would inevitably be fetched through the
-- similarity path, and things she has said about herself would quietly stop
-- being retrieved.  Canon is read unconditionally.
--
-- Q4: canon is uncapped and excluded from the free-plan memory cap — it is
-- her identity, not memory about the user.  Growth is bounded by MERGING
-- compaction: a merged statement points its sources at itself with
-- merged_into, and nothing is ever deleted.  A compaction that drops a
-- statement is a §5 violation and there is a test for it.
CREATE TABLE canon (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assistant_id      uuid NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
  statement         text NOT NULL,
  category          text NOT NULL DEFAULT 'self' CHECK (category IN ('self','preference','history','boundary')),
  first_message_id  uuid REFERENCES messages(id) ON DELETE SET NULL,
  merged_into       uuid REFERENCES canon(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX canon_scope_idx ON canon(assistant_id, created_at) WHERE merged_into IS NULL;

-- ── our story ─────────────────────────────────────────────────────────────
CREATE TABLE story_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assistant_id  uuid NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('milestone','moment','inside_joke')),
  title         text NOT NULL,
  body          text,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  attachment_id uuid REFERENCES attachments(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX story_scope_idx ON story_events(assistant_id, occurred_at DESC) WHERE deleted_at IS NULL;

-- ── user profile (UI-UX §12: user-authored, distinct from memory) ─────────
CREATE TABLE profile_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  section    text NOT NULL CHECK (section IN ('about','should_know','notes')),
  body       text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profile_notes_user_idx ON profile_notes(user_id, section);
