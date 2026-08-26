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
import type { AssistantScope, UserScope } from '../scope.ts';

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

// ── the tick's queries ────────────────────────────────────────────────────
// These are the cross-assistant reads the scheduler needs.  They are here
// rather than anywhere else because the tick has no user in hand when it
// starts — it is looking for work — and LESSONS §11 says an access path that
// spans users is a deliberate decision.  So each one carries the user_id it
// found back out, and every read AFTER this point is scoped by it.

export type DueRow = {
  id: string; userId: string; assistantId: string; conversationId: string;
  kind: OutreachKind; source: OutreachSource; timeZone: string;
};

/** Work that is due, across all users.  The scheduler's entry point. */
export async function dueAcrossAssistants(now: Date, limit: number, sql: Sql = db()): Promise<DueRow[]> {
  // db-scoping:allow-unscoped — the scheduler is looking for work and has no
  // user yet; this is where one comes from.  Every read after it is scoped by
  // the user_id this returns, and the tick is reached only through an
  // HMAC-signed endpoint.
  const { rows } = await sql.query<{
    id: string; user_id: string; assistant_id: string; conversation_id: string;
    kind: OutreachKind; source: OutreachSource; time_zone: string;
  }>(
    `SELECT o.id, o.user_id, o.assistant_id, o.kind, o.source, u.time_zone,
            (SELECT c.id FROM conversations c
              WHERE c.assistant_id = o.assistant_id AND c.kind = 'main' AND c.deleted_at IS NULL
              ORDER BY c.created_at LIMIT 1) AS conversation_id
     FROM outreach o
     JOIN users u ON u.id = o.user_id
     WHERE o.scheduled_for <= $1 AND o.sent_at IS NULL AND o.cancelled_at IS NULL
       AND u.deleted_at IS NULL
     ORDER BY o.scheduled_for ASC LIMIT $2`,
    [now, limit],
  );
  return rows
    .filter((row) => row.conversation_id !== null)
    .map((row) => ({
      id: row.id, userId: row.user_id, assistantId: row.assistant_id,
      conversationId: row.conversation_id, kind: row.kind, source: row.source, timeZone: row.time_zone,
    }));
}

/** Who an assistant belongs to.  Used to build a scope before any other read. */
export async function ownerOf(assistantId: string, sql: Sql = db()): Promise<{ userId: string } | null> {
  // db-scoping:allow-unscoped — this is the lookup that PRODUCES a scope.
  // Taking a user_id as an argument here would mean trusting one from the
  // caller, which is strictly worse.
  const { rows } = await sql.query<{ user_id: string }>(
    `SELECT user_id FROM assistants WHERE id = $1 AND archived_at IS NULL`,
    [assistantId],
  );
  return rows[0] === undefined ? null : { userId: rows[0].user_id };
}

export async function quietHoursFor(userId: string, sql: Sql = db()): Promise<{
  enabled: boolean; startHour: number; endHour: number; days: number[]; allowSecurity: boolean;
}> {
  const { rows } = await sql.query<{ enabled: boolean; start_hour: number; end_hour: number; days: number[]; allow_security: boolean }>(
    `SELECT enabled, start_hour, end_hour, days, allow_security FROM quiet_hours WHERE user_id = $1`,
    [userId],
  );
  const row = rows[0];
  // No row means never set, which is not the same as "quiet from 22:00".
  if (row === undefined) return { enabled: false, startHour: 22, endHour: 8, days: [], allowSecurity: true };
  return { enabled: row.enabled, startHour: row.start_hour, endHour: row.end_hour, days: row.days, allowSecurity: row.allow_security };
}

/**
 * Set quiet hours (UI-UX §23 / PRD §9).
 *
 * `allow_security` is separate from `enabled` and defaults to true: quiet
 * hours are about her chatting, not about a stranger signing in to your
 * account. Someone who silenced her at night still wants to hear about that.
 */
export async function setQuietHours(
  scope: UserScope,
  input: { enabled: boolean; startHour: number; endHour: number; days: number[]; allowSecurity: boolean },
  sql: Sql = db(),
): Promise<void> {
  await sql.query(
    `INSERT INTO quiet_hours (user_id, enabled, start_hour, end_hour, days, allow_security)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       enabled = $2, start_hour = $3, end_hour = $4, days = $5, allow_security = $6`,
    [scope.userId, input.enabled, input.startHour, input.endHour, input.days, input.allowSecurity],
  );
}

export async function daysSinceLastReachOut(scope: AssistantScope, now: Date, sql: Sql = db()): Promise<number> {
  const { rows } = await sql.query<{ days: number | null }>(
    `SELECT EXTRACT(EPOCH FROM ($2 - max(sent_at))) / 86400 AS days FROM outreach
     WHERE assistant_id = $1 AND source = 'assistant_initiated' AND sent_at IS NOT NULL`,
    [scope.assistantId, now],
  );
  const days = rows[0]?.days;
  return days === null || days === undefined ? Number.MAX_SAFE_INTEGER : Math.floor(days);
}

export async function reschedule(outreachId: string, to: Date, sql: Sql = db()): Promise<void> {
  // db-scoping:allow-unscoped — the row was selected by dueAcrossAssistants,
  // which is the scoping decision; re-deriving a scope here to write back to
  // the same primary key would be theatre.
  await sql.query(`UPDATE outreach SET scheduled_for = $2 WHERE id = $1 AND sent_at IS NULL`, [outreachId, to]);
}

export async function cancel(outreachId: string, reason: string, sql: Sql = db()): Promise<void> {
  // db-scoping:allow-unscoped — as above: the row came from the tick's own
  // scoped selection.
  await sql.query(
    `UPDATE outreach SET cancelled_at = now(), dedupe_key = coalesce(dedupe_key, '') || ':cancelled:' || left($2, 40)
     WHERE id = $1 AND sent_at IS NULL`,
    [outreachId, reason],
  );
}

/** Assistants whose user was active on a given local day — the reflection jobs' input. */
/**
 * Everyone who used the app on a given local day, one batch at a time.
 *
 * `after` is a keyset cursor over assistant id: pass the last id of the
 * previous page to get the next one. A caller that ignores it gets the first
 * batch and nothing else — which is the honest shape, because the alternative
 * (an unordered LIMIT) looks like full coverage and is not.
 */
export async function assistantsActiveOn(localDay: string, limit: number, after: string | null = null, sql: Sql = db()): Promise<{
  assistantId: string; userId: string; timeZone: string; conversationId: string;
}[]> {
  // ORDER BY is not decoration. A LIMIT with no ORDER BY returns an ARBITRARY
  // subset, so a batch job over more rows than the batch could hand back the
  // same people every tick and never reach the rest — a diary nobody past the
  // two-hundredth account ever gets, and nothing in the logs to say so. The
  // order is deterministic and the caller pages with `after`, so the batch is
  // a page rather than a sample.
  //
  // db-scoping:allow-unscoped — a batch job over every user by definition.
  // It returns the user_id for each row so everything downstream is scoped.
  const { rows } = await sql.query<{ assistant_id: string; user_id: string; time_zone: string; conversation_id: string }>(
    `SELECT DISTINCT a.id AS assistant_id, a.user_id, u.time_zone,
            (SELECT c.id FROM conversations c
              WHERE c.assistant_id = a.id AND c.kind = 'main' AND c.deleted_at IS NULL
              ORDER BY c.created_at LIMIT 1) AS conversation_id
     FROM assistants a
     JOIN users u ON u.id = a.user_id
     JOIN messages m ON m.assistant_id = a.id
     WHERE a.archived_at IS NULL AND u.deleted_at IS NULL AND m.deleted_at IS NULL
       AND m.created_at >= $1::date AND m.created_at < ($1::date + interval '1 day')
       AND ($3::uuid IS NULL OR a.id > $3::uuid)
     ORDER BY a.id
     LIMIT $2`,
    [localDay, limit, after ?? null],
  );
  return rows
    .filter((row) => row.conversation_id !== null)
    .map((row) => ({ assistantId: row.assistant_id, userId: row.user_id, timeZone: row.time_zone, conversationId: row.conversation_id }));
}
