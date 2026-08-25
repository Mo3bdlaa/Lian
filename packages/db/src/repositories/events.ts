// Product events.
//
// Retention is the stated success metric (PRD §18) and nothing in the specs
// measured it.  D1/D7/D30 are only answerable if the events exist from the
// first day — the first months cannot be backfilled — so this goes in before
// the features it measures.
//
// Deliberately thin: a name, a user-local day key, and a small property bag.
// This is not an analytics platform and should not grow into one.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';

export type EventName =
  | 'account_created' | 'consent_given' | 'onboarding_completed'
  | 'notification_permission_granted' | 'installed_pwa'
  | 'message_sent' | 'proactive_sent' | 'proactive_opened'
  | 'memory_saved' | 'memory_edited' | 'memory_deleted' | 'memory_queued'
  | 'capture_created' | 'capture_corrected'
  | 'session_started'
  | 'subscription_started' | 'subscription_cancelled'
  | 'export_requested' | 'account_deleted';

export type EventInput = {
  name: EventName;
  dayKey: string;
  userId?: string | null;
  assistantId?: string | null;
  properties?: Record<string, unknown>;
};

export async function record(input: EventInput, sql: Sql = db()): Promise<void> {
  await sql.query(
    `INSERT INTO events (user_id, assistant_id, name, day_key, properties)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.userId ?? null, input.assistantId ?? null, input.name, input.dayKey, JSON.stringify(input.properties ?? {})],
  );
}

/** Day-N return: users whose first day was `cohortDay` and who came back N days later. */
export async function returnRate(cohortDay: string, dayN: number, sql: Sql = db()): Promise<{ cohort: number; returned: number }> {
  const { rows } = await sql.query<{ cohort: number; returned: number }>(
    `WITH cohort AS (
       SELECT user_id, min(day_key) AS first_day FROM events
       WHERE user_id IS NOT NULL GROUP BY user_id HAVING min(day_key) = $1
     ), came_back AS (
       SELECT DISTINCT e.user_id FROM events e JOIN cohort c ON c.user_id = e.user_id
       WHERE e.day_key = to_char(($1::date + ($2 || ' days')::interval), 'YYYY-MM-DD')
     )
     SELECT (SELECT count(*)::int FROM cohort) AS cohort, (SELECT count(*)::int FROM came_back) AS returned`,
    [cohortDay, dayN],
  );
  return rows[0] ?? { cohort: 0, returned: 0 };
}
