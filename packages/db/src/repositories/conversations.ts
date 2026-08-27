// Conversations and messages.
//
// Q15: `kind` and `retention` exist from day one.  Incognito is always
// ephemeral (a CHECK constraint, not a convention) and never memory-written.
//
// UI-UX §38: history loads in bounded windows — the visible conversation
// targets the ~60 most recent messages and older batches are fetched by
// keyset, so scroll position is preserved and there is no offset drift when a
// message arrives mid-scroll.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { AssistantScope, UserScope } from '../scope.ts';

export type ConversationKind = 'main' | 'side' | 'incognito';
export type Retention = 'persist' | 'ephemeral';
export type MessageRole = 'user' | 'assistant';

export const WINDOW_SIZE = 60;

export type Conversation = {
  id: string; assistantId: string; kind: ConversationKind; retention: Retention;
  title: string | null; scenarioText: string | null; createdAt: Date;
};
type ConversationRow = {
  id: string; assistant_id: string; kind: ConversationKind; retention: Retention;
  title: string | null; scenario_text: string | null; created_at: Date;
};
const C_COLUMNS = 'id, assistant_id, kind, retention, title, scenario_text, created_at';
const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id, assistantId: r.assistant_id, kind: r.kind, retention: r.retention,
  title: r.title, scenarioText: r.scenario_text, createdAt: r.created_at,
});

/** Retention follows kind — a caller cannot ask for a memory-writing incognito. */
export function retentionFor(kind: ConversationKind): Retention {
  return kind === 'incognito' ? 'ephemeral' : 'persist';
}

export async function createConversation(
  scope: AssistantScope,
  input: { kind: ConversationKind; title?: string | null; scenarioText?: string | null },
  sql: Sql = db(),
): Promise<Conversation> {
  const { rows } = await sql.query<ConversationRow>(
    `INSERT INTO conversations (assistant_id, kind, retention, title, scenario_text)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${C_COLUMNS}`,
    [scope.assistantId, input.kind, retentionFor(input.kind), input.title ?? null,
     input.kind === 'incognito' ? (input.scenarioText ?? null) : null],
  );
  return toConversation(rows[0]!);
}

export async function getConversation(scope: AssistantScope, conversationId: string, sql: Sql = db()): Promise<Conversation | null> {
  const { rows } = await sql.query<ConversationRow>(
    `SELECT ${C_COLUMNS} FROM conversations
     WHERE assistant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [scope.assistantId, conversationId],
  );
  return rows[0] === undefined ? null : toConversation(rows[0]);
}

/** Q12: incognito threads are excluded from search and from listings. */
export async function listSearchable(scope: AssistantScope, sql: Sql = db()): Promise<Conversation[]> {
  const { rows } = await sql.query<ConversationRow>(
    `SELECT ${C_COLUMNS} FROM conversations
     WHERE assistant_id = $1 AND retention = 'persist' AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [scope.assistantId],
  );
  return rows.map(toConversation);
}

/** Incognito deletion is real deletion, not a flag (Q12). */
export async function hardDeleteConversation(scope: AssistantScope, conversationId: string, sql: Sql = db()): Promise<boolean> {
  const { rowCount } = await sql.query(
    `DELETE FROM conversations WHERE assistant_id = $1 AND id = $2 AND retention = 'ephemeral'`,
    [scope.assistantId, conversationId],
  );
  return (rowCount ?? 0) > 0;
}

export type Message = {
  id: string; conversationId: string; role: MessageRole; body: string;
  tags: unknown[]; surface: string | null; createdAt: Date;
  /** UI-UX §35: one earlier message this one answers. */
  replyToId: string | null;
};
type MessageRow = {
  id: string; conversation_id: string; role: MessageRole; body: string;
  tags: unknown[]; surface: string | null; created_at: Date; reply_to_id: string | null;
};
const M_COLUMNS = 'id, conversation_id, role, body, tags, surface, created_at, reply_to_id';
const toMessage = (r: MessageRow): Message => ({
  id: r.id, conversationId: r.conversation_id, role: r.role, body: r.body,
  tags: r.tags, surface: r.surface, createdAt: r.created_at, replyToId: r.reply_to_id,
});

export async function appendMessage(
  scope: AssistantScope,
  input: { conversationId: string; role: MessageRole; body: string; tags?: unknown[]; surface?: string | null; clientId?: string | null; replyToId?: string | null },
  sql: Sql = db(),
): Promise<Message> {
  // LESSONS §3: `body` is already stripped.  Tags are stored separately so a
  // regenerate can void the captures the previous version made (Q7).
  const { rows } = await sql.query<MessageRow>(
    `INSERT INTO messages (conversation_id, assistant_id, role, body, tags, surface, client_id, reply_to_id)
     VALUES ($2, $1, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (conversation_id, client_id) WHERE client_id IS NOT NULL DO UPDATE SET body = messages.body
     RETURNING ${M_COLUMNS}`,
    [scope.assistantId, input.conversationId, input.role, input.body,
     JSON.stringify(input.tags ?? []), input.surface ?? null, input.clientId ?? null, input.replyToId ?? null],
  );
  return toMessage(rows[0]!);
}

/** One message, by id. Scoped like everything else: a message id from
 *  another account resolves to nothing rather than to a 403. */
export async function getMessage(scope: AssistantScope, messageId: string, sql: Sql = db()): Promise<Message | null> {
  const { rows } = await sql.query<MessageRow>(
    `SELECT ${M_COLUMNS} FROM messages
     WHERE assistant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [scope.assistantId, messageId],
  );
  return rows[0] === undefined ? null : toMessage(rows[0]);
}

/** The bounded window: newest first, then reversed for display. */
export async function recentWindow(
  scope: AssistantScope,
  conversationId: string,
  limit = WINDOW_SIZE,
  sql: Sql = db(),
): Promise<Message[]> {
  const { rows } = await sql.query<MessageRow>(
    `SELECT ${M_COLUMNS} FROM messages
     WHERE assistant_id = $1 AND conversation_id = $2 AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC LIMIT $3`,
    [scope.assistantId, conversationId, limit],
  );
  return rows.map(toMessage).reverse();
}

/** Older batch by keyset — stable under insertion, unlike OFFSET. */
export async function olderThan(
  scope: AssistantScope,
  conversationId: string,
  before: { createdAt: Date; id: string },
  limit = WINDOW_SIZE,
  sql: Sql = db(),
): Promise<Message[]> {
  const { rows } = await sql.query<MessageRow>(
    `SELECT ${M_COLUMNS} FROM messages
     WHERE assistant_id = $1 AND conversation_id = $2 AND deleted_at IS NULL
       AND (created_at, id) < ($3, $4)
     ORDER BY created_at DESC, id DESC LIMIT $5`,
    [scope.assistantId, conversationId, before.createdAt, before.id, limit],
  );
  return rows.map(toMessage).reverse();
}

/**
 * Anything said since a moment — how an open app notices that she started
 * talking (PRD §9: she reaches out first, and the app being open should not
 * be the one place that misses it).
 */
export async function since(
  scope: AssistantScope,
  conversationId: string,
  after: { createdAt: Date; id: string },
  limit = WINDOW_SIZE,
  sql: Sql = db(),
): Promise<Message[]> {
  const { rows } = await sql.query<MessageRow>(
    `SELECT ${M_COLUMNS} FROM messages
     WHERE assistant_id = $1 AND conversation_id = $2 AND deleted_at IS NULL
       AND (created_at, id) > ($3, $4)
     ORDER BY created_at, id LIMIT $5`,
    [scope.assistantId, conversationId, after.createdAt, after.id, limit],
  );
  return rows.map(toMessage);
}

/**
 * Search across conversations (UI-UX §11).
 *
 * Incognito is excluded — Q12: nothing in it is kept, and a thread that is
 * searchable is a thread that was kept. Deleted messages and deleted threads
 * are excluded for the same reason.
 *
 * Ordered by recency rather than by relevance: a trigram index answers
 * containment, not ranking (see migration 0010 for why it is trigrams), and
 * "the most recent time I said this" is how someone actually looks for
 * something they said.
 */
export async function search(
  scope: AssistantScope,
  input: { query: string; limit: number },
  sql: Sql = db(),
): Promise<{ messageId: string; conversationId: string; conversationTitle: string | null; conversationKind: ConversationKind; role: MessageRole; body: string; createdAt: Date }[]> {
  const needle = input.query.trim();
  if (needle.length < 2) return [];
  const { rows } = await sql.query<{
    id: string; conversation_id: string; title: string | null; kind: ConversationKind;
    role: MessageRole; body: string; created_at: Date;
  }>(
    `SELECT m.id, m.conversation_id, c.title, c.kind, m.role, m.body, m.created_at
     FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.assistant_id = $1
       AND c.assistant_id = $1
       AND m.deleted_at IS NULL AND c.deleted_at IS NULL
       AND c.kind <> 'incognito'
       AND m.body ILIKE '%' || $2 || '%'
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT $3`,
    [scope.assistantId, needle, input.limit],
  );
  return rows.map((row) => ({
    messageId: row.id, conversationId: row.conversation_id, conversationTitle: row.title,
    conversationKind: row.kind, role: row.role, body: row.body, createdAt: row.created_at,
  }));
}

/**
 * The briefing she sent on a given local day, if she sent one.
 *
 * The briefing SCREEN reads this back rather than composing the same facts a
 * second time in her voice. `surface` is what makes that possible: the turn
 * records which surface produced a message, so "her briefing" is a query
 * rather than a guess about which message looks like one.
 *
 * The day is bounded by the caller's UTC instants because a local day is a
 * different range per time zone, and this table stores instants.
 */
export async function briefingOn(
  scope: AssistantScope,
  input: { from: Date; to: Date },
  sql: Sql = db(),
): Promise<string | null> {
  const { rows } = await sql.query<{ body: string }>(
    `SELECT body FROM messages
     WHERE assistant_id = $1 AND surface = 'briefing' AND deleted_at IS NULL
       AND created_at >= $2 AND created_at < $3
     ORDER BY created_at DESC LIMIT 1`,
    [scope.assistantId, input.from, input.to],
  );
  return rows[0]?.body ?? null;
}

export async function softDeleteMessage(scope: AssistantScope, messageId: string, sql: Sql = db()): Promise<boolean> {
  const { rowCount } = await sql.query(
    `UPDATE messages SET deleted_at = now() WHERE assistant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [scope.assistantId, messageId],
  );
  return (rowCount ?? 0) > 0;
}

/** The user's own recent messages, for the affect signals (Q9).  Incognito
 *  is excluded here rather than by the caller: nothing said there shapes how
 *  she feels, any more than it shapes what she remembers. */
export async function recentUserMessages(
  scope: AssistantScope,
  since: Date,
  limit: number,
  sql: Sql = db(),
): Promise<string[]> {
  const { rows } = await sql.query<{ body: string }>(
    `SELECT m.body FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.assistant_id = $1 AND m.role = 'user' AND m.deleted_at IS NULL
       AND c.retention = 'persist' AND m.created_at >= $2
     ORDER BY m.created_at DESC LIMIT $3`,
    [scope.assistantId, since, limit],
  );
  return rows.map((row) => row.body);
}

/** How many of the user's messages landed on a given local day — the input to
 *  the qualifying-day rule (Q3).  Incognito is excluded: it earns nothing. */
export async function userMessagesOnDay(
  scope: AssistantScope,
  dayStart: Date,
  dayEnd: Date,
  sql: Sql = db(),
): Promise<number> {
  const { rows } = await sql.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM messages m
     JOIN conversations c ON c.id = m.conversation_id
     WHERE m.assistant_id = $1 AND m.role = 'user' AND m.deleted_at IS NULL
       AND c.retention = 'persist'
       AND m.created_at >= $2 AND m.created_at < $3`,
    [scope.assistantId, dayStart, dayEnd],
  );
  return rows[0]?.n ?? 0;
}

// ── reactions (UI-UX §36) ─────────────────────────────────────────────────

export const REACTIONS = ['heart', 'smile', 'laugh', 'support', 'surprise'] as const;
export type Reaction = (typeof REACTIONS)[number];

/**
 * React, or take it back.
 *
 * One per person per message — the primary key says so, and the spec says
 * "keep it compact. No large emoji tray". Reacting with the same feeling
 * twice removes it, which is what every messaging app has taught people a
 * second tap means.
 */
/**
 * React to a message, or take a reaction back.
 *
 * SCOPED BY ASSISTANT, not only by user, and that distinction is the whole
 * point of this comment. The row written here is keyed (message_id, user_id),
 * so `user_id = $1` satisfies every scope check there is — and the message_id
 * came from a URL and was, until this was found, never checked against
 * anything. A stranger could write a reaction row against any message id in
 * the product: they could not READ the message, but a foreign-key violation
 * versus a success is an oracle for which ids exist, and rows against
 * arbitrary ids are rows nobody can account for.
 *
 * The INSERT ... SELECT is the fix: the row exists only if the message does
 * AND belongs to this assistant. Returning null for "not yours" and for "no
 * such message" is deliberate — the caller turns both into a 404.
 *
 * The general lesson is in LESSONS §17: carrying a scope column is not the
 * same as validating a foreign id, and only the first of those is mechanical.
 */
export async function react(
  scope: AssistantScope, messageId: string, kind: Reaction | null, sql: Sql = db(),
): Promise<{ ok: boolean; reaction: Reaction | null }> {
  if (kind === null) {
    const { rowCount } = await sql.query(
      `DELETE FROM message_reactions r
       USING messages m
       WHERE r.message_id = m.id AND r.user_id = $1 AND r.message_id = $2 AND m.assistant_id = $3`,
      [scope.userId, messageId, scope.assistantId],
    );
    // Removing a reaction that was not there is not an error — but removing
    // one from a message that is not theirs is not a no-op, it is a refusal.
    if ((rowCount ?? 0) > 0) return { ok: true, reaction: null };
    const { rows } = await sql.query(
      `SELECT 1 FROM messages WHERE id = $1 AND assistant_id = $2 AND deleted_at IS NULL`,
      [messageId, scope.assistantId],
    );
    return { ok: rows.length > 0, reaction: null };
  }
  const { rows } = await sql.query<{ kind: Reaction }>(
    `INSERT INTO message_reactions (message_id, user_id, kind)
     SELECT m.id, $1, $3 FROM messages m
     WHERE m.id = $2 AND m.assistant_id = $4 AND m.deleted_at IS NULL
     ON CONFLICT (message_id, user_id) DO UPDATE SET kind = EXCLUDED.kind, created_at = now()
     RETURNING kind`,
    [scope.userId, messageId, kind, scope.assistantId],
  );
  return rows[0] === undefined ? { ok: false, reaction: null } : { ok: true, reaction: rows[0].kind };
}

export async function reactionsFor(
  scope: UserScope, messageIds: readonly string[], sql: Sql = db(),
): Promise<Record<string, Reaction>> {
  if (messageIds.length === 0) return {};
  const { rows } = await sql.query<{ message_id: string; kind: Reaction }>(
    `SELECT message_id, kind FROM message_reactions WHERE user_id = $1 AND message_id = ANY($2::uuid[])`,
    [scope.userId, messageIds],
  );
  return Object.fromEntries(rows.map((row) => [row.message_id, row.kind]));
}

/** The quoted line above a reply — one lookup for the whole window. */
export async function quotedLines(
  scope: AssistantScope, messageIds: readonly string[], sql: Sql = db(),
): Promise<Record<string, { id: string; role: MessageRole; body: string }>> {
  if (messageIds.length === 0) return {};
  const { rows } = await sql.query<{ id: string; role: MessageRole; body: string }>(
    `SELECT id, role, body FROM messages
     WHERE assistant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    [scope.assistantId, messageIds],
  );
  return Object.fromEntries(rows.map((row) => [row.id, row]));
}
