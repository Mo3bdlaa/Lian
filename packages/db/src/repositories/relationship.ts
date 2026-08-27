// Relationship repository — LESSONS §6.
//
// The counter lives in the database and NEVER crosses the network: the API
// returns the stage's prose.  That is where "never surfaced as a score" is
// actually enforced, because a field is how a progress bar gets built.
//
// Monotonicity is a database trigger as well as a rule here, because a rule
// is what a future "recalculate stages" job quietly breaks.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { AssistantScope } from '../scope.ts';

export type RelationshipRow = {
  /** Set only by creditQualifyingDay, and only when the stage moved. */
  advanced?: boolean; stage: 1 | 2 | 3 | 4 | 5; qualifyingDays: number; lastQualifyingDay: string | null };

export async function get(scope: AssistantScope, sql: Sql = db()): Promise<RelationshipRow | null> {
  const { rows } = await sql.query<{ stage: 1 | 2 | 3 | 4 | 5; qualifying_days: number; last_qualifying_day: string | null }>(
    `SELECT stage, qualifying_days, last_qualifying_day FROM relationship WHERE assistant_id = $1`,
    [scope.assistantId],
  );
  const row = rows[0];
  return row === undefined ? null : { stage: row.stage, qualifyingDays: row.qualifying_days, lastQualifyingDay: row.last_qualifying_day };
}

/**
 * Credit one qualifying day.  Idempotent per local day: calling it twice for
 * the same day is a no-op, which is what keeps a talkative afternoon from
 * being worth more than a quiet one (Q3).
 */
export async function creditQualifyingDay(
  scope: AssistantScope,
  localDay: string,
  nextStage: (days: number) => 1 | 2 | 3 | 4 | 5,
  sql: Sql = db(),
): Promise<RelationshipRow> {
  const { rows } = await sql.query<{ qualifying_days: number }>(
    `UPDATE relationship SET qualifying_days = qualifying_days + 1, last_qualifying_day = $2::date
     WHERE assistant_id = $1 AND (last_qualifying_day IS NULL OR last_qualifying_day < $2::date)
     RETURNING qualifying_days`,
    [scope.assistantId, localDay],
  );
  const credited = rows[0];
  if (credited === undefined) return (await get(scope, sql))!; // already credited today
  const before = (await get(scope, sql))?.stage ?? 1;
  const stage = nextStage(credited.qualifying_days);
  await sql.query(
    `UPDATE relationship SET stage = $2, stage_changed_at = CASE WHEN stage <> $2 THEN now() ELSE stage_changed_at END
     WHERE assistant_id = $1 AND stage <= $2`,
    [scope.assistantId, stage],
  );
  const after = (await get(scope, sql))!;
  // Whether it MOVED, so the caller can write the milestone. Returned rather
  // than written here: which words a stage change is described in belongs to
  // the composition root, and a repository that reached the copy catalogue
  // would be a repository that speaks (LESSONS §13).
  return { ...after, advanced: after.stage > before };
}
