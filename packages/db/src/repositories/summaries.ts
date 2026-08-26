// The rolling conversation summary.
//
// UI-UX §38: the visible window targets the ~60 most recent messages, and
// older ones load in batches as the user scrolls.  The MODEL's window is the
// same idea with a different bound — it gets the recent messages verbatim and
// this instead of everything older.
//
// One row per conversation, rewritten forward.  `covers_through_at` is what
// makes it forward rather than a re-read: the next roll starts where the last
// one stopped, so a long conversation costs the same to summarise as a short
// one.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { AssistantScope } from '../scope.ts';

export type Summary = {
  summary: string;
  coversThroughId: string | null;
  coversThroughAt: Date;
  messageCount: number;
};

export async function get(scope: AssistantScope, conversationId: string, sql: Sql = db()): Promise<Summary | null> {
  const { rows } = await sql.query<{ summary: string; covers_through_id: string | null; covers_through_at: Date; message_count: number }>(
    `SELECT summary, covers_through_id, covers_through_at, message_count
     FROM conversation_summaries WHERE assistant_id = $1 AND conversation_id = $2`,
    [scope.assistantId, conversationId],
  );
  const row = rows[0];
  return row === undefined ? null : {
    summary: row.summary, coversThroughId: row.covers_through_id,
    coversThroughAt: row.covers_through_at, messageCount: row.message_count,
  };
}

export async function put(
  scope: AssistantScope,
  conversationId: string,
  input: { summary: string; coversThroughId: string; coversThroughAt: Date; addedMessages: number },
  sql: Sql = db(),
): Promise<void> {
  await sql.query(
    `INSERT INTO conversation_summaries (conversation_id, assistant_id, summary, covers_through_id, covers_through_at, message_count)
     VALUES ($2, $1, $3, $4, $5, $6)
     ON CONFLICT (conversation_id) DO UPDATE SET
       summary = EXCLUDED.summary,
       covers_through_id = EXCLUDED.covers_through_id,
       covers_through_at = EXCLUDED.covers_through_at,
       message_count = conversation_summaries.message_count + EXCLUDED.message_count,
       updated_at = now()`,
    [scope.assistantId, conversationId, input.summary, input.coversThroughId, input.coversThroughAt, input.addedMessages],
  );
}

/**
 * The messages that have fallen out of the window and are not yet summarised:
 * everything after what the summary covers, except the newest `windowSize`,
 * which she still sees verbatim.
 */
export async function unsummarised(
  scope: AssistantScope,
  conversationId: string,
  windowSize: number,
  sql: Sql = db(),
): Promise<{ id: string; role: 'user' | 'assistant'; body: string; createdAt: Date }[]> {
  const { rows } = await sql.query<{ id: string; role: 'user' | 'assistant'; body: string; created_at: Date }>(
    `WITH covered AS (
       SELECT covers_through_at FROM conversation_summaries
       WHERE assistant_id = $1 AND conversation_id = $2
     ), windowed AS (
       SELECT id FROM messages
       WHERE assistant_id = $1 AND conversation_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT $3
     )
     SELECT m.id, m.role, m.body, m.created_at FROM messages m
     WHERE m.assistant_id = $1 AND m.conversation_id = $2 AND m.deleted_at IS NULL
       AND m.id NOT IN (SELECT id FROM windowed)
       AND (NOT EXISTS (SELECT 1 FROM covered) OR m.created_at > (SELECT covers_through_at FROM covered))
     ORDER BY m.created_at ASC, m.id ASC`,
    [scope.assistantId, conversationId, windowSize],
  );
  return rows.map((row) => ({ id: row.id, role: row.role, body: row.body, createdAt: row.created_at }));
}

export async function purgeForConversation(scope: AssistantScope, conversationId: string, sql: Sql = db()): Promise<void> {
  await sql.query(
    `DELETE FROM conversation_summaries WHERE assistant_id = $1 AND conversation_id = $2`,
    [scope.assistantId, conversationId],
  );
}
