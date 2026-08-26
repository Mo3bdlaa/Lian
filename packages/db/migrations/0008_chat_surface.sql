-- 0008 — what the chat screen needs that the schema did not carry.
--
-- Both come from UI-UX §35 and §36, and both are deliberately small: a reply
-- is a reference to one earlier message, and a reaction is ONE feeling per
-- person per message. The spec says "keep it compact. No large emoji tray",
-- and the primary key below is that sentence as a constraint.

ALTER TABLE messages ADD COLUMN reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL;
-- Reading a thread means reading the quoted line, so the reference is looked
-- up per message rather than joined across the window.
CREATE INDEX messages_reply_idx ON messages(reply_to_id) WHERE reply_to_id IS NOT NULL;

CREATE TABLE message_reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  -- Scoped to the person, not the assistant: a reaction is the USER's, and
  -- deletion has to reach it (LESSONS §11).
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('heart','smile','laugh','support','surprise')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One per person per message. Reacting again replaces; reacting with the
  -- same one removes it.
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX message_reactions_user_idx ON message_reactions(user_id);
