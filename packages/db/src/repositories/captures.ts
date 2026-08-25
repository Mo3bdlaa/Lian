// Captures — Q7, the two failures the specs had no answer for.
//
//   1. A capture is keyed on (message_id, tag_index).  A stream retried after
//      a partial write cannot log the same transaction twice.
//   2. Regenerating a message VOIDS the captures its previous version made.
//      Without this, regenerating "Okay, logged AED 400" logs AED 400 again.
//
// The capability that owns the tag writes its own row; this table records
// what was captured and by which tag so both operations are possible at all.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { UserScope } from '../scope.ts';

export type CaptureRecord = {
  messageId: string; tagIndex: number; capability: string;
  entityTable: string; entityId: string; voidedAt: Date | null;
};

type Row = {
  message_id: string; tag_index: number; capability: string;
  entity_table: string; entity_id: string; voided_at: Date | null;
};
const toRecord = (r: Row): CaptureRecord => ({
  messageId: r.message_id, tagIndex: r.tag_index, capability: r.capability,
  entityTable: r.entity_table, entityId: r.entity_id, voidedAt: r.voided_at,
});

/** Returns null when this (message, tag) was already captured — the caller
 *  should not write its entity row again. */
export async function claim(
  scope: UserScope,
  input: { messageId: string; tagIndex: number; capability: string; entityTable: string; entityId: string },
  sql: Sql = db(),
): Promise<CaptureRecord | null> {
  const { rows } = await sql.query<Row>(
    `INSERT INTO captures (message_id, tag_index, capability, entity_table, entity_id, user_id)
     VALUES ($2, $3, $4, $5, $6, $1)
     ON CONFLICT (message_id, tag_index) DO NOTHING
     RETURNING message_id, tag_index, capability, entity_table, entity_id, voided_at`,
    [scope.userId, input.messageId, input.tagIndex, input.capability, input.entityTable, input.entityId],
  );
  return rows[0] === undefined ? null : toRecord(rows[0]);
}

export async function forMessage(scope: UserScope, messageId: string, sql: Sql = db()): Promise<CaptureRecord[]> {
  const { rows } = await sql.query<Row>(
    `SELECT message_id, tag_index, capability, entity_table, entity_id, voided_at
     FROM captures WHERE user_id = $1 AND message_id = $2 ORDER BY tag_index`,
    [scope.userId, messageId],
  );
  return rows.map(toRecord);
}

/** Called before a regeneration replaces a message.  Returns what to undo. */
export async function voidForMessage(scope: UserScope, messageId: string, sql: Sql = db()): Promise<CaptureRecord[]> {
  const { rows } = await sql.query<Row>(
    `UPDATE captures SET voided_at = now()
     WHERE user_id = $1 AND message_id = $2 AND voided_at IS NULL
     RETURNING message_id, tag_index, capability, entity_table, entity_id, voided_at`,
    [scope.userId, messageId],
  );
  return rows.map(toRecord);
}
