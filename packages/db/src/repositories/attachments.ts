// Attachments — the index of what object storage holds.
//
// LESSONS §11 is the reason this table is the index rather than the bucket:
// "deleting is real". Deleting an account has to remove the objects, and a
// prefix listing is eventually consistent on most services — so what exists
// is what has a row here, and deletion reads the keys out of it.
//
// The three-step upload is visible in `status`: a row is written before the
// bytes exist ('pending'), the browser puts them straight to storage, and
// the server confirms ('ready'). A pending row older than the signed URL is
// an upload that never happened, and the tick sweeps it.
import type { Sql } from '../client.ts';
import { db } from '../client.ts';
import type { UserScope } from '../scope.ts';

export type AttachmentKind = 'image' | 'audio' | 'receipt';
export type AttachmentStatus = 'pending' | 'ready';

export type Attachment = {
  id: string;
  kind: AttachmentKind;
  storageKey: string;
  contentType: string;
  bytes: number | null;
  status: AttachmentStatus;
  persist: boolean;
  messageId: string | null;
  conversationId: string | null;
  createdAt: Date;
};

type Row = {
  id: string; kind: AttachmentKind; storage_key: string; content_type: string;
  bytes: string | number | null; status: AttachmentStatus; persist: boolean;
  message_id: string | null; conversation_id: string | null; created_at: Date;
};

const COLUMNS = 'id, kind, storage_key, content_type, bytes, status, persist, message_id, conversation_id, created_at';
const toAttachment = (row: Row): Attachment => ({
  id: row.id, kind: row.kind, storageKey: row.storage_key, contentType: row.content_type,
  bytes: row.bytes === null ? null : Number(row.bytes), status: row.status, persist: row.persist,
  messageId: row.message_id, conversationId: row.conversation_id, createdAt: row.created_at,
});

/** Claim an id, before the bytes exist. The key is built from the id, so the
 *  caller writes the row first and signs second. */
export async function reserve(
  scope: UserScope,
  input: { kind: AttachmentKind; contentType: string; persist: boolean; conversationId?: string | null },
  sql: Sql = db(),
): Promise<Attachment> {
  const { rows } = await sql.query<Row>(
    `INSERT INTO attachments (user_id, kind, content_type, storage_key, status, persist, conversation_id)
     VALUES ($1, $2, $3, '', 'pending', $4, $5)
     RETURNING ${COLUMNS}`,
    [scope.userId, input.kind, input.contentType, input.persist, input.conversationId ?? null],
  );
  return toAttachment(rows[0]!);
}

export async function setKey(scope: UserScope, id: string, storageKey: string, sql: Sql = db()): Promise<void> {
  await sql.query(`UPDATE attachments SET storage_key = $3 WHERE user_id = $1 AND id = $2`, [scope.userId, id, storageKey]);
}

/** The bytes arrived. Size is what the store reported, never what the client
 *  claimed — the ceiling is only a ceiling if the number is measured. */
export async function markReady(scope: UserScope, id: string, bytes: number, sql: Sql = db()): Promise<Attachment | null> {
  const { rows } = await sql.query<Row>(
    `UPDATE attachments SET status = 'ready', ready_at = now(), bytes = $3
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL
     RETURNING ${COLUMNS}`,
    [scope.userId, id, bytes],
  );
  return rows[0] === undefined ? null : toAttachment(rows[0]);
}

export async function attachToMessage(scope: UserScope, id: string, messageId: string, sql: Sql = db()): Promise<void> {
  await sql.query(
    `UPDATE attachments SET message_id = $3 WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [scope.userId, id, messageId],
  );
}

export async function get(scope: UserScope, id: string, sql: Sql = db()): Promise<Attachment | null> {
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM attachments WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [scope.userId, id],
  );
  return rows[0] === undefined ? null : toAttachment(rows[0]);
}

export async function forMessages(scope: UserScope, messageIds: readonly string[], sql: Sql = db()): Promise<Attachment[]> {
  if (messageIds.length === 0) return [];
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM attachments
     WHERE user_id = $1 AND message_id = ANY($2::uuid[]) AND deleted_at IS NULL AND status = 'ready'`,
    [scope.userId, messageIds],
  );
  return rows.map(toAttachment);
}

/** Every key this user still has, for the deletion sweep. */
export async function keysFor(scope: UserScope, sql: Sql = db()): Promise<{ id: string; storageKey: string; bytes: number }[]> {
  const { rows } = await sql.query<{ id: string; storage_key: string; bytes: string | number | null }>(
    `SELECT id, storage_key, bytes FROM attachments WHERE user_id = $1 AND storage_key <> ''`,
    [scope.userId],
  );
  return rows.map((row) => ({ id: row.id, storageKey: row.storage_key, bytes: Number(row.bytes ?? 0) }));
}

/** One attachment, gone: the row and the bytes it points at. The caller
 *  removes the object; this returns the key so it can. */
export async function remove(scope: UserScope, id: string, sql: Sql = db()): Promise<{ storageKey: string; bytes: number } | null> {
  const { rows } = await sql.query<{ storage_key: string; bytes: string | number | null }>(
    `UPDATE attachments SET deleted_at = now()
     WHERE user_id = $1 AND id = $2 AND deleted_at IS NULL
     RETURNING storage_key, bytes`,
    [scope.userId, id],
  );
  return rows[0] === undefined ? null : { storageKey: rows[0].storage_key, bytes: Number(rows[0].bytes ?? 0) };
}

/**
 * Everything an incognito conversation left behind (Q12).
 *
 * Attachments in a non-persisting conversation are stored while the
 * conversation is open — a photograph has to be readable to be talked about —
 * and go when it closes. Nothing about them outlives it.
 */
export async function forConversation(scope: UserScope, conversationId: string, sql: Sql = db()): Promise<Attachment[]> {
  const { rows } = await sql.query<Row>(
    `SELECT ${COLUMNS} FROM attachments WHERE user_id = $1 AND conversation_id = $2 AND deleted_at IS NULL`,
    [scope.userId, conversationId],
  );
  return rows.map(toAttachment);
}

export async function purge(scope: UserScope, sql: Sql = db()): Promise<void> {
  await sql.query(`DELETE FROM attachments WHERE user_id = $1`, [scope.userId]);
}

/** Uploads that were signed and never completed. Swept by the tick. */
export async function abandoned(before: Date, limit: number, sql: Sql = db()): Promise<{ userId: string; id: string; storageKey: string }[]> {
  // db-scoping:allow-unscoped — a sweep over every user's abandoned uploads,
  // by definition. It returns the user_id with each row so the caller stays
  // scoped when it deletes.
  const { rows } = await sql.query<{ user_id: string; id: string; storage_key: string }>(
    `SELECT user_id, id, storage_key FROM attachments
     WHERE status = 'pending' AND created_at < $1 LIMIT $2`,
    [before, limit],
  );
  return rows.map((row) => ({ userId: row.user_id, id: row.id, storageKey: row.storage_key }));
}

export async function deleteRows(scope: UserScope, ids: readonly string[], sql: Sql = db()): Promise<number> {
  if (ids.length === 0) return 0;
  const { rowCount } = await sql.query(
    `DELETE FROM attachments WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [scope.userId, ids],
  );
  return rowCount ?? 0;
}
