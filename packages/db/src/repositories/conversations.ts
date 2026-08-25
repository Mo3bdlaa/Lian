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
import type { AssistantScope } from '../scope.ts';

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
};
type MessageRow = {
  id: string; conversation_id: string; role: MessageRole; body: string;
  tags: unknown[]; surface: string | null; created_at: Date;
};
const M_COLUMNS = 'id, conversation_id, role, body, tags, surface, created_at';
const toMessage = (r: MessageRow): Message => ({
  id: r.id, conversationId: r.conversation_id, role: r.role, body: r.body,
  tags: r.tags, surface: r.surface, createdAt: r.created_at,
});

export async function appendMessage(
  scope: AssistantScope,
  input: { conversationId: string; role: MessageRole; body: string; tags?: unknown[]; surface?: string | null; clientId?: string | null },
  sql: Sql = db(),
): Promise<Message> {
  // LESSONS §3: `body` is already stripped.  Tags are stored separately so a
  // regenerate can void the captures the previous version made (Q7).
  const { rows } = await sql.query<MessageRow>(
    `INSERT INTO messages (conversation_id, assistant_id, role, body, tags, surface, client_id)
     VALUES ($2, $1, $3, $4, $5, $6, $7)
     ON CONFLICT (conversation_id, client_id) WHERE client_id IS NOT NULL DO UPDATE SET body = messages.body
     RETURNING ${M_COLUMNS}`,
    [scope.assistantId, input.conversationId, input.role, input.body,
     JSON.stringify(input.tags ?? []), input.surface ?? null, input.clientId ?? null],
  );
  return toMessage(rows[0]!);
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

export async function softDeleteMessage(scope: AssistantScope, messageId: string, sql: Sql = db()): Promise<boolean> {
  const { rowCount } = await sql.query(
    `UPDATE messages SET deleted_at = now() WHERE assistant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [scope.assistantId, messageId],
  );
  return (rowCount ?? 0) > 0;
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
