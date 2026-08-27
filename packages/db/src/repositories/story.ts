// The story timeline — PRD §6.7, UI-UX §8.
//
// WHAT IS HERE AND WHAT IS DELIBERATELY NOT.
//
// §8's timeline lists milestones, moments and inside jokes. Only the first is
// built, and the split is not laziness — it is the difference between an
// event the product KNOWS and an event somebody would have to judge:
//
//   milestone    the day you started talking; the day a stage was reached.
//                Derived from rows that already exist, on facts the product
//                is already sure of. No model call, no judgement, no promise.
//
//   moment       "something that happened that you would want referred back
//   inside_joke  to." That is a judgement only she can make, which means a
//                new control tag — and under LESSONS §21 a new tag is a new
//                promise that has to name the mechanism that keeps it. It is
//                a capability, not a repository function, and building half
//                of one to fill a screen is how the four §20 holes happened.
//
// So the type column keeps all three (the schema was right), the writer
// writes one, and HANDOFF says which is missing rather than a matrix saying
// ✅ over an empty table.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { AssistantScope } from '../scope.ts';

export type StoryEventType = 'milestone' | 'moment' | 'inside_joke';

export type StoryEvent = {
  id: string;
  type: StoryEventType;
  /** A COPY KEY when `derived` is true, a person's own words when it is not
   *  — see migration 0016. Resolving happens at READ time, in the language it
   *  is being read in, so switching language does not strand half a history
   *  in the other one. */
  title: string;
  body: string | null;
  /** Written by the product (and therefore keyed), rather than by a person. */
  derived: boolean;
  occurredAt: Date;
};

type Row = { id: string; type: StoryEventType; title: string; body: string | null; occurred_at: Date; dedupe_key: string | null };
const COLUMNS = 'id, type, title, body, occurred_at, dedupe_key';
const toEvent = (row: Row): StoryEvent => ({
  id: row.id, type: row.type, title: row.title, body: row.body,
  derived: row.dedupe_key !== null, occurredAt: row.occurred_at,
});

/**
 * Write an event once.
 *
 * `dedupeKey` is what makes this safe to call from a nightly job: the tick
 * re-derives the same milestones every night, and without the key a timeline
 * of the relationship would become a timeline of the cron job. `DO NOTHING`
 * rather than `DO UPDATE`, because a milestone that already happened does not
 * change — and re-titling one retroactively would rewrite somebody's history
 * under them.
 */
export async function record(
  scope: AssistantScope,
  input: {
    type: StoryEventType;
    /** A copy key — this is a milestone the product derived. */
    titleKey: string;
    bodyKey?: string | null;
    occurredAt: Date;
    dedupeKey: string;
  },
  sql: Sql = db(),
): Promise<boolean> {
  const { rowCount } = await sql.query(
    `INSERT INTO story_events (assistant_id, type, title, body, occurred_at, dedupe_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (assistant_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
    [scope.assistantId, input.type, input.titleKey, input.bodyKey ?? null, input.occurredAt, input.dedupeKey],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The timeline, newest first.
 *
 * Bounded and ordered (LESSONS §16): a page, with the cursor separate from
 * the rows, so a caller that filters cannot skip what it dropped.
 */
export async function timeline(
  scope: AssistantScope,
  options: { limit: number; before?: Date | null } = { limit: 50 },
  sql: Sql = db(),
): Promise<StoryEvent[]> {
  const before = options.before ?? null;
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM story_events
     WHERE assistant_id = $1 AND deleted_at IS NULL
       AND ($2::timestamptz IS NULL OR occurred_at < $2::timestamptz)
     ORDER BY occurred_at DESC, id DESC
     LIMIT $3`,
    [scope.assistantId, before, options.limit],
  );
  return rows.map(toEvent);
}

/** Account deletion is real (LESSONS §11), and a timeline is somebody's year. */
export async function purge(scope: AssistantScope, sql: Sql = db()): Promise<number> {
  const { rowCount } = await sql.query(`DELETE FROM story_events WHERE assistant_id = $1`, [scope.assistantId]);
  return rowCount ?? 0;
}
