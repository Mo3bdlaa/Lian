// The story timeline — PRD §6.7, UI-UX §8.
//
// WHAT IS HERE AND WHAT IS DELIBERATELY NOT.
//
// §8's timeline lists milestones, moments and inside jokes, and the three are
// written by two different things for a reason worth keeping straight:
//
//   milestone    the day you started talking; the day a stage was reached.
//                DERIVED from rows that already exist, on facts the product
//                is already sure of. No model call, no judgement, no promise.
//                Written with a `dedupe_key`, because the nightly tick
//                re-derives them and a timeline of the relationship must not
//                become a timeline of the cron job.
//
//   moment       "something that happened that you would want referred back
//   inside_joke  to." A JUDGEMENT only she can make, so it arrives as a
//                control tag she emits during a turn — `packages/capabilities
//                /src/story`, which is where the promise and the mechanism
//                keeping it are named together (LESSONS §21). Written with no
//                dedupe key and her own words, because it is not derived from
//                anything and re-deriving it is not a thing that can happen.
//
// The read side does not care which: `derived` is `dedupe_key IS NOT NULL`,
// and it is what tells the resolver whether `title` is a copy key or somebody
// already-written sentence.
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

/**
 * Write an event SHE judged — a moment, an inside joke.
 *
 * Separate from `record` above rather than a flag on it, because every field
 * means something different here: the title is her sentence and not a copy
 * key, there is no dedupe key (nothing re-derives a moment, so there is
 * nothing to be idempotent against), and it can therefore happen twice. That
 * last one is a real difference: two milestones on the same day are a bug,
 * two moments on the same day are a good day.
 */
export async function add(
  scope: AssistantScope,
  input: { type: 'moment' | 'inside_joke'; title: string; body: string | null; occurredAt: Date },
  sql: Sql = db(),
): Promise<StoryEvent> {
  const { rows } = await sql.query<Row>(
    `INSERT INTO story_events (assistant_id, type, title, body, occurred_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${COLUMNS}`,
    [scope.assistantId, input.type, input.title, input.body, input.occurredAt],
  );
  return toEvent(rows[0]!);
}

/** For the capture chip, which reads back in whatever language it is read in. */
export async function byIds(scope: AssistantScope, ids: readonly string[], sql: Sql = db()): Promise<StoryEvent[]> {
  if (ids.length === 0) return [];
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM story_events WHERE assistant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    [scope.assistantId, ids],
  );
  return rows.map(toEvent);
}

/**
 * Remove one event.
 *
 * Only an event SHE judged — a `dedupe_key` means the product derived it, and
 * the nightly tick would write it straight back. Refusing is better than
 * deleting something that reappears on its own, which reads as the product
 * ignoring somebody.
 *
 * Soft, like a message: `deleted_at` rather than a DELETE, so the row is out
 * of every read path and account deletion is still the thing that removes it.
 */
export async function remove(scope: AssistantScope, id: string, sql: Sql = db()): Promise<boolean> {
  const { rowCount } = await sql.query(
    `UPDATE story_events SET deleted_at = now()
     WHERE assistant_id = $1 AND id = $2 AND deleted_at IS NULL AND dedupe_key IS NULL`,
    [scope.assistantId, id],
  );
  return (rowCount ?? 0) > 0;
}

/** Account deletion is real (LESSONS §11), and a timeline is somebody's year. */
export async function purge(scope: AssistantScope, sql: Sql = db()): Promise<number> {
  const { rowCount } = await sql.query(`DELETE FROM story_events WHERE assistant_id = $1`, [scope.assistantId]);
  return rowCount ?? 0;
}
