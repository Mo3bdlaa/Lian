// Memory repository.
//
// Three product rules are enforced here rather than above, because "above" is
// every future caller:
//
//   PRD §35  free capacity is 100 ACTIVE memories per assistant.  Nothing is
//            ever evicted; at capacity a candidate becomes 'pending'.
//   Q5       the pending queue is capped at 20 with a visible, honest state.
//            Bounded and truthful beats unbounded or silent.
//   Q11      deleting a source removes its derived memory BY DEFAULT;
//            keeping it is an explicit choice and is marked as one.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { AssistantScope } from '../scope.ts';

export const FREE_ACTIVE_MEMORY_CAP = 100;
/** Q5: the "Not kept yet" queue is bounded.  See noteQueueFull(). */
export const PENDING_QUEUE_CAP = 20;

export type MemoryType = 'fact' | 'preference' | 'topic' | 'moment' | 'person' | 'emotional_state';
export type MemoryStatus = 'active' | 'pending' | 'archived';

export type Memory = {
  id: string;
  assistantId: string;
  type: MemoryType;
  statement: string;
  status: MemoryStatus;
  salience: number;
  sourceMessageId: string | null;
  sourceRemovedKept: boolean;
  createdAt: Date;
};

type Row = {
  id: string; assistant_id: string; type: MemoryType; statement: string; status: MemoryStatus;
  salience: number; source_message_id: string | null; source_removed_kept: boolean; created_at: Date;
};

const toMemory = (r: Row): Memory => ({
  id: r.id, assistantId: r.assistant_id, type: r.type, statement: r.statement, status: r.status,
  salience: r.salience, sourceMessageId: r.source_message_id, sourceRemovedKept: r.source_removed_kept,
  createdAt: r.created_at,
});

const COLUMNS = 'id, assistant_id, type, statement, status, salience, source_message_id, source_removed_kept, created_at';

export async function countActive(scope: AssistantScope, sql: Sql = db()): Promise<number> {
  const { rows } = await sql.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM memories WHERE assistant_id = $1 AND status = 'active' AND deleted_at IS NULL`,
    [scope.assistantId],
  );
  return rows[0]?.n ?? 0;
}

export async function countPending(scope: AssistantScope, sql: Sql = db()): Promise<number> {
  const { rows } = await sql.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM memories WHERE assistant_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
    [scope.assistantId],
  );
  return rows[0]?.n ?? 0;
}

export type RememberInput = {
  type: MemoryType;
  statement: string;
  salience?: number;
  sourceMessageId?: string | null;
  /** pgvector literal, e.g. '[0.1,-0.2,…]'.  Absent means the row is stored
   *  but not yet searchable — honest, and visible in a backfill query. */
  embedding?: string | null;
  embeddingModel?: string | null;
};

export type RememberResult =
  | { outcome: 'kept'; memory: Memory }
  | { outcome: 'queued'; memory: Memory; pendingCount: number }
  /** Q5: the queue is full.  She says so; nothing is dropped silently. */
  | { outcome: 'queue_full'; pendingCount: number };

/**
 * The single write path for a new memory.  `capacity` is the plan's active
 * cap — Infinity for paid.  Canon is NOT routed through here: it is her
 * identity, not memory about the user, and it is uncapped (Q4).
 */
export async function remember(
  scope: AssistantScope,
  input: RememberInput,
  capacity: number,
  sql: Sql = db(),
): Promise<RememberResult> {
  const active = await countActive(scope, sql);
  const status: MemoryStatus = active < capacity ? 'active' : 'pending';

  if (status === 'pending') {
    const pending = await countPending(scope, sql);
    if (pending >= PENDING_QUEUE_CAP) return { outcome: 'queue_full', pendingCount: pending };
  }

  const { rows } = await sql.query<Row>(
    `INSERT INTO memories (assistant_id, type, statement, status, salience, source_message_id, embedding_v, embedding_model)
     VALUES ($1, $2, $3, $4, $5, $6, $7::vector, $8) RETURNING ${COLUMNS}`,
    [scope.assistantId, input.type, input.statement, status, input.salience ?? 0.5,
     input.sourceMessageId ?? null, input.embedding ?? null, input.embeddingModel ?? null],
  );
  const memory = toMemory(rows[0]!);
  if (status === 'active') return { outcome: 'kept', memory };
  return { outcome: 'queued', memory, pendingCount: await countPending(scope, sql) };
}

/**
 * Retrieval for the prompt's memory block.
 *
 * Semantic first, then salience, then recency.  The ranking is deliberately
 * not pure similarity: a highly salient fact about someone's sister should
 * survive a turn about lunch, and pure cosine will happily bury it under
 * three lunch memories.  `1 - (a <=> b)` is cosine similarity; pgvector's
 * <=> is cosine DISTANCE.
 *
 * A memory with no embedding is still reachable — it sorts by salience — so a
 * failed embedding call degrades retrieval rather than losing the memory.
 */
export async function retrieve(
  scope: AssistantScope,
  embedding: string | null,
  limit: number,
  sql: Sql = db(),
): Promise<(Memory & { similarity: number | null })[]> {
  if (embedding === null) {
    const { rows } = await sql.query<Row>(
      `SELECT ${COLUMNS} FROM memories
       WHERE assistant_id = $1 AND status = 'active' AND deleted_at IS NULL
       ORDER BY salience DESC, created_at DESC LIMIT $2`,
      [scope.assistantId, limit],
    );
    return rows.map((row) => ({ ...toMemory(row), similarity: null }));
  }
  const { rows } = await sql.query<Row & { similarity: number | null }>(
    `SELECT ${COLUMNS},
            CASE WHEN embedding_v IS NULL THEN NULL ELSE 1 - (embedding_v <=> $2::vector) END AS similarity
     FROM memories
     WHERE assistant_id = $1 AND status = 'active' AND deleted_at IS NULL
     ORDER BY (coalesce(CASE WHEN embedding_v IS NULL THEN NULL ELSE 1 - (embedding_v <=> $2::vector) END, 0) * 0.7
               + salience * 0.3) DESC,
              created_at DESC
     LIMIT $3`,
    [scope.assistantId, embedding, limit],
  );
  return rows.map((row) => ({ ...toMemory(row), similarity: row.similarity }));
}

/** Rows stored before an embedder existed, or whose embedding call failed. */
export async function needingEmbedding(scope: AssistantScope, limit: number, sql: Sql = db()): Promise<Memory[]> {
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM memories
     WHERE assistant_id = $1 AND embedding_v IS NULL AND deleted_at IS NULL
     ORDER BY created_at LIMIT $2`,
    [scope.assistantId, limit],
  );
  return rows.map(toMemory);
}

export async function setEmbedding(
  scope: AssistantScope,
  memoryId: string,
  embedding: string,
  embeddingModel: string,
  sql: Sql = db(),
): Promise<void> {
  await sql.query(
    `UPDATE memories SET embedding_v = $3::vector, embedding_model = $4, updated_at = now()
     WHERE assistant_id = $1 AND id = $2`,
    [scope.assistantId, memoryId, embedding, embeddingModel],
  );
}

/** Near-duplicate check before writing.  Cheap, and it runs against what is
 *  already stored rather than only within one exchange. */
export async function findSimilar(
  scope: AssistantScope,
  embedding: string,
  threshold: number,
  sql: Sql = db(),
): Promise<Memory | null> {
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM memories
     WHERE assistant_id = $1 AND deleted_at IS NULL AND embedding_v IS NOT NULL
       AND 1 - (embedding_v <=> $2::vector) >= $3
     ORDER BY embedding_v <=> $2::vector LIMIT 1`,
    [scope.assistantId, embedding, threshold],
  );
  return rows[0] === undefined ? null : toMemory(rows[0]);
}

export async function list(scope: AssistantScope, status: MemoryStatus, sql: Sql = db()): Promise<Memory[]> {
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM memories
     WHERE assistant_id = $1 AND status = $2 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [scope.assistantId, status],
  );
  return rows.map(toMemory);
}

/** Promote a queued memory once the user has made room. */
export async function promote(scope: AssistantScope, memoryId: string, sql: Sql = db()): Promise<Memory | null> {
  const { rows } = await sql.query<Row>(
    `UPDATE memories SET status = 'active', updated_at = now()
     WHERE assistant_id = $1 AND id = $2 AND status = 'pending' AND deleted_at IS NULL
     RETURNING ${COLUMNS}`,
    [scope.assistantId, memoryId],
  );
  return rows[0] === undefined ? null : toMemory(rows[0]);
}

export async function forget(scope: AssistantScope, memoryId: string, sql: Sql = db()): Promise<boolean> {
  const { rowCount } = await sql.query(
    `UPDATE memories SET deleted_at = now() WHERE assistant_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [scope.assistantId, memoryId],
  );
  return (rowCount ?? 0) > 0;
}

/** Memories derived from one message — UI-UX §39's "helped me remember 2 things". */
export async function derivedFrom(scope: AssistantScope, messageId: string, sql: Sql = db()): Promise<Memory[]> {
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM memories
     WHERE assistant_id = $1 AND source_message_id = $2 AND deleted_at IS NULL`,
    [scope.assistantId, messageId],
  );
  return rows.map(toMemory);
}

/**
 * Q11 / LESSONS §11.  Deleting a source removes what was derived from it by
 * default; `keepDerived` is the user explicitly choosing otherwise, and the
 * memory is then marked so the Memory screen can say "Source removed — kept
 * by you" rather than showing a memory with no provenance.
 */
export async function deleteSourceMessage(
  scope: AssistantScope,
  messageId: string,
  options: { keepDerived: boolean },
  sql: Sql = db(),
): Promise<{ derivedRemoved: number; derivedKept: number }> {
  if (options.keepDerived) {
    const { rowCount } = await sql.query(
      `UPDATE memories SET source_removed_kept = true, source_message_id = NULL, updated_at = now()
       WHERE assistant_id = $1 AND source_message_id = $2 AND deleted_at IS NULL`,
      [scope.assistantId, messageId],
    );
    return { derivedRemoved: 0, derivedKept: rowCount ?? 0 };
  }
  const { rowCount } = await sql.query(
    `UPDATE memories SET deleted_at = now() WHERE assistant_id = $1 AND source_message_id = $2 AND deleted_at IS NULL`,
    [scope.assistantId, messageId],
  );
  return { derivedRemoved: rowCount ?? 0, derivedKept: 0 };
}
