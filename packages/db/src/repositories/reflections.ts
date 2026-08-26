// Dreams and diary — her side of the day.
//
// Assistant-scoped, like memory and canon: what she made of a day belongs to
// the assistant that made it, and a second assistant knows nothing about it
// (LESSONS §14).
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { AssistantScope } from '../scope.ts';

export type ReflectionKind = 'dream' | 'diary';
export type Reflection = { id: string; kind: ReflectionKind; body: string; aboutDay: string; surfacedAt: Date | null };

type Row = { id: string; kind: ReflectionKind; body: string; about_day: string; surfaced_at: Date | null };
const COLUMNS = 'id, kind, body, about_day::text AS about_day, surfaced_at';
const toReflection = (r: Row): Reflection => ({
  id: r.id, kind: r.kind, body: r.body, aboutDay: r.about_day, surfacedAt: r.surfaced_at,
});

/** Returns null when one already exists for that day — a re-run of the job is
 *  not a second thought. */
export async function record(
  scope: AssistantScope,
  input: { kind: ReflectionKind; body: string; aboutDay: string },
  sql: Sql = db(),
): Promise<Reflection | null> {
  const { rows } = await sql.query<Row>(
    `INSERT INTO reflections (assistant_id, kind, body, about_day)
     VALUES ($1, $2, $3, $4::date)
     ON CONFLICT (assistant_id, kind, about_day) DO NOTHING
     RETURNING ${COLUMNS}`,
    [scope.assistantId, input.kind, input.body, input.aboutDay],
  );
  return rows[0] === undefined ? null : toReflection(rows[0]);
}

export async function recent(scope: AssistantScope, kind: ReflectionKind, limit: number, sql: Sql = db()): Promise<Reflection[]> {
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM reflections
     WHERE assistant_id = $1 AND kind = $2 AND deleted_at IS NULL
     ORDER BY about_day DESC LIMIT $3`,
    [scope.assistantId, kind, limit],
  );
  return rows.map(toReflection);
}

/** One she has not brought up yet — the source of an "I was thinking about…". */
export async function unsurfaced(scope: AssistantScope, sql: Sql = db()): Promise<Reflection | null> {
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM reflections
     WHERE assistant_id = $1 AND surfaced_at IS NULL AND deleted_at IS NULL
     ORDER BY about_day DESC LIMIT 1`,
    [scope.assistantId],
  );
  return rows[0] === undefined ? null : toReflection(rows[0]);
}

export async function markSurfaced(scope: AssistantScope, id: string, sql: Sql = db()): Promise<void> {
  await sql.query(
    `UPDATE reflections SET surfaced_at = now() WHERE assistant_id = $1 AND id = $2 AND surfaced_at IS NULL`,
    [scope.assistantId, id],
  );
}

export async function existsFor(scope: AssistantScope, kind: ReflectionKind, aboutDay: string, sql: Sql = db()): Promise<boolean> {
  const { rows } = await sql.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM reflections
     WHERE assistant_id = $1 AND kind = $2 AND about_day = $3::date AND deleted_at IS NULL`,
    [scope.assistantId, kind, aboutDay],
  );
  return (rows[0]?.n ?? 0) > 0;
}

/** LESSONS §11: derived from the user's data, so it is in the export. */
export async function allForExport(scope: AssistantScope, sql: Sql = db()): Promise<Reflection[]> {
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM reflections WHERE assistant_id = $1 AND deleted_at IS NULL ORDER BY about_day`,
    [scope.assistantId],
  );
  return rows.map(toReflection);
}
