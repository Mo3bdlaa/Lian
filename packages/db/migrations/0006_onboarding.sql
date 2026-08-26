-- 0006 — what onboarding has to learn.
--
-- PRD §8: onboarding is a conversation, not a form, and its emotional goal is
-- "she remembers me".  Four things have to come out of it, and each is a
-- column rather than a step counter — so progress is derived from what is
-- actually known, and a user who says two of them in one sentence is not
-- asked again.
ALTER TABLE users ADD COLUMN display_name text;
ALTER TABLE users ADD COLUMN onboarded_at timestamptz;

-- PRD §18 / §8: whether the assistant was named BY the user.  Q18 says always
-- let them name her; if they say "you choose", she chooses and this stays
-- false, which is a different thing from never having been asked.
ALTER TABLE assistants ADD COLUMN named_by_user boolean NOT NULL DEFAULT false;

-- UI-UX §23: the notification pre-prompt is asked in her voice, and the
-- ruling is that it comes AFTER the first remembered moment — asking before
-- she has demonstrated anything is asking a stranger for a key.
ALTER TABLE users ADD COLUMN notification_prompted_at timestamptz;
