// Outreach repository — LESSONS §4 lives in one column and one function.
//
// Noura backed off when nobody answered, and counted EVERY unanswered
// message toward that: a user who set three reminders for themselves and did
// not reply to them silenced her.  A self-inflicted mute that looked exactly
// like the feature was broken.
//
// So `source` is set at creation and never inferred later, and
// unansweredStreak() — the ONLY reader of that count in the product — filters
// to source='assistant_initiated'.  Reminders, scheduled tasks and anything
// the user asked for are invisible to backoff.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { AssistantScope } from '../scope.ts';

export type OutreachKind = 'follow_up' | 'reminder' | 'habit' | 'unfinished' | 'briefing' | 'pattern' | 'security';

/**
 * Who wanted this message.  'user_requested' covers reminders, scheduled
 * tasks and briefings the user asked for; those are excluded from backoff.
 */
export type OutreachSource = 'assistant_initiated' | 'user_requested';

/** Which kinds are hers, whatever a caller passes.  Used by a test. */
export const USER_REQUESTED_KINDS: readonly OutreachKind[] = ['reminder', 'habit'] as const;

export type Outreach = {
  id: string; assistantId: string; userId: string; kind: OutreachKind; source: OutreachSource;
  scheduledFor: Date; sentAt: Date | null; answeredAt: Date | null;
};

type Row = {
  id: string; assistant_id: string; user_id: string; kind: OutreachKind; source: OutreachSource;
  scheduled_for: Date; sent_at: Date | null; answered_at: Date | null;
};
const toOutreach = (r: Row): Outreach => ({
  id: r.id, assistantId: r.assistant_id, userId: r.user_id, kind: r.kind, source: r.source,
  scheduledFor: r.scheduled_for, sentAt: r.sent_at, answeredAt: r.answered_at,
});
const COLUMNS = 'id, assistant_id, user_id, kind, source, scheduled_for, sent_at, answered_at';

export async function schedule(
  scope: AssistantScope,
  input: { kind: OutreachKind; source: OutreachSource; scheduledFor: Date; dedupeKey?: string | null },
  sql: Sql = db(),
): Promise<Outreach | null> {
  const { rows } = await sql.query<Row>(
    `INSERT INTO outreach (assistant_id, user_id, kind, source, scheduled_for, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING
     RETURNING ${COLUMNS}`,
    [scope.assistantId, scope.userId, input.kind, input.source, input.scheduledFor, input.dedupeKey ?? null],
  );
  return rows[0] === undefined ? null : toOutreach(rows[0]);
}

export async function markSent(scope: AssistantScope, id: string, messageId: string | null, sql: Sql = db()): Promise<void> {
  await sql.query(
    `UPDATE outreach SET sent_at = now(), message_id = $3 WHERE assistant_id = $1 AND id = $2`,
    [scope.assistantId, id, messageId],
  );
}

/** Called when the user replies: everything unanswered from her is answered. */
export async function markAnswered(scope: AssistantScope, at: Date, sql: Sql = db()): Promise<number> {
  const { rowCount } = await sql.query(
    `UPDATE outreach SET answered_at = $2
     WHERE assistant_id = $1 AND sent_at IS NOT NULL AND answered_at IS NULL`,
    [scope.assistantId, at],
  );
  return rowCount ?? 0;
}

/**
 * THE backoff count.  Her own unanswered reach-outs, most recent first —
 * nothing the user asked for, ever.  This is the only place the product
 * counts unanswered messages; anything else that wants to know asks here.
 */
export async function unansweredStreak(scope: AssistantScope, sql: Sql = db()): Promise<number> {
  const { rows } = await sql.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM outreach
     WHERE assistant_id = $1
       AND source = 'assistant_initiated'
       AND sent_at IS NOT NULL
       AND answered_at IS NULL`,
    [scope.assistantId],
  );
  return rows[0]?.n ?? 0;
}

export async function due(scope: AssistantScope, now: Date, sql: Sql = db()): Promise<Outreach[]> {
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM outreach
     WHERE assistant_id = $1 AND scheduled_for <= $2 AND sent_at IS NULL AND cancelled_at IS NULL
     ORDER BY scheduled_for ASC`,
    [scope.assistantId, now],
  );
  return rows.map(toOutreach);
}
