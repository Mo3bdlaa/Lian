// Canon repository — LESSONS §5.
//
// Things she has said about herself are canon and may never be contradicted.
// This is the single mechanism that makes her feel like a person rather than
// a fresh model instance each session: memory retrieval alone is not enough,
// because similarity search will happily fail to surface yesterday's answer
// about her own preferences.
//
// Two properties matter and both are enforced here:
//   1. Retrieval is UNCONDITIONAL — there is no similarity parameter on
//      `all()`, and there cannot be one.
//   2. Nothing is ever deleted.  Compaction MERGES: the merged statement is a
//      new row, and its sources point at it via merged_into.  A compaction
//      that drops a statement is a §5 violation and canon.test.ts fails on it.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { AssistantScope } from '../scope.ts';

export type CanonCategory = 'self' | 'preference' | 'history' | 'boundary';

export type CanonStatement = {
  id: string;
  statement: string;
  category: CanonCategory;
  firstMessageId: string | null;
  createdAt: Date;
};

type Row = { id: string; statement: string; category: CanonCategory; first_message_id: string | null; created_at: Date };
const toCanon = (r: Row): CanonStatement => ({
  id: r.id, statement: r.statement, category: r.category, firstMessageId: r.first_message_id, createdAt: r.created_at,
});

export async function state(
  scope: AssistantScope,
  input: { statement: string; category?: CanonCategory; firstMessageId?: string | null },
  sql: Sql = db(),
): Promise<CanonStatement> {
  const { rows } = await sql.query<Row>(
    `INSERT INTO canon (assistant_id, statement, category, first_message_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, statement, category, first_message_id, created_at`,
    [scope.assistantId, input.statement, input.category ?? 'self', input.firstMessageId ?? null],
  );
  return toCanon(rows[0]!);
}

/**
 * Everything she has said about herself that has not been merged into a later
 * statement.  Unconditional by design: no query, no embedding, no limit.
 * Growth is bounded by compact(), not by filtering at read time.
 */
export async function all(scope: AssistantScope, sql: Sql = db()): Promise<CanonStatement[]> {
  const { rows } = await sql.query<Row>(
    `SELECT id, statement, category, first_message_id, created_at FROM canon
     WHERE assistant_id = $1 AND merged_into IS NULL
     ORDER BY created_at ASC`,
    [scope.assistantId],
  );
  return rows.map(toCanon);
}

/** Including merged rows — the audit view, and what proves nothing was lost. */
export async function allIncludingMerged(scope: AssistantScope, sql: Sql = db()): Promise<CanonStatement[]> {
  const { rows } = await sql.query<Row>(
    `SELECT id, statement, category, first_message_id, created_at FROM canon
     WHERE assistant_id = $1 ORDER BY created_at ASC`,
    [scope.assistantId],
  );
  return rows.map(toCanon);
}

/**
 * Merging compaction (Q4).  Several statements become one, and the originals
 * are kept and pointed at the merged row.  There is no delete here and there
 * must never be one: canon is uncapped in storage and bounded in the prompt
 * by merging, never by dropping.
 */
export async function compact(
  scope: AssistantScope,
  sourceIds: string[],
  mergedStatement: string,
  category: CanonCategory = 'self',
  sql: Sql = db(),
): Promise<CanonStatement> {
  if (sourceIds.length < 2) throw new Error('compaction merges two or more statements');
  const merged = await state(scope, { statement: mergedStatement, category }, sql);
  await sql.query(
    `UPDATE canon SET merged_into = $3 WHERE assistant_id = $1 AND id = ANY($2::uuid[]) AND merged_into IS NULL`,
    [scope.assistantId, sourceIds, merged.id],
  );
  return merged;
}
