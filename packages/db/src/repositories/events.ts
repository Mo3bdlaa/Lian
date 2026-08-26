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

/**
 * Day-N return for one cohort.
 *
 * Definitions, because "D7 retention" means four different things depending
 * on who is saying it, and a number without its definition is worse than no
 * number:
 *
 *   cohort      users whose FIRST recorded day is `cohortDay`
 *   returned    of those, the ones with any event ON exactly day N after —
 *               not "within N days"
 *   day_key     the USER's local day, not UTC's, so someone in Dubai who
 *               opens the app at 1am is counted on their own Tuesday
 *
 * "On exactly day N" is the stricter reading and the one that moves when the
 * product changes; the cumulative version flatters everything and mostly
 * measures how long the window is.
 */
export async function returnRate(cohortDay: string, dayN: number, sql: Sql = db()): Promise<{ cohort: number; returned: number }> {
  const { rows } = await sql.query<{ cohort: number; returned: number }>(
    `WITH cohort AS (
       SELECT user_id FROM events
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

export type RetentionCurve = {
  readonly cohortDay: string;
  readonly cohort: number;
  readonly d1: number;
  readonly d7: number;
  readonly d30: number;
};

/** The three numbers PRD §18 names, for one cohort. Counts, not
 *  percentages: a rate over a cohort of four is a rounding error with a
 *  percent sign, and whoever reads this should see the denominator. */
export async function retentionCurve(cohortDay: string, sql: Sql = db()): Promise<RetentionCurve> {
  const [d1, d7, d30] = await Promise.all([
    returnRate(cohortDay, 1, sql),
    returnRate(cohortDay, 7, sql),
    returnRate(cohortDay, 30, sql),
  ]);
  return { cohortDay, cohort: d1.cohort, d1: d1.returned, d7: d7.returned, d30: d30.returned };
}

/**
 * The onboarding funnel (PRD §18): how far new users get.
 *
 * Counted per user rather than per event, because someone who was prompted
 * for notifications three times is one person, not three.
 */
export async function onboardingFunnel(cohortDay: string, sql: Sql = db()): Promise<Record<string, number>> {
  const { rows } = await sql.query<{ name: string; users: number }>(
    `WITH cohort AS (
       SELECT user_id FROM events
       WHERE user_id IS NOT NULL GROUP BY user_id HAVING min(day_key) = $1
     )
     SELECT e.name, count(DISTINCT e.user_id)::int AS users
     FROM events e JOIN cohort c ON c.user_id = e.user_id
     GROUP BY e.name`,
    [cohortDay],
  );
  const funnel: Record<string, number> = {};
  for (const row of rows) funnel[row.name] = row.users;
  return funnel;
}

/** Cohorts with enough users to mean anything, newest first. A cohort of one
 *  is an anecdote; reporting it as a rate invites reading it as a trend. */
export const MEANINGFUL_COHORT = 20;

export async function cohorts(
  options: { since: string; minimumSize?: number },
  sql: Sql = db(),
): Promise<{ cohortDay: string; size: number }[]> {
  const { rows } = await sql.query<{ cohort_day: string; size: number }>(
    `SELECT first_day AS cohort_day, count(*)::int AS size FROM (
       SELECT user_id, min(day_key) AS first_day FROM events
       WHERE user_id IS NOT NULL GROUP BY user_id
     ) firsts
     WHERE first_day >= $1
     GROUP BY first_day HAVING count(*) >= $2
     ORDER BY first_day DESC`,
    [options.since, options.minimumSize ?? MEANINGFUL_COHORT],
  );
  return rows.map((row) => ({ cohortDay: row.cohort_day, size: row.size }));
}
